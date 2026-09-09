import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// @ts-expect-error The tested production entry point is intentionally plain ESM.
import { comparePcm, verifyProject } from '../../scripts/verify-zh-artifacts.mjs';
import { validVideoSpec } from '../fixtures/input.ts';

function pcm16Wav(samples: Int16Array, rate = 24000): Buffer {
  const dataLength = samples.length * 2;
  const bytes = Buffer.alloc(44 + dataLength);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + dataLength, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(dataLength, 40);
  samples.forEach((sample, index) => bytes.writeInt16LE(sample, 44 + index * 2));
  return bytes;
}

test('a cue parse failure atomically replaces an old PASS with a current FAIL and available hashes', async t => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'narration-artifacts-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const project = path.join(repo, 'projects', 'artifact-test');
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await mkdir(path.join(project, 'reports'), { recursive: true });
  const spec = structuredClone(validVideoSpec);
  const audio = pcm16Wav(Int16Array.from({ length: 24000 }, (_, index) => Math.round(Math.sin(index / 20) * 10000)));
  const malformedCues = Buffer.from('{ malformed');
  await writeFile(path.join(project, 'video-spec.json'), JSON.stringify(spec));
  await writeFile(path.join(project, 'assets/narration.wav'), audio);
  await writeFile(path.join(project, 'reports/narration-cues.json'), malformedCues);
  await writeFile(path.join(project, 'reports/narration-artifact-check.json'), JSON.stringify({ status: 'PASS', generatedAt: 'old' }));

  const result = await verifyProject('artifact-test', { repo });
  const persisted = JSON.parse(await readFile(path.join(project, 'reports/narration-artifact-check.json'), 'utf8'));
  assert.equal(result.status, 'FAIL');
  assert.equal(persisted.status, 'FAIL');
  assert.notEqual(persisted.generatedAt, 'old');
  assert.match(persisted.error, /JSON|position|property/i);
  assert.equal(persisted.fileSha256['assets/narration.wav'], createHash('sha256').update(audio).digest('hex'));
  assert.equal(persisted.fileSha256['reports/narration-cues.json'], createHash('sha256').update(malformedCues).digest('hex'));
});

test('PCM comparison rejects severe attenuation even when normalized correlation stays perfect', () => {
  const reference = Float32Array.from({ length: 48000 }, (_, index) => Math.sin(index / 17) * 0.6);
  const normal = Float32Array.from(reference, value => value * 0.9);
  const attenuated = Float32Array.from(reference, value => value * 0.1);

  const accepted = comparePcm(reference, normal);
  assert.ok(accepted.decodedAudioCorrelation > 0.99);
  assert.ok(accepted.rmsGainRatio >= 0.8 && accepted.rmsGainRatio <= 1.2);
  assert.equal(accepted.aligned, true);

  const rejected = comparePcm(reference, attenuated);
  assert.ok(rejected.decodedAudioCorrelation > 0.99);
  assert.ok(rejected.rmsGainRatio < 0.8);
  assert.equal(rejected.aligned, false);
});
