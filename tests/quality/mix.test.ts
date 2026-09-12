// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { digest } from '../../src/pipeline/stage-state.ts';
import { freezeCopyDraft, recordCopyDecision } from '../../src/quality/copy.ts';
import { createAudioMix } from '../../src/quality/mix.ts';
import { installCommandRunnerForTests } from '../../src/pipeline/tools.ts';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function tone(frequency: number, durationSec = 1): Buffer {
  const rate = 48000, samples = Math.round(48000 * durationSec), bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(3276 * Math.sin(2 * Math.PI * frequency * i / rate)), 44 + i * 2);
  return bytes;
}

async function fixture(t: TestContext, approved = true) {
  const root = path.join(repository, '.cache', `audio-mix-${randomUUID()}`, '中文 空格');
  const project = path.join(root, 'projects/sample');
  await mkdir(path.join(project, 'input'), { recursive: true });
  t.after(async () => { const base = path.dirname(root); assert.equal(path.dirname(base), path.join(repository, '.cache')); assert.match(path.basename(base), /^audio-mix-/); await rm(base, { recursive: true }); });
  const voice = tone(440, 0.75), music = tone(880), license = 'CC0-1.0 synthetic test fixture; no speech and no external assets.';
  await writeFile(path.join(project, 'input/voice.wav'), voice);
  await writeFile(path.join(project, 'input/music.wav'), music);
  await writeFile(path.join(project, 'input/license.txt'), license);
  const copy = await freezeCopyDraft(root, project, { schemaVersion: '1.0', projectId: 'sample', productId: 'fixture', revision: 'fixture-v1',
    narration: ['测试夹具'], subtitles: ['测试夹具'], onScreenText: ['测试夹具'], cta: '测试结束' });
  if (approved) await recordCopyDecision(root, project, { copySha256: copy.copySha256, decision: 'ACCEPTED', userInstruction: 'Automated fixture approval only' });
  const request = { copySha256: copy.copySha256, voicePath: 'projects/sample/input/voice.wav', voiceSha256: digest(voice),
    music: { path: 'projects/sample/input/music.wav', sha256: digest(music), licenseId: 'CC0-1.0', licensePath: 'projects/sample/input/license.txt', licenseSha256: digest(license) },
    mixPath: 'projects/sample/input/premix-v1.wav', durationSec: 1, voiceOffsetSec: 0.2, voiceGainDb: 0,
    musicOffsetSec: 0, musicGainDb: -20, fadeInSec: 0.1, fadeOutSec: 0.2 };
  return { root, project, request, voice, music };
}

