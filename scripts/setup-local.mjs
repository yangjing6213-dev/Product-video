import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');

export const TOOLCHAIN = Object.freeze({
  chrome: {
    version: '152.0.7977.30',
    sourceUrl: 'https://storage.googleapis.com/chrome-for-testing-public/152.0.7977.30/win64/chrome-headless-shell-win64.zip',
    archiveSha256: '5d7df999a6e4a65a1b16b25b61064f7337b8aa8ee2ed1b4e07bfdd24f6e4275e',
    executableSha256: '909fa4a0d2866f5b5b6cabd0a3b3545edeaf84db361148dbc8e992e25e61e7e6',
  },
  ffmpeg: {
    version: '6.1.1',
    sourceUrl: 'https://api.github.com/repos/eugeneware/ffmpeg-static/releases/assets/316528798',
    gzipSha256: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
    executableSha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
  },
  ffprobe: {
    version: '4.0.2',
    packageVersion: '3.1.0',
    executableSha256: '4303ec85855340689b1f8aa5d9c1dc06ef3e3090682de3034edc3fca2b0798d5',
  },
  hyperframes: { version: '0.8.33' },
});

export function toolPaths(repositoryRoot) {
  return {
    chromeArchive: path.join(repositoryRoot, '.tools', 'chrome-complete.zip'),
    chromeDirectory: path.join(repositoryRoot, '.tools', 'chrome'),
    chrome: path.join(repositoryRoot, '.tools', 'chrome', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
    ffmpegGzip: path.join(repositoryRoot, '.tools', 'ffmpeg-6.1.1.exe.gz'),
    ffmpeg: path.join(repositoryRoot, '.tools', 'ffmpeg-6.1.1.exe'),
    ffprobe: path.join(repositoryRoot, 'node_modules', 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe'),
    hyperframes: path.join(repositoryRoot, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs'),
    downloadScript: path.join(repositoryRoot, 'scripts', 'download-portable.mjs'),
    environment: path.join(repositoryRoot, '.tools', 'environment.json'),
    cache: path.join(repositoryRoot, '.cache', 'frames'),
  };
}

export function expectedEnvironment(repositoryRoot) {
  const tools = toolPaths(repositoryRoot);
  return {
    HYPERFRAMES_BROWSER_PATH: tools.chrome,
    HYPERFRAMES_FFMPEG_PATH: tools.ffmpeg,
    HYPERFRAMES_FFPROBE_PATH: tools.ffprobe,
    HYPERFRAMES_EXTRACT_CACHE_DIR: tools.cache,
  };
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

export async function ensureEnvironment(repositoryRoot, expected = expectedEnvironment(repositoryRoot)) {
  const tools = toolPaths(repositoryRoot);
  if (existsSync(tools.environment)) {
    const current = JSON.parse(await readFile(tools.environment, 'utf8'));
    const conflicts = Object.entries(expected).filter(([key, value]) => typeof current[key] !== 'string' || !samePath(current[key], value));
    if (conflicts.length) {
      throw new Error(`Refusing to overwrite different existing configuration in ${tools.environment}: ${conflicts.map(([key]) => key).join(', ')}`);
    }
    await mkdir(expected.HYPERFRAMES_EXTRACT_CACHE_DIR, { recursive: true });
    return { action: 'verified-existing', path: tools.environment, values: current };
  }

  await mkdir(path.dirname(tools.environment), { recursive: true });
  await mkdir(expected.HYPERFRAMES_EXTRACT_CACHE_DIR, { recursive: true });
  await writeFile(tools.environment, `${JSON.stringify(expected, null, 2)}\n`, { flag: 'wx' });
  return { action: 'created', path: tools.environment, values: expected };
}

export async function sha256File(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function verifyHash(file, expected, label) {
  const observed = await sha256File(file);
  if (observed !== expected) throw new Error(`${label} SHA-256 mismatch at ${file}: ${observed}`);
  return observed;
}

export async function ensureArtifact(file, verify, install, allowInstall) {
  if (existsSync(file)) return { action: 'verified-existing', evidence: await verify(file) };
  if (!allowInstall) throw new Error(`${file} is missing in verify-only mode`);
  await install(file);
  if (!existsSync(file)) throw new Error(`Installer did not create ${file}`);
  return { action: 'installed', evidence: await verify(file) };
}

export function runCommand(executable, args, options = {}) {
  const startedAt = performance.now();
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeoutMs ?? 30_000,
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
  if (result.exitCode !== 0) throw new Error(`${label} failed (exit ${result.exitCode}): ${(result.stderr || result.stdout).trim().slice(-1600)}`);
  return result;
}

function requireVersion(result, expected, label) {
  requireSuccess(result, label);
  const text = `${result.stdout}\n${result.stderr}`;
  if (!text.includes(expected)) throw new Error(`${label} did not report expected version ${expected}: ${text.trim().slice(-800)}`);
  return result;
}

async function downloadPortable(repositoryRoot, sourceUrl, destination, runner) {
  const tools = toolPaths(repositoryRoot);
  if (!existsSync(tools.downloadScript)) throw new Error(`Missing downloader: ${tools.downloadScript}`);
  requireSuccess(runner(process.execPath, [tools.downloadScript, sourceUrl, destination], { cwd: repositoryRoot, timeoutMs: 20 * 60_000 }), 'Portable download');
}

function powershellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function prepareChrome(repositoryRoot, allowInstall, runner) {
  const tools = toolPaths(repositoryRoot);
  const archive = async () => ensureArtifact(
    tools.chromeArchive,
    async (file) => ({ sha256: await verifyHash(file, TOOLCHAIN.chrome.archiveSha256, 'Chrome archive') }),
    async (file) => downloadPortable(repositoryRoot, TOOLCHAIN.chrome.sourceUrl, file, runner),
    allowInstall,
  );
  const executable = await ensureArtifact(
    tools.chrome,
    async (file) => ({
      sha256: await verifyHash(file, TOOLCHAIN.chrome.executableSha256, 'Chrome executable'),
      version: requireVersion(runner(file, ['--version'], { cwd: repositoryRoot }), TOOLCHAIN.chrome.version, 'Chrome'),
    }),
    async () => {
      await archive();
      if (existsSync(tools.chromeDirectory)) throw new Error(`Refusing to extract over existing Chrome directory: ${tools.chromeDirectory}`);
      const command = `Expand-Archive -LiteralPath ${powershellLiteral(tools.chromeArchive)} -DestinationPath ${powershellLiteral(tools.chromeDirectory)}`;
      requireSuccess(runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd: repositoryRoot, timeoutMs: 5 * 60_000 }), 'Chrome extraction');
    },
    allowInstall,
  );
  const archiveEvidence = existsSync(tools.chromeArchive)
    ? { present: true, sha256: await verifyHash(tools.chromeArchive, TOOLCHAIN.chrome.archiveSha256, 'Chrome archive') }
    : { present: false };
  return { ...executable, sourceUrl: TOOLCHAIN.chrome.sourceUrl, archive: archiveEvidence };
}

async function prepareFfmpeg(repositoryRoot, allowInstall, runner) {
  const tools = toolPaths(repositoryRoot);
  const result = await ensureArtifact(
    tools.ffmpeg,
    async (file) => ({
      sha256: await verifyHash(file, TOOLCHAIN.ffmpeg.executableSha256, 'FFmpeg executable'),
      version: requireVersion(runner(file, ['-version'], { cwd: repositoryRoot }), TOOLCHAIN.ffmpeg.version, 'FFmpeg'),
    }),
    async (file) => {
      await ensureArtifact(
        tools.ffmpegGzip,
        async (gzip) => ({ sha256: await verifyHash(gzip, TOOLCHAIN.ffmpeg.gzipSha256, 'FFmpeg gzip') }),
        async (gzip) => downloadPortable(repositoryRoot, TOOLCHAIN.ffmpeg.sourceUrl, gzip, runner),
        allowInstall,
      );
      await verifyHash(tools.ffmpegGzip, TOOLCHAIN.ffmpeg.gzipSha256, 'FFmpeg gzip');
      await writeFile(file, gunzipSync(await readFile(tools.ffmpegGzip)), { flag: 'wx' });
    },
    allowInstall,
  );
  return { ...result, sourceUrl: TOOLCHAIN.ffmpeg.sourceUrl, gzipSha256: TOOLCHAIN.ffmpeg.gzipSha256 };
}

async function verifyFfprobe(repositoryRoot, runner) {
  const tools = toolPaths(repositoryRoot);
  if (!existsSync(tools.ffprobe)) throw new Error(`Pinned ffprobe-static executable is missing: ${tools.ffprobe}. Restore repository-local npm dependencies; do not install globally.`);
  return {
    action: 'verified-existing',
    package: `ffprobe-static@${TOOLCHAIN.ffprobe.packageVersion}`,
    evidence: {
      sha256: await verifyHash(tools.ffprobe, TOOLCHAIN.ffprobe.executableSha256, 'FFprobe executable'),
      version: requireVersion(runner(tools.ffprobe, ['-version'], { cwd: repositoryRoot }), TOOLCHAIN.ffprobe.version, 'FFprobe'),
    },
  };
}

const OPTIONAL_DOCTOR_CHECKS = new Set(['Version', 'whisper-cpp', 'TTS (Kokoro)', 'BGM (MusicGen)', 'Docker', 'Docker running']);

export function assessDoctor(report) {
  if (!report || !Array.isArray(report.checks)) throw new Error('HyperFrames doctor did not return a checks array');
  const optionalUnavailable = report.checks.filter((check) => OPTIONAL_DOCTOR_CHECKS.has(check.name) && !check.ok);
  const coreFailures = report.checks.filter((check) => !OPTIONAL_DOCTOR_CHECKS.has(check.name) && !check.ok);
  return { status: coreFailures.length ? 'FAIL' : 'PASS', coreFailures, optionalUnavailable };
}

export function assertNodeVersion(versionText) {
  const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(versionText.trim());
  if (!match || Number(match[1]) < 24 || (Number(match[1]) === 24 && Number(match[2]) < 15)) {
    throw new Error(`Node.js 24.15 or newer is required; observed ${versionText.trim()}`);
  }
}

function nodeVersionEvidence() {
  const result = requireSuccess(runCommand(process.execPath, ['--version']), 'Node.js');
  assertNodeVersion(result.stdout);
  return result;
}

export async function prepareLocal(options = {}) {
  if (process.platform !== 'win32') throw new Error('This setup script installs the pinned Windows x64 local toolchain only');
  const repositoryRoot = path.resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
  const allowInstall = options.allowInstall ?? true;
  const runner = options.runner ?? runCommand;
  const expected = expectedEnvironment(repositoryRoot);
  const environmentPath = toolPaths(repositoryRoot).environment;
  if (existsSync(environmentPath)) {
    const existing = JSON.parse(await readFile(environmentPath, 'utf8'));
    const conflicts = Object.entries(expected).filter(([key, value]) => typeof existing[key] !== 'string' || !samePath(existing[key], value));
    if (conflicts.length) throw new Error(`Refusing to overwrite different existing configuration in ${environmentPath}: ${conflicts.map(([key]) => key).join(', ')}`);
  }

  const node = nodeVersionEvidence();
  const chrome = await prepareChrome(repositoryRoot, allowInstall, runner);
  const ffmpeg = await prepareFfmpeg(repositoryRoot, allowInstall, runner);
  const ffprobe = await verifyFfprobe(repositoryRoot, runner);
  const environment = await ensureEnvironment(repositoryRoot, expected);
  const tools = toolPaths(repositoryRoot);
  if (!existsSync(tools.hyperframes)) throw new Error(`Pinned HyperFrames executable is missing: ${tools.hyperframes}. Restore repository-local npm dependencies; do not install globally.`);

  const commandEnvironment = {
    ...process.env,
    ...expected,
    HYPERFRAMES_NO_TELEMETRY: '1',
    HYPERFRAMES_NO_UPDATE_CHECK: '1',
    HYPERFRAMES_SKIP_SKILLS: '1',
    HF_NO_BROWSER: '1',
  };
  const hyperframes = requireVersion(runner(process.execPath, [tools.hyperframes, '--version'], { cwd: repositoryRoot, env: commandEnvironment }), TOOLCHAIN.hyperframes.version, 'HyperFrames');
  const doctorCommand = requireSuccess(runner(process.execPath, [tools.hyperframes, 'doctor', '--json'], { cwd: repositoryRoot, env: commandEnvironment, timeoutMs: 120_000 }), 'HyperFrames doctor');
  let doctorReport;
  try { doctorReport = JSON.parse(doctorCommand.stdout); }
  catch { throw new Error(`HyperFrames doctor did not return JSON: ${doctorCommand.stdout.trim().slice(-1600)}`); }
  const doctor = assessDoctor(doctorReport);

  return {
    schemaVersion: '1.0',
    status: doctor.status,
    mode: allowInstall ? 'prepare-missing' : 'verify-only',
    platform: { os: process.platform, arch: process.arch },
    repositoryRoot,
    environment,
    tools: { node, chrome, ffmpeg, ffprobe, hyperframes },
    doctor: { command: doctorCommand, report: doctorReport, ...doctor },
    narrationNoneReady: doctor.status === 'PASS',
    licenseNote: 'The pinned FFmpeg build enables GPL components. EPVS uses it for private local execution only and does not redistribute the binary.',
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      'verify-only': { type: 'boolean', default: false },
      'repo-root': { type: 'string' },
    },
  });
  const report = await prepareLocal({ repositoryRoot: values['repo-root'], allowInstall: !values['verify-only'] });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: 'FAIL', error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
