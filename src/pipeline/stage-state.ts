import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type StageStatus = 'PENDING' | 'RUNNING' | 'PASS' | 'FAIL' | 'SKIPPED_WITH_REASON';
export interface StageResult { outputs: string[]; outputHashes?: Record<string, string>; [key: string]: unknown }
export interface StageRecord {
  status: StageStatus; fingerprint: string; contractVersion?: number; startedAt: string; finishedAt?: string;
  durationMs?: number; result?: StageResult; error?: string;
}
export interface RunState { schemaVersion: '1.0'; stages: Record<string, StageRecord> }

export function safeProjectId(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw new Error('Invalid project identifier');
  return id;
}
export async function exists(file: string): Promise<boolean> {
  try { return (await stat(file)).isFile(); } catch { return false; }
}
export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}
export async function readState(project: string): Promise<RunState> {
  const file = path.join(project, 'run-state.json');
  if (!await exists(file)) return { schemaVersion: '1.0', stages: {} };
  return JSON.parse(await readFile(file, 'utf8')) as RunState;
}
export async function hashFiles(files: string[], extra: unknown = null): Promise<string> {
  const hash = createHash('sha256').update(JSON.stringify(extra));
  for (const file of [...files].sort()) {
    hash.update(file);
    for await (const chunk of createReadStream(file)) hash.update(chunk);
  }
  return hash.digest('hex');
}
export function digest(data: string | Buffer): string { return createHash('sha256').update(data).digest('hex'); }

function persistentOutputPath(project: string, output: string): string {
  const absolute = path.resolve(project, output);
  const relative = path.relative(project, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Stage output must stay inside its project: ${output}`);
  }
  return relative.replaceAll('\\', '/');
}

function runtimeOutputPath(project: string, output: string): string {
  if (path.isAbsolute(output) || path.win32.isAbsolute(output)) {
    throw new Error('Absolute output paths are not valid in persisted run state');
  }
  return path.resolve(project, output);
}

async function outputHashes(project: string, outputs: string[]): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const output of outputs) hashes[output] = digest(await readFile(runtimeOutputPath(project, output)));
  return hashes;
}

async function cachedOutputsMatch(project: string, result: StageResult): Promise<boolean> {
  if (!result.outputHashes) return false;
  for (const output of result.outputs) {
    let absolute: string;
    try {
      absolute = runtimeOutputPath(project, output);
    } catch {
      return false;
    }
    if (!await exists(absolute)) return false;
    const expected = result.outputHashes[output];
    if (!expected || digest(await readFile(absolute)) !== expected) return false;
  }
  return Object.keys(result.outputHashes).length === result.outputs.length;
}

function runtimeResult(project: string, result: StageResult): StageResult {
  const outputs = result.outputs.map((output) => runtimeOutputPath(project, output));
  const hashes = result.outputHashes
    ? Object.fromEntries(outputs.map((output, index) => [output, result.outputHashes![result.outputs[index]!]]))
    : undefined;
  return { ...result, outputs, ...(hashes ? { outputHashes: hashes } : {}) };
}

interface ProjectLock {
  pid: number;
  token: string;
  createdAt: string;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function acquireProjectLock(project: string): Promise<() => Promise<void>> {
  await mkdir(project, { recursive: true });
  const file = path.join(project, '.pipeline.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const lock: ProjectLock = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
    try {
      const handle = await open(file, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify(lock)}\n`);
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          const current = JSON.parse(await readFile(file, 'utf8')) as Partial<ProjectLock>;
          if (current.token === lock.token) await unlink(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let owner: Partial<ProjectLock> | undefined;
      try {
        owner = JSON.parse(await readFile(file, 'utf8')) as Partial<ProjectLock>;
      } catch {
        const ageMs = Date.now() - (await stat(file)).mtimeMs;
        if (ageMs < 300_000) throw new Error('Project pipeline is already running (lock owner is unreadable)');
      }
      if (owner?.pid && processIsAlive(owner.pid)) {
        throw new Error(`Project pipeline is already running in process ${owner.pid}`);
      }
      await unlink(file).catch((unlinkError: NodeJS.ErrnoException) => {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      });
    }
  }
  throw new Error('Could not acquire project pipeline lock');
}

export async function runStage(
  project: string, name: string, fingerprint: string, resume: boolean,
  operation: () => Promise<StageResult>,
  contractVersion = 1,
): Promise<{ cached: boolean; result: StageResult }> {
  if (!Number.isInteger(contractVersion) || contractVersion < 1) throw new Error('Stage contract version must be a positive integer');
  const releaseLock = await acquireProjectLock(project);
  try {
    const state = await readState(project);
    const old = state.stages[name];
    if (resume && old?.status === 'PASS' && (old.contractVersion ?? 1) === contractVersion && old.fingerprint === fingerprint && old.result &&
        await cachedOutputsMatch(project, old.result)) {
      if (old.contractVersion === undefined) {
        old.contractVersion = 1;
        await atomicJson(path.join(project, 'run-state.json'), state);
      }
      return { cached: true, result: runtimeResult(project, old.result) };
    }
    const start = performance.now();
    const record: StageRecord = { status: 'RUNNING', fingerprint, contractVersion, startedAt: new Date().toISOString() };
    state.stages[name] = record;
    await atomicJson(path.join(project, 'run-state.json'), state);
    try {
      const operationResult = await operation();
      const absoluteOutputs = operationResult.outputs.map((output) => path.resolve(project, output));
      const persistedOutputs = absoluteOutputs.map((output) => persistentOutputPath(project, output));
      const persistedResult = {
        ...operationResult,
        outputs: persistedOutputs,
        outputHashes: await outputHashes(project, persistedOutputs),
      };
      Object.assign(record, { status: 'PASS', result: persistedResult, finishedAt: new Date().toISOString(), durationMs: performance.now() - start });
      await atomicJson(path.join(project, 'run-state.json'), state);
      return { cached: false, result: runtimeResult(project, persistedResult) };
    } catch (error) {
      Object.assign(record, { status: 'FAIL', error: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString(), durationMs: performance.now() - start });
      await atomicJson(path.join(project, 'run-state.json'), state);
      throw error;
    }
  } finally {
    await releaseLock();
  }
}
