import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson } from './stage-state.ts';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export interface CommandResult { command: string[]; exitCode: number; stdout: string; stderr: string; durationMs: number }
export interface CommandOptions { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
export type CommandRunner = (executable: string, args: string[], options?: CommandOptions) => Promise<CommandResult>;
export function toolEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_SKIP_SKILLS: '1', HF_NO_BROWSER: '1' };
  return env;
}
export async function environment(): Promise<NodeJS.ProcessEnv> {
  const local = path.join(REPO, '.tools/environment.json');
  const localEnvironment = existsSync(local)
    ? JSON.parse(await readFile(local, 'utf8')) as NodeJS.ProcessEnv
    : {};
  return { ...localEnvironment, ...toolEnvironment() };
}
async function spawnCommand(executable: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd: options.cwd ?? REPO, env: options.env ?? toolEnvironment(), windowsHide: true, shell: false });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs ?? 180_000);
    child.stdout.on('data', (value: Buffer) => { stdout += value.toString(); });
    child.stderr.on('data', (value: Buffer) => { stderr += value.toString(); });
    child.on('error', error => { stderr += error.message; });
    child.on('close', code => { clearTimeout(timer); resolve({ command: [executable, ...args], exitCode: timedOut ? 124 : code ?? 1, stdout, stderr, durationMs: performance.now() - started }); });
  });
}
let activeCommandRunner: CommandRunner = spawnCommand;
export async function command(executable: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
  return activeCommandRunner(executable, args, options);
}
export function installCommandRunnerForTests(runner: CommandRunner): () => void {
  const previous = activeCommandRunner;
  activeCommandRunner = runner;
  let restored = false;
  return () => {
    if (restored) return;
    activeCommandRunner = previous;
    restored = true;
  };
}
export function redact(value: string): string {
  return value.replaceAll(REPO, '<repo>').replace(/[A-Za-z]:\\Users\\[^\\\r\n]+/g, '<user>')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/((?:token|api[_-]?key|cookie|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
}
export async function recordCommand(project: string, label: string, result: CommandResult): Promise<string> {
  const file = path.join(project, 'reports', 'commands', `${label}.json`);
  await atomicJson(file, { ...result, command: result.command.map(redact), stdout: redact(result.stdout), stderr: redact(result.stderr) });
  return file;
}
export async function hyperframes(args: string[], cwd = REPO, timeoutMs = 180_000): Promise<CommandResult> {
  return command(process.execPath, [path.join(REPO, 'node_modules/hyperframes/bin/hyperframes.mjs'), ...args], { cwd, env: await environment(), timeoutMs });
}
export function ensureSuccess(result: CommandResult, label: string): void {
  if (result.exitCode !== 0) throw new Error(`${label} failed (exit ${result.exitCode}): ${redact(result.stderr || result.stdout).slice(-1800)}`);
}
export async function filesUnder(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await filesUnder(file));
    else if (item.isFile()) files.push(file);
  }
  return files;
}
export async function prepareReports(project: string): Promise<void> { await mkdir(path.join(project, 'reports'), { recursive: true }); }
