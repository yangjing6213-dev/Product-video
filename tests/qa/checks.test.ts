import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateSpec } from '../../src/contracts.ts';
import { checkAssets, checkCaption, checkMedia, checkSafeArea, checkSpec } from '../../src/qa/checks.ts';
import { validProductInput, validVideoSpec } from '../fixtures/input.ts';

function status(results: ReturnType<typeof checkMedia>, id: string) {
  return results.find((result) => result.id === id)?.status;
}

test('checkMedia passes matching video metadata and skips audio checks in no-audio mode', () => {
  const spec = structuredClone(validVideoSpec);
  const results = checkMedia(
    {
      format: { duration: '45.000' },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30/1',
        },
      ],
    },
    spec,
  );

  assert.equal(status(results, 'media.resolution'), 'PASS');
  assert.equal(status(results, 'media.fps'), 'PASS');
  assert.equal(status(results, 'media.duration'), 'PASS');
  assert.equal(status(results, 'media.video-codec'), 'PASS');
  assert.equal(status(results, 'media.audio-stream'), 'SKIPPED_WITH_REASON');
  assert.equal(status(results, 'media.audio-codec'), 'SKIPPED_WITH_REASON');
});

test('checkMedia fails wrong dimensions, fps and duration plus a missing required audio stream', () => {
  const spec = structuredClone(validVideoSpec);
  spec.audio.narrationMode = 'external-audio';
  const results = checkMedia(
    {
      format: { duration: 28 },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1280,
          height: 720,
          r_frame_rate: '24/1',
        },
      ],
    },
    spec,
  );

  for (const id of ['media.resolution', 'media.fps', 'media.duration', 'media.audio-stream']) {
    assert.equal(status(results, id), 'FAIL', id);
  }
});

test('checkMedia rejects a narration stream shorter than the rendered video', () => {
  const spec = structuredClone(validVideoSpec);
  spec.audio.narrationMode = 'external-audio';
  const results = checkMedia({
    format: { duration: 45 },
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30/1', duration: 45 },
      { codec_type: 'audio', codec_name: 'aac', duration: 39 },
    ],
  }, spec);
  assert.equal(status(results, 'media.audio-duration'), 'FAIL');
});

test('checkSafeArea and checkCaption catch overflow and excessive caption lines', () => {
  const output = { width: 1920, height: 1080 };
  assert.equal(checkSafeArea({ x: 134.4, y: 75.6, width: 1651.2, height: 928.8 }, output, 7), true);
  assert.equal(checkSafeArea({ x: 100, y: 75.6, width: 400, height: 100 }, output, 7), false);

  const results = checkCaption('第一行\n第二行\n第三行', { x: 100, y: 900, width: 600, height: 120 }, output, 2, 7);
  assert.equal(results.find((result) => result.id === 'caption.lines')?.status, 'FAIL');
  assert.equal(results.find((result) => result.id === 'caption.safe-area')?.status, 'FAIL');
});

test('checkAssets accepts real files beneath assets even when project path and filename contain spaces', async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'EPVS project with spaces '));
  await mkdir(path.join(projectDir, 'assets', 'Brand Assets'), { recursive: true });
  await writeFile(path.join(projectDir, 'assets', 'Brand Assets', 'Primary Logo.svg'), '<svg/>');

  const input = structuredClone(validProductInput);
  input.assets = [
    {
      ...input.assets[0]!,
      path: 'assets/Brand Assets/Primary Logo.svg',
    },
  ];
  input.product.features[0]!.evidenceAssetIds = ['brand-logo'];

  const results = await checkAssets(input, projectDir);
  assert.equal(results.every((result) => result.status === 'PASS'), true, JSON.stringify(results));
});

test('checkAssets resolves a missing required asset through an existing licensed fallback', async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'epvs-fallback-'));
  await mkdir(path.join(projectDir, 'assets'), { recursive: true });
  await writeFile(path.join(projectDir, 'assets', 'fallback.svg'), '<svg/>');
  const input = structuredClone(validProductInput);
  input.assets = [
    { ...input.assets[0]!, path: 'assets/missing.svg', fallbackAssetId: 'fallback' },
    {
      ...input.assets[0]!,
      id: 'fallback',
      path: 'assets/fallback.svg',
      required: false,
      fallbackAssetId: null,
    },
  ];

  const results = await checkAssets(input, projectDir);
  assert.equal(results.find((result) => result.id === 'asset.path.brand-logo')?.status, 'SKIPPED_WITH_REASON');
});

