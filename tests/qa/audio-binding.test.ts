// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { validVideoSpec } from '../fixtures/input.ts';
import { environment } from '../../src/pipeline/tools.ts';
import { verifyFinalAudioBinding } from '../../src/qa/audio-binding.ts';
import { ACTIVE_GENERATOR_POLICY } from '../../src/quality/policy.ts';

const CACHE_ROOT = path.resolve('.cache/generator-quality-003/audio-binding');

async function fixture() {
  await mkdir(CACHE_ROOT, { recursive: true });
  const project = await mkdtemp(path.join(CACHE_ROOT, 'real-pcm '));
  await mkdir(path.join(project, 'assets'));
  await mkdir(path.join(project, 'renders'));
  await mkdir(path.join(project, 'reports'));
  const env = await environment();
  const ffmpeg = env.HYPERFRAMES_FFMPEG_PATH ?? 'ffmpeg';
  const narration = path.join(project, 'assets/narration.wav');
  const music = path.join(project, 'assets/music.wav');
  const positive = path.join(project, 'renders/positive.mp4');
  const musicOnly = path.join(project, 'renders/music-only.mp4');
  const run = (args: string[]) => {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
  };
  run(['-f', 'lavfi', '-i', 'sine=frequency=620:duration=2:sample_rate=48000', '-af', 'volume=0.3', narration]);
  run(['-f', 'lavfi', '-i', 'sine=frequency=180:duration=2:sample_rate=48000', '-af', 'volume=0.03', music]);
  run(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=2', '-i', narration, '-i', music,
    '-filter_complex', '[1:a][2:a]amix=inputs=2:duration=longest:normalize=0[a]', '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '2', positive]);
  run(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=2', '-i', music, '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '2', musicOnly]);
  const spec = structuredClone(validVideoSpec);
  spec.generatorPolicy = structuredClone(ACTIVE_GENERATOR_POLICY);
  spec.audio = { ...spec.audio, narrationMode: 'external-audio', externalAudioAssetId: 'narration', musicAssetId: 'music' };
  spec.assets.push(
    { id: 'narration', type: 'audio', path: 'assets/narration.wav', sourceUrl: '', license: 'authorized', required: true, fallbackAssetId: null },
    { id: 'music', type: 'audio', path: 'assets/music.wav', sourceUrl: '', license: 'authorized', required: true, fallbackAssetId: null },
  );
  return { project, positive, musicOnly, spec };
}

async function cleanup(project: string): Promise<void> {
  const resolved = path.resolve(project);
  assert.equal(path.dirname(resolved), CACHE_ROOT);
  assert.ok(path.basename(resolved).startsWith('real-pcm '));
  await rm(resolved, { recursive: true });
}

test('decoded final PCM binds the frozen narration and static music mix', async (t) => {
  const f = await fixture();
  t.after(() => cleanup(f.project));
  const check = await verifyFinalAudioBinding(f.positive, f.project, f.spec);
  assert.equal(check.status, 'PASS', check.message);
  const report = JSON.parse(await readFile(path.join(f.project, 'reports/audio-binding.json'), 'utf8'));
  assert.equal(report.status, 'PASS');
  assert.equal(report.asr, 'NOT_RUN');
  assert.equal(report.method, 'decoded-pcm-linear-mix-binding');
});

test('music-only final fails when frozen narration is required', async (t) => {
  const f = await fixture();
  t.after(() => cleanup(f.project));
  const check = await verifyFinalAudioBinding(f.musicOnly, f.project, f.spec);
  assert.equal(check.status, 'FAIL');
  assert.match(check.message, /narration/i);
});