function samples(wav: Buffer): number[] {
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  for (let offset = 12; offset + 8 < wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    if (wav.toString('ascii', offset, offset + 4) === 'data') {
      const result: number[] = [];
      for (let i = offset + 8; i < offset + 8 + size; i += 6) result.push(wav.readIntLE(i, 3) / 8388608);
      return result;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('No PCM data');
}
function amplitude(values: number[], frequency: number, start: number, end: number): number {
  let real = 0, imaginary = 0;
  for (let i = start; i < end; i++) { real += values[i]! * Math.cos(2 * Math.PI * frequency * i / 48000); imaginary += values[i]! * Math.sin(2 * Math.PI * frequency * i / 48000); }
  return 2 * Math.hypot(real, imaginary) / (end - start);
}

test('real FFmpeg premix preserves voice timing, quieter music, stereo length, deterministic bytes and originals', async t => {
  const f = await fixture(t);
  const mix = await createAudioMix(f.root, f.project, f.request);
  const bytes = await readFile(path.join(f.root, mix.mixPath));
  assert.equal(digest(bytes), mix.mixSha256);
  const pcm = samples(bytes); assert.equal(pcm.length, 48000);
  const voiceAmplitude = amplitude(pcm, 440, 12000, 36000);
  assert.ok(voiceAmplitude > 0.09, `Expected original voice amplitude near 0.1; measured ${voiceAmplitude}`);
  assert.ok(amplitude(pcm, 880, 12000, 36000) > 0.008 && amplitude(pcm, 880, 12000, 36000) < 0.012);
  assert.ok(amplitude(pcm, 440, 0, 7200) < 0.001);
  assert.ok(Math.max(...pcm.map(Math.abs)) < 0.85);
  const again = await createAudioMix(f.root, f.project, { ...f.request, mixPath: 'projects/sample/input/premix-v2.wav' });
  assert.equal(mix.mixSha256, again.mixSha256);
  assert.deepEqual(await readFile(path.join(f.project, 'input/voice.wav')), f.voice);
  assert.deepEqual(await readFile(path.join(f.project, 'input/music.wav')), f.music);
  await assert.rejects(createAudioMix(f.root, f.project, f.request), /existing|preserved|exists/i);
});

test('mix creation cannot bypass the current copy gate', async t => {
  const f = await fixture(t, false);
  await assert.rejects(createAudioMix(f.root, f.project, f.request), /copy approval/i);
  assert.deepEqual((await readdir(path.join(f.project, 'input'))).sort(), ['license.txt', 'music.wav', 'voice.wav']);
});

test('delayed music fades in from its actual start instead of arriving at full gain', async t => {
  const f = await fixture(t);
  const shortVoice = tone(440, 0.2);
  await writeFile(path.join(f.project, 'input/voice.wav'), shortVoice);
  const mix = await createAudioMix(f.root, f.project, { ...f.request, voiceSha256: digest(shortVoice), voiceOffsetSec: 0.7, musicOffsetSec: 0.2, fadeInSec: 0.2 });
  const pcm = samples(await readFile(path.join(f.root, mix.mixPath)));
  assert.ok(amplitude(pcm, 880, 9840, 11760) < 0.004);
  assert.ok(amplitude(pcm, 880, 19200, 24000) > 0.009);
});

test('wrong raw voice bytes and outside output paths are rejected without publishing a mix', async t => {
  const f = await fixture(t);
  await assert.rejects(createAudioMix(f.root, f.project, { ...f.request, mixPath: '../outside.wav' }), /path|traversal/i);
  await writeFile(path.join(f.project, 'input/voice.wav'), 'changed voice');
  await assert.rejects(createAudioMix(f.root, f.project, f.request), /hash|changed/i);
  assert.deepEqual((await readdir(path.join(f.project, 'input'))).sort(), ['license.txt', 'music.wav', 'voice.wav']);
});

test('raw voice plus offset cannot be silently trimmed to the remaining film duration', async t => {
  const f = await fixture(t);
  await assert.rejects(createAudioMix(f.root, f.project, { ...f.request, voiceOffsetSec: 0.8 }), /voice.*duration|voice.*fit|voice.*exceed/i);
  assert.deepEqual((await readdir(path.join(f.project, 'input'))).sort(), ['license.txt', 'music.wav', 'voice.wav']);
});

test('an output parent replaced by a junction during mixing never publishes outside the task root', async t => {
  const f = await fixture(t);
  const outside = path.join(path.dirname(f.root), 'outside-task'); await mkdir(outside);
  const restore = installCommandRunnerForTests(async (executable, args, options) => {
    const started = performance.now();
    const result = await promisify(execFile)(executable, args, { cwd: options?.cwd, env: options?.env, windowsHide: true, encoding: 'utf8' });
    if (args.includes('-filter_complex')) await symlink(outside, path.join(f.project, 'output'), 'junction');
    return { command: [executable, ...args], exitCode: 0, stdout: result.stdout, stderr: result.stderr, durationMs: performance.now() - started };
  });
  t.after(restore);
  await assert.rejects(createAudioMix(f.root, f.project, { ...f.request, mixPath: 'projects/sample/output/mix.wav' }), /link|junction/i);
  assert.deepEqual(await readdir(outside), []);
});

for (const changed of ['voice', 'license', 'copy-rejection'] as const) {
  test(`${changed} changing after snapshot creation prevents mix publication`, async t => {
    const f = await fixture(t);
    const restore = installCommandRunnerForTests(async (executable, args, options) => {
      if (args.includes('-filter_complex')) {
        if (changed === 'copy-rejection') await recordCopyDecision(f.root, f.project, { copySha256: f.request.copySha256, decision: 'REJECTED', userInstruction: 'Fixture approval revoked during processing' });
        else await writeFile(path.join(f.project, `input/${changed === 'voice' ? 'voice.wav' : 'license.txt'}`), 'changed during processing');
      }
      const started = performance.now();
      const result = await promisify(execFile)(executable, args, { cwd: options?.cwd, env: options?.env, windowsHide: true, encoding: 'utf8' });
      return { command: [executable, ...args], exitCode: 0, stdout: result.stdout, stderr: result.stderr, durationMs: performance.now() - started };
    });
    t.after(restore);
    await assert.rejects(createAudioMix(f.root, f.project, f.request), /hash.*changed|copy approval/i);
    assert.deepEqual((await readdir(path.join(f.project, 'input'))).sort(), ['license.txt', 'music.wav', 'voice.wav']);
    assert.equal((await readdir(path.join(f.project, 'reports'))).filter(name => name.startsWith('audio-mix-')).length, 1);
  });
}