test('checkAssets fails missing required assets, unknown licenses and paths escaping the project', async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'epvs-invalid-'));
  const input = structuredClone(validProductInput);
  input.assets = [
    { ...input.assets[0]!, path: 'assets/missing.svg', fallbackAssetId: null },
    { ...input.assets[1]!, id: 'unknown', license: 'unknown', path: '../outside.png', fallbackAssetId: null },
  ];

  const results = await checkAssets(input, projectDir);
  assert.equal(results.find((result) => result.id === 'asset.path.brand-logo')?.status, 'FAIL');
  assert.equal(results.find((result) => result.id === 'asset.license.unknown')?.status, 'FAIL');
  assert.equal(results.find((result) => result.id === 'asset.path.unknown')?.status, 'FAIL');
});

test('checkAssets rejects dangling brand, evidence, fallback and audio references even when files exist', async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'epvs-dangling-'));
  await mkdir(path.join(projectDir, 'assets'), { recursive: true });
  await writeFile(path.join(projectDir, 'assets/hero.png'), 'image');
  const input = structuredClone(validProductInput);
  input.assets = [{
    ...input.assets[1]!,
    path: 'assets/hero.png',
    fallbackAssetId: 'missing-fallback',
  }];
  input.brand.logoAssetId = 'missing-logo';
  input.product.features[0]!.evidenceAssetIds = ['missing-evidence'];
  input.audio.narrationMode = 'external-audio';
  input.audio.externalAudioAssetId = 'missing-voice';
  input.audio.musicAssetId = 'missing-music';

  const references = (await checkAssets(input, projectDir)).find((result) => result.id === 'asset.references');
  assert.equal(references?.status, 'FAIL');
  assert.match(references?.message ?? '', /brand\.logoAssetId=missing-logo/);
  assert.match(references?.message ?? '', /fallbackAssetId=missing-fallback/);
  assert.match(references?.message ?? '', /externalAudioAssetId=missing-voice/);
});

test('checkSpec passes contiguous timing, valid asset references, a three-second opener and transitions', () => {
  const results = checkSpec(structuredClone(validVideoSpec));
  assert.equal(results.every((result) => result.status === 'PASS'), true, JSON.stringify(results));
});

test('checkSpec fails timing gaps, missing asset references, a late opener and missing transitions', () => {
  const spec = structuredClone(validVideoSpec);
  spec.scenes[1]!.actualStartSec = 10;
  spec.scenes[2]!.assetRefs = ['missing-asset'];
  spec.scenes[0]!.heroFrameSec = 4;
  spec.scenes[3]!.transition.durationSec = 0;

  const results = checkSpec(spec);
  for (const id of ['spec.timing', 'spec.asset-refs', 'spec.opener', 'spec.transitions']) {
    assert.equal(results.find((result) => result.id === id)?.status, 'FAIL', id);
  }
});

test('checkSpec strictly rejects duplicate IDs, out-of-scene hero frames and unsafe composition paths', () => {
  const spec = structuredClone(validVideoSpec);
  spec.scenes[1]!.id = spec.scenes[0]!.id;
  spec.scenes[2]!.heroFrameSec = spec.scenes[2]!.actualEndSec!;
  spec.scenes[3]!.compositionFile = '../outside.html';

  const results = checkSpec(spec);
  for (const id of ['spec.scene-ids', 'spec.hero-frames', 'spec.composition-files']) {
    assert.equal(results.find((result) => result.id === id)?.status, 'FAIL', id);
  }
});

test('checkSpec keeps null-timing planning specs schema-valid but fails render timing and hero checks', () => {
  const spec = structuredClone(validVideoSpec);
  for (const scene of spec.scenes) {
    scene.actualStartSec = null;
    scene.actualEndSec = null;
  }

  assert.doesNotThrow(() => validateSpec(spec));
  const results = checkSpec(spec);
  assert.equal(results.find((result) => result.id === 'spec.timing')?.status, 'FAIL');
  assert.equal(results.find((result) => result.id === 'spec.hero-frames')?.status, 'FAIL');
});
