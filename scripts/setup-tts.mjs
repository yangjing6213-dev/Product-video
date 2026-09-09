import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const ONE_MIB = 1024 * 1024;

export const TTS_TOOLCHAIN = Object.freeze({
  pythonVersion: '3.12.14',
  packages: Object.freeze({
    addict: '2.4.0',
    attrs: '26.1.0',
    cffi: '2.1.1',
    cloudpickle: '3.1.2',
    cn2an: '0.5.24',
    dlinfo: '2.0.0',
    'espeakng-loader': '0.2.4',
    flatbuffers: '25.12.19',
    jieba: '0.42.1',
    joblib: '1.6.0',
    'kokoro-onnx': '0.6.1',
    misaki: '0.9.4',
    numpy: '2.5.3',
    onnxruntime: '1.29.0',
    'ordered-set': '4.1.0',
    packaging: '26.3',
    phonemizer: '3.4.0',
    proces: '0.1.7',
    protobuf: '7.36.1',
    pycparser: '3.0',
    pypinyin: '0.55.0',
    'pypinyin-dict': '0.9.0',
    regex: '2026.9.3',
    soundfile: '0.14.0',
    typing_extensions: '4.16.0',
  }),
  model: Object.freeze({
    version: 'v1.1-zh',
    fileName: 'kokoro-v1.1-zh.onnx',
    size: 325_506_167,
    sha256: '859f9ded9f53be16c24857cdab3254a45da53c3afd5ba6ef134c7de3f822e326',
    sourceUrl: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.1-zh.onnx',
  }),
  voices: Object.freeze({
    fileName: 'voices-v1.1-zh.bin',
    size: 53_815_880,
    sha256: '14cb6186c99e4f6016871405f62046c5df863ae27465cbdc4ee08be7dd703acd',
    sourceUrl: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.1-zh.bin',
  }),
});

export function ttsPaths(repositoryRoot) {
  return {
    venv: path.join(repositoryRoot, '.tools', 'tts-venv'),
    python: path.join(repositoryRoot, '.tools', 'tts-venv', 'Scripts', 'python.exe'),
    models: path.join(repositoryRoot, '.tools', 'tts-models'),
    model: path.join(repositoryRoot, '.tools', 'tts-models', TTS_TOOLCHAIN.model.fileName),
    voices: path.join(repositoryRoot, '.tools', 'tts-models', TTS_TOOLCHAIN.voices.fileName),
    config: path.join(repositoryRoot, '.tools', 'tts-config.json'),
    requirements: path.join(repositoryRoot, 'scripts', 'requirements-tts.txt'),
  };
}

export function expectedTtsConfig(_repositoryRoot, manifest = TTS_TOOLCHAIN) {
  return {
    schemaVersion: '1.0',
    backend: 'kokoro-onnx',
    pythonPath: '.tools/tts-venv/Scripts/python.exe',
    model: {
      version: manifest.model.version,
      path: `.tools/tts-models/${manifest.model.fileName}`,
      sha256: manifest.model.sha256,
      sourceUrl: manifest.model.sourceUrl,
    },
    voices: {
      path: `.tools/tts-models/${manifest.voices.fileName}`,
      sha256: manifest.voices.sha256,
      sourceUrl: manifest.voices.sourceUrl,
    },
    g2p: { package: 'misaki', version: '0.9.4', language: 'zh', modelVersion: '1.1' },
    synthesis: { defaultVoice: 'zf_001', sampleRate: 24000, timingGranularity: 'phrase' },
    packages: { 'kokoro-onnx': '0.6.1', misaki: '0.9.4', soundfile: '0.14.0' },
  };
}

export function runCommand(executable, args, options = {}) {
  const startedAt = performance.now();
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    command: [executable, ...args],
    exitCode: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? '',
    stderr: `${result.stderr ?? ''}${result.error ? result.error.message : ''}`,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

function requireSuccess(result, label) {
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(-1600);
    throw new Error(`${label} failed (exit ${result.exitCode}): ${detail}`);
  }
  return result;
}

