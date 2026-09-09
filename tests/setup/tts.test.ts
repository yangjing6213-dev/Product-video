import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const setupModuleUrl = new URL('../../scripts/setup-tts.mjs', import.meta.url);

async function setupModule() {
  return import(setupModuleUrl.href);
}

function digest(value: Uint8Array | string) {
  return createHash('sha256').update(value).digest('hex');
}

test('downloads direct release assets in one MiB ranges and retries a transient range failure twice at most', async () => {
  const { downloadInRanges } = await setupModule();
  const content = Buffer.alloc(2 * 1024 * 1024 + 37, 0x5a);
  const ranges: string[] = [];
  let transientFailures = 0;
  const server = createServer((request, response) => {
    const range = request.headers.range ?? '';
    ranges.push(range);
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    assert.ok(match, `expected byte range, got ${range}`);
    const start = Number(match[1]);
    const requestedEnd = Number(match[2]);
    const end = Math.min(requestedEnd, content.length - 1);
    if (start === 1024 * 1024 && transientFailures === 0) {
      transientFailures += 1;
      response.writeHead(503);
      response.end('try again');
      return;
    }
    response.writeHead(206, {
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${content.length}`,
    });
    response.end(content.subarray(start, end + 1));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const root = await mkdtemp(path.join(tmpdir(), 'epvs tts download '));
  const destination = path.join(root, 'model.onnx');

  try {
    const result = await downloadInRanges(`http://127.0.0.1:${address.port}/model`, destination, {
      expectedSha256: digest(content),
      chunkSize: 1024 * 1024,
      maxRetries: 2,
      retryDelayMs: 0,
    });

    assert.equal(result.sha256, digest(content));
    assert.deepEqual(await readFile(destination), content);
    assert.equal(transientFailures, 1);
    assert.ok(ranges.every((range) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      return match && Number(match[2]) - Number(match[1]) + 1 <= 1024 * 1024;
    }));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('refuses an existing destination mismatch before making a network request', async () => {
  const { downloadInRanges } = await setupModule();
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(403, { 'retry-after': '120' });
    response.end('forbidden');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const root = await mkdtemp(path.join(tmpdir(), 'epvs tts forbidden '));
  const destination = path.join(root, 'model.onnx');
  await writeFile(destination, 'keep-existing');

  try {
    await assert.rejects(
      downloadInRanges(`http://127.0.0.1:${address.port}/model`, destination, {
        expectedSha256: digest('replacement'),
        chunkSize: 1024 * 1024,
        maxRetries: 2,
        retryDelayMs: 0,
      }),
      /refusing to overwrite|sha-256 mismatch/i,
    );
    assert.equal(requests, 0);
    assert.equal(await readFile(destination, 'utf8'), 'keep-existing');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('stops immediately on 403 and reports Retry-After', async () => {
  const { downloadInRanges } = await setupModule();
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(403, { 'retry-after': '120' });
    response.end('forbidden');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const root = await mkdtemp(path.join(tmpdir(), 'epvs tts forbidden '));
  const destination = path.join(root, 'model.onnx');

  try {
    await assert.rejects(
      downloadInRanges(`http://127.0.0.1:${address.port}/model`, destination, {
        expectedSha256: digest('model'),
        maxRetries: 2,
        retryDelayMs: 0,
      }),
      /HTTP 403.*Retry-After: 120/i,
    );
    assert.equal(requests, 1);
    await assert.rejects(readFile(destination), /ENOENT/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('limits ordinary transient failures to two retries after the first request', async () => {
  const { downloadInRanges } = await setupModule();
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(503);
    response.end('unavailable');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const root = await mkdtemp(path.join(tmpdir(), 'epvs tts retries '));

  try {
    await assert.rejects(
      downloadInRanges(`http://127.0.0.1:${address.port}/model`, path.join(root, 'model.onnx'), {
        expectedSha256: digest('model'),
        maxRetries: 2,
        retryDelayMs: 0,
      }),
      /failed after 3 attempts/i,
    );
    assert.equal(requests, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('rejects a server that ignores the one MiB Range request', async () => {
  const { downloadInRanges } = await setupModule();
  const content = Buffer.alloc(2 * 1024 * 1024, 0x5a);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-length': String(content.length) });
    response.end(content);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const root = await mkdtemp(path.join(tmpdir(), 'epvs tts no ranges '));
  const destination = path.join(root, 'model.onnx');

  try {
    await assert.rejects(
      downloadInRanges(`http://127.0.0.1:${address.port}/model`, destination, {
        expectedSha256: digest(content),
        maxRetries: 0,
      }),
      /HTTP 200/i,
    );
    await assert.rejects(readFile(destination), /ENOENT/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('verify-only rejects a missing model without invoking the downloader', async () => {
  const { ensureVerifiedArtifact } = await setupModule();
  const root = await mkdtemp(path.join(tmpdir(), 'epvs tts verify only '));
  const destination = path.join(root, 'missing.onnx');
  let downloads = 0;

  await assert.rejects(
    ensureVerifiedArtifact({
      path: destination,
      expectedSha256: digest('model'),
      sourceUrl: 'https://example.invalid/model.onnx',
      allowInstall: false,
      downloader: async () => { downloads += 1; },
    }),
    /missing in verify-only mode/i,
  );
  assert.equal(downloads, 0);
});

test('creates a portable relative-path TTS config and refuses to replace different settings', async () => {
  const { ensureTtsConfig, expectedTtsConfig } = await setupModule();
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'epvs tts config '));
  const expected = expectedTtsConfig(repositoryRoot);

  const created = await ensureTtsConfig(repositoryRoot, expected);
  assert.equal(created.action, 'created');
  assert.equal(path.isAbsolute(expected.pythonPath), false);
  assert.equal(path.isAbsolute(expected.model.path), false);
  assert.equal(expected.synthesis.defaultVoice, 'zf_001');
  assert.equal(expected.synthesis.timingGranularity, 'phrase');

  const configPath = path.join(repositoryRoot, '.tools', 'tts-config.json');
  const different = { ...expected, synthesis: { ...expected.synthesis, defaultVoice: 'zm_009' } };
  await writeFile(configPath, `${JSON.stringify(different, null, 2)}\n`);
  await assert.rejects(ensureTtsConfig(repositoryRoot, expected), /refusing to overwrite/i);
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), different);
});

test('verify report distinguishes dependency and voice checks from an unrun synthesis test', async () => {
  const { expectedTtsConfig, prepareTts } = await setupModule();
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'epvs tts report '));
  const model = Buffer.from('fixture-model');
  const voices = Buffer.from('fixture-voices');
  const manifest = {
    pythonVersion: '3.12.14',
    packages: { 'kokoro-onnx': '0.6.1', misaki: '0.9.4', soundfile: '0.14.0' },
    model: { version: 'v1.1-zh', fileName: 'kokoro-v1.1-zh.onnx', sha256: digest(model), sourceUrl: 'https://example.invalid/model' },
    voices: { fileName: 'voices-v1.1-zh.bin', sha256: digest(voices), sourceUrl: 'https://example.invalid/voices' },
  };
  const pythonPath = path.join(repositoryRoot, '.tools', 'tts-venv', 'Scripts', 'python.exe');
  await mkdir(path.dirname(pythonPath), { recursive: true });
  await mkdir(path.join(repositoryRoot, '.tools', 'tts-models'), { recursive: true });
  await writeFile(pythonPath, 'fixture-python');
  await writeFile(path.join(repositoryRoot, '.tools', 'tts-models', manifest.model.fileName), model);
  await writeFile(path.join(repositoryRoot, '.tools', 'tts-models', manifest.voices.fileName), voices);
  await writeFile(
    path.join(repositoryRoot, '.tools', 'tts-config.json'),
    `${JSON.stringify(expectedTtsConfig(repositoryRoot, manifest), null, 2)}\n`,
  );

  const runner = (_executable: string, args: string[]) => {
    if (args[0] === '--version') return { command: [], exitCode: 0, stdout: 'Python 3.12.14\n', stderr: '', durationMs: 1 };
    if (args.some((argument) => argument.includes('importlib.metadata'))) {
      return { command: [], exitCode: 0, stdout: `${JSON.stringify(manifest.packages)}\n`, stderr: '', durationMs: 1 };
    }
    return {
      command: [], exitCode: 0,
      stdout: `Warning: en_callable is None, so English may be removed\n${JSON.stringify({ g2pVersion: '1.1', phonemeCount: 8, defaultVoiceAvailable: true, voiceCount: 103 })}\n`,
      stderr: '', durationMs: 1,
    };
  };

  const report = await prepareTts({ repositoryRoot, allowInstall: false, manifest, runner });

  assert.equal(report.status, 'PASS');
  assert.equal(report.verification.g2p.status, 'PASS');
  assert.equal(report.verification.voiceConfiguration.status, 'PASS');
  assert.equal(report.verification.synthesis.status, 'NOT_RUN');
  assert.match(report.verification.synthesis.detail, /not prove audio synthesis/i);
});

test('requirements file exactly matches the package manifest', async () => {
  const { TTS_TOOLCHAIN } = await setupModule();
  const requirements = await readFile(new URL('../../scripts/requirements-tts.txt', import.meta.url), 'utf8');
  const observed = Object.fromEntries(
    requirements.split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('==')),
  );
  assert.deepEqual(observed, TTS_TOOLCHAIN.packages);
});
