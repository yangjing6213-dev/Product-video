import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const setupModuleUrl = new URL('../../scripts/setup-local.mjs', import.meta.url);

async function setupModule() {
  return import(setupModuleUrl.href);
}

test('creates a repository-local environment file and cache directory without system changes', async () => {
  const { ensureEnvironment, expectedEnvironment } = await setupModule();
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'epvs setup with spaces '));
  const expected = expectedEnvironment(repositoryRoot);

  const result = await ensureEnvironment(repositoryRoot, expected);

  assert.equal(result.action, 'created');
  assert.deepEqual(JSON.parse(await readFile(path.join(repositoryRoot, '.tools/environment.json'), 'utf8')), expected);
  assert.equal((await import('node:fs')).existsSync(expected.HYPERFRAMES_EXTRACT_CACHE_DIR), true);
});

test('refuses to overwrite a different existing environment configuration', async () => {
  const { ensureEnvironment, expectedEnvironment } = await setupModule();
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'epvs setup preserve '));
  await mkdir(path.join(repositoryRoot, '.tools'), { recursive: true });
  const existing = { HYPERFRAMES_BROWSER_PATH: 'D:\\existing\\chrome.exe', ownerSetting: 'preserve-me' };
  const environmentPath = path.join(repositoryRoot, '.tools/environment.json');
  await writeFile(environmentPath, `${JSON.stringify(existing, null, 2)}\n`);

  await assert.rejects(ensureEnvironment(repositoryRoot, expectedEnvironment(repositoryRoot)), /different existing configuration/i);
  assert.deepEqual(JSON.parse(await readFile(environmentPath, 'utf8')), existing);
});

test('an existing tool is verified without invoking its installer', async () => {
  const { ensureArtifact } = await setupModule();
  const root = await mkdtemp(path.join(tmpdir(), 'epvs setup artifact '));
  const artifact = path.join(root, 'tool.exe');
  await writeFile(artifact, 'existing tool');
  let verified = 0;
  let installed = 0;

  const result = await ensureArtifact(
    artifact,
    async () => { verified += 1; return { sha256: 'observed' }; },
    async () => { installed += 1; },
    true,
  );

  assert.equal(result.action, 'verified-existing');
  assert.equal(verified, 1);
  assert.equal(installed, 0);
});

test('verify-only mode refuses a missing tool without installing it', async () => {
  const { ensureArtifact } = await setupModule();
  const root = await mkdtemp(path.join(tmpdir(), 'epvs setup missing '));
  const artifact = path.join(root, 'missing.exe');
  let installed = 0;

  await assert.rejects(
    ensureArtifact(artifact, async () => ({}), async () => { installed += 1; }, false),
    /missing in verify-only mode/i,
  );
  assert.equal(installed, 0);
});

test('doctor assessment treats missing TTS, whisper, music and Docker as optional for narration none', async () => {
  const { assessDoctor } = await setupModule();
  const result = assessDoctor({
    ok: false,
    checks: [
      { name: 'Node.js', ok: true, detail: 'v24.19.0' },
      { name: 'Chrome', ok: true, detail: '152.0.7977.30' },
      { name: 'FFmpeg', ok: true, detail: '6.1.1' },
      { name: 'whisper-cpp', ok: false, detail: 'Not found (optional)' },
      { name: 'TTS (Kokoro)', ok: false, detail: 'Not installed (optional)' },
      { name: 'BGM (MusicGen)', ok: false, detail: 'Not installed (optional)' },
      { name: 'Docker', ok: false, detail: 'Not found' },
      { name: 'Docker running', ok: false, detail: 'Not running' },
    ],
  });

  assert.equal(result.status, 'PASS');
  assert.equal(result.optionalUnavailable.length, 5);
  assert.deepEqual(result.coreFailures, []);
});

test('doctor assessment keeps a required tool failure blocking', async () => {
  const { assessDoctor } = await setupModule();
  const result = assessDoctor({
    ok: false,
    checks: [{ name: 'Chrome', ok: false, detail: 'Not found' }],
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.coreFailures[0].name, 'Chrome');
});

test('Node version gate accepts later majors and rejects versions below 24.15', async () => {
  const { assertNodeVersion } = await setupModule();

  assert.doesNotThrow(() => assertNodeVersion('v24.19.0'));
  assert.doesNotThrow(() => assertNodeVersion('v25.0.0'));
  assert.throws(() => assertNodeVersion('v24.14.9'), /24\.15 or newer/i);
});

test('README and local setup guide document reproducible verification and redistribution boundary', async () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const readText = async (relativePath: string) => readFile(path.join(repositoryRoot, relativePath), 'utf8');
  const readme = await readText('README.md');
  const guide = await readText('docs/guides/LOCAL-SETUP.md');

  assert.match(readme, /node scripts\/setup-local\.mjs --verify-only/);
  assert.match(readme, /LOCAL-SETUP\.md/);
  for (const expected of [
    '152.0.7977.30',
    '5d7df999a6e4a65a1b16b25b61064f7337b8aa8ee2ed1b4e07bfdd24f6e4275e',
    '6.1.1',
    '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
    'ffprobe-static',
  ]) assert.match(guide, new RegExp(expected.replaceAll('.', '\\.')));
  assert.match(guide, /does not require administrator|不需要管理员/i);
  assert.match(guide, /does not modify the system|不修改系统/i);
  assert.match(guide, /GPL/i);
  assert.match(guide, /not redistributed|不重新分发/i);
  assert.match(guide, /narrationMode=none/);
});