export async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyFile(file, expectedSha256, expectedSize) {
  const details = await stat(file);
  if (expectedSize != null && details.size !== expectedSize) {
    throw new Error(`Size mismatch at ${file}: expected ${expectedSize}, observed ${details.size}`);
  }
  const observed = await sha256File(file);
  if (observed !== expectedSha256) {
    throw new Error(`SHA-256 mismatch at ${file}: expected ${expectedSha256}, observed ${observed}; refusing to overwrite existing file`);
  }
  return { path: file, size: details.size, sha256: observed };
}

function wait(milliseconds) {
  if (!milliseconds) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestRange(url, start, end, options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 250;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { Range: `bytes=${start}-${end}` },
        redirect: 'follow',
      });
      if (response.status === 403 || response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        throw new Error(`Download stopped on HTTP ${response.status}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`);
      }
      if (response.status !== 206) {
        if ((response.status === 408 || response.status === 425 || response.status >= 500) && attempt < maxRetries) {
          lastError = new Error(`HTTP ${response.status}`);
          await wait(retryDelayMs * (attempt + 1));
          continue;
        }
        throw new Error(`Download failed with HTTP ${response.status}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentRange = response.headers.get('content-range');
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange ?? '');
      if (!match) throw new Error(`Missing or invalid Content-Range for ${start}-${end}`);
      const actualStart = Number(match[1]);
      const actualEnd = Number(match[2]);
      const total = Number(match[3]);
      if (actualStart !== start || bytes.length !== actualEnd - actualStart + 1) {
        throw new Error(`Invalid range body for ${start}-${end}`);
      }
      return { bytes, total, fullResponse: false };
    } catch (error) {
      if (error instanceof Error && /HTTP (403|429)/.test(error.message)) throw error;
      lastError = error;
      if (attempt >= maxRetries) break;
      await wait(retryDelayMs * (attempt + 1));
    }
  }
  throw new Error(`Download range ${start}-${end} failed after ${maxRetries + 1} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function writePart(partsDirectory, start, end, bytes) {
  const partPath = path.join(partsDirectory, `${start}-${end}.part`);
  if (existsSync(partPath)) {
    const current = await stat(partPath);
    if (current.size !== bytes.length) throw new Error(`Refusing to overwrite different existing download part: ${partPath}`);
    return partPath;
  }
  await writeFile(partPath, bytes, { flag: 'wx' });
  return partPath;
}

async function publishParts(parts, destination, expectedSha256, expectedSize) {
  const temporary = `${destination}.download-${process.pid}-${Date.now()}`;
  const output = await open(temporary, 'wx');
  try {
    for (const part of parts) await output.writeFile(await readFile(part));
  } finally {
    await output.close();
  }
  try {
    await verifyFile(temporary, expectedSha256, expectedSize);
    await copyFile(temporary, destination, constants.COPYFILE_EXCL);
    return await verifyFile(destination, expectedSha256, expectedSize);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function downloadInRanges(url, destination, options) {
  const expectedSha256 = options.expectedSha256;
  if (existsSync(destination)) return { action: 'verified-existing', ...await verifyFile(destination, expectedSha256, options.expectedSize) };
  const chunkSize = options.chunkSize ?? ONE_MIB;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error('chunkSize must be a positive integer');
  await mkdir(path.dirname(destination), { recursive: true });
  const partsDirectory = `${destination}.parts`;
  await mkdir(partsDirectory, { recursive: true });

  const first = await requestRange(url, 0, chunkSize - 1, options);
  const firstEnd = first.bytes.length - 1;
  const parts = [await writePart(partsDirectory, 0, firstEnd, first.bytes)];
  if (!first.fullResponse) {
    for (let start = firstEnd + 1; start < first.total; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, first.total - 1);
      const range = await requestRange(url, start, end, options);
      if (range.fullResponse || range.total !== first.total) throw new Error(`Inconsistent ranged download response for ${start}-${end}`);
      parts.push(await writePart(partsDirectory, start, end, range.bytes));
    }
  }

  const verified = await publishParts(parts, destination, expectedSha256, options.expectedSize);
  await rm(partsDirectory, { recursive: true, force: true });
  return { action: 'downloaded', ...verified };
}

export async function ensureVerifiedArtifact(options) {
  if (existsSync(options.path)) {
    return { action: 'verified-existing', ...await verifyFile(options.path, options.expectedSha256, options.expectedSize) };
  }
  if (!options.allowInstall) throw new Error(`${options.path} is missing in verify-only mode`);
  const downloader = options.downloader ?? ((url, destination, downloadOptions) => downloadInRanges(url, destination, downloadOptions));
  await downloader(options.sourceUrl, options.path, {
    expectedSha256: options.expectedSha256,
    expectedSize: options.expectedSize,
    chunkSize: ONE_MIB,
    maxRetries: 2,
  });
  if (!existsSync(options.path)) throw new Error(`Downloader did not create ${options.path}`);
  return { action: 'downloaded', ...await verifyFile(options.path, options.expectedSha256, options.expectedSize) };
}

export async function ensureTtsConfig(repositoryRoot, expected, allowCreate = true) {
  const configPath = path.join(repositoryRoot, '.tools', 'tts-config.json');
  if (existsSync(configPath)) {
    const current = JSON.parse(await readFile(configPath, 'utf8'));
    if (!isDeepStrictEqual(current, expected)) throw new Error(`Refusing to overwrite different existing TTS configuration: ${configPath}`);
    return { action: 'verified-existing', path: configPath, values: current };
  }
  if (!allowCreate) throw new Error(`${configPath} is missing in verify-only mode`);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(expected, null, 2)}\n`, { flag: 'wx' });
  return { action: 'created', path: configPath, values: expected };
}

function parseJsonOutput(result, label) {
  requireSuccess(result, label);
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  try {
    return JSON.parse(lines.at(-1) ?? '');
  } catch {
    throw new Error(`${label} did not return JSON: ${result.stdout.trim().slice(-800)}`);
  }
}

function verifyPythonVersion(python, expectedVersion, runner, repositoryRoot) {
  const result = requireSuccess(runner(python, ['--version'], { cwd: repositoryRoot }), 'Python version check');
  const observed = `${result.stdout}\n${result.stderr}`.trim();
  if (!observed.includes(`Python ${expectedVersion}`)) {
    throw new Error(`Expected Python ${expectedVersion}, observed ${observed}`);
  }
  return { ...result, version: expectedVersion };
}

async function ensureVenv(repositoryRoot, allowInstall, basePython, manifest, runner) {
  const paths = ttsPaths(repositoryRoot);
  if (existsSync(paths.python)) {
    return { action: 'verified-existing', path: paths.python, evidence: verifyPythonVersion(paths.python, manifest.pythonVersion, runner, repositoryRoot) };
  }
  if (!allowInstall) throw new Error(`${paths.python} is missing in verify-only mode`);
  if (existsSync(paths.venv)) throw new Error(`Refusing to overwrite incomplete existing virtual environment: ${paths.venv}`);
  if (!basePython) throw new Error('Use --python <path-to-Python-3.12.14> when creating the local TTS virtual environment');
  verifyPythonVersion(basePython, manifest.pythonVersion, runner, repositoryRoot);
  requireSuccess(runner(basePython, ['-m', 'venv', paths.venv], { cwd: repositoryRoot, timeoutMs: 5 * 60_000 }), 'TTS virtual environment creation');
  if (!existsSync(paths.python)) throw new Error(`Virtual environment did not create ${paths.python}`);
  requireSuccess(runner(paths.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--requirement', paths.requirements], {
    cwd: repositoryRoot,
    timeoutMs: 15 * 60_000,
  }), 'Pinned TTS dependency installation');
  return { action: 'created', path: paths.python, evidence: verifyPythonVersion(paths.python, manifest.pythonVersion, runner, repositoryRoot) };
}

function verifyPackages(python, expected, runner, repositoryRoot) {
  const names = Object.keys(expected);
  const code = 'import json,importlib.metadata as metadata,sys; names=json.loads(sys.argv[1]); print(json.dumps({name:metadata.version(name) for name in names}))';
  const command = runner(python, ['-c', code, JSON.stringify(names)], { cwd: repositoryRoot, timeoutMs: 60_000 });
  const observed = parseJsonOutput(command, 'TTS package version check');
  const mismatches = names.filter((name) => observed[name] !== expected[name]);
  if (mismatches.length) {
    throw new Error(`Pinned TTS package mismatch: ${mismatches.map((name) => `${name} expected ${expected[name]}, observed ${observed[name] ?? 'missing'}`).join('; ')}`);
  }
  return { status: 'PASS', expected, observed, command };
}

function verifyG2pAndVoice(python, modelPath, voicesPath, defaultVoice, runner, repositoryRoot) {
  const code = [
    'import json,sys',
    'from misaki import zh',
    'from kokoro_onnx import Kokoro',
    'g2p=zh.ZHG2P(version="1.1")',
    'phonemes,_=g2p("中文语音核验。")',
    'model=Kokoro(sys.argv[1],sys.argv[2])',
    'voices=model.get_voices()',
    'print(json.dumps({"g2pVersion":"1.1","phonemeCount":len(phonemes),"defaultVoiceAvailable":sys.argv[3] in voices,"voiceCount":len(voices)}))',
  ].join(';');
  const command = runner(python, ['-c', code, modelPath, voicesPath, defaultVoice], { cwd: repositoryRoot, timeoutMs: 5 * 60_000 });
  const observed = parseJsonOutput(command, 'Chinese G2P and voice configuration check');
  if (observed.g2pVersion !== '1.1' || !Number.isInteger(observed.phonemeCount) || observed.phonemeCount < 1) {
    throw new Error('Misaki Chinese G2P v1.1 did not produce phonemes');
  }
  if (observed.defaultVoiceAvailable !== true) throw new Error(`Configured voice ${defaultVoice} is absent from the voice data`);
  return {
    g2p: { status: 'PASS', version: observed.g2pVersion, phonemeCount: observed.phonemeCount },
    voiceConfiguration: { status: 'PASS', defaultVoice, voiceCount: observed.voiceCount },
    command,
  };
}

export async function prepareTts(options = {}) {
  if (process.platform !== 'win32') throw new Error('This setup script prepares the pinned Windows local TTS toolchain only');
  const repositoryRoot = path.resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
  const allowInstall = options.allowInstall ?? true;
  const manifest = options.manifest ?? TTS_TOOLCHAIN;
  const runner = options.runner ?? runCommand;
  const paths = ttsPaths(repositoryRoot);
  const expectedConfig = expectedTtsConfig(repositoryRoot, manifest);

  const python = await ensureVenv(repositoryRoot, allowInstall, options.basePython, manifest, runner);
  const packages = verifyPackages(paths.python, manifest.packages, runner, repositoryRoot);
  const model = await ensureVerifiedArtifact({
    path: path.join(paths.models, manifest.model.fileName),
    expectedSha256: manifest.model.sha256,
    expectedSize: manifest.model.size,
    sourceUrl: manifest.model.sourceUrl,
    allowInstall,
    downloader: options.downloader,
  });
  const voices = await ensureVerifiedArtifact({
    path: path.join(paths.models, manifest.voices.fileName),
    expectedSha256: manifest.voices.sha256,
    expectedSize: manifest.voices.size,
    sourceUrl: manifest.voices.sourceUrl,
    allowInstall,
    downloader: options.downloader,
  });
  const configuration = await ensureTtsConfig(repositoryRoot, expectedConfig, allowInstall);
  const probe = verifyG2pAndVoice(
    paths.python,
    path.join(paths.models, manifest.model.fileName),
    path.join(paths.models, manifest.voices.fileName),
    expectedConfig.synthesis.defaultVoice,
    runner,
    repositoryRoot,
  );

  return {
    schemaVersion: '1.0',
    status: 'PASS',
    mode: allowInstall ? 'prepare-missing' : 'verify-only',
    repositoryRoot,
    python,
    packages,
    artifacts: { model, voices },
    configuration,
    verification: {
      g2p: probe.g2p,
      voiceConfiguration: probe.voiceConfiguration,
      synthesis: {
        status: 'NOT_RUN',
        detail: 'Package, model, G2P and voice checks do not prove audio synthesis; run the separate synthesis smoke test.',
      },
      asr: { status: 'NOT_RUN', detail: 'ASR installation and word-level transcription are outside this setup.' },
    },
    licenseNote: 'Private local use only. Do not redistribute the environment or binaries without reviewing bundled MIT, Apache-2.0, BSD-3-Clause, LGPL and GPL-3.0-or-later notices and source obligations.',
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      'verify-only': { type: 'boolean', default: false },
      'repo-root': { type: 'string' },
      python: { type: 'string' },
    },
  });
  const report = await prepareTts({
    repositoryRoot: values['repo-root'],
    allowInstall: !values['verify-only'],
    basePython: values.python,
  });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: 'FAIL', error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
