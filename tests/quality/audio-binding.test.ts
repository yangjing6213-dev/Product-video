// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { inspectCompositionAudio } from '../../src/quality/audio.ts';
import { digest } from '../../src/pipeline/stage-state.ts';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function fixture(t: TestContext, html: string) {
  const root = path.join(repository, '.cache', `audio-binding-${randomUUID()}`);
  const project = path.join(root, 'projects/sample');
  await mkdir(path.join(project, 'assets/quality-frozen'), { recursive: true });
  t.after(async () => { assert.equal(path.dirname(root), path.join(repository, '.cache')); assert.match(path.basename(root), /^audio-binding-/); await rm(root, { recursive: true }); });
  const voiceHash = digest('voice A fixture');
  const voiceRelative = `projects/sample/assets/quality-frozen/${voiceHash}.wav`;
  const voiceSrc = `assets/quality-frozen/${voiceHash}.wav`;
  await writeFile(path.join(root, voiceRelative), 'voice A fixture');
  await writeFile(path.join(project, 'voice-b.wav'), 'voice B fixture');
  await writeFile(path.join(project, 'index.html'), `<!doctype html><html><body>${html.replaceAll('VOICE_A', voiceSrc)}</body></html>`);
  const plan = { frameRate: 30 as const, durationFrames: 30, narration: { status: 'PENDING_REVIEW' as const, provider: 'fixture', modelId: 'fixture', voiceId: 'A',
    textHash: digest('已认可'), pronunciationMapHash: digest('{}'), voicePath: voiceRelative, voiceHash } };
  return { root, project, plan };
}

test('the actual parsed audio source must be the frozen voice and matching file hash', async t => {
  const f = await fixture(t, '<audio id="narration" src="VOICE_A" data-start="0" data-duration="1"></audio>');
  const result = await inspectCompositionAudio(f.root, f.project, f.plan);
  assert.equal(result.status, 'PASS');
  assert.equal(result.voiceSha256, f.plan.narration.voiceHash);
  assert.equal(result.audioCount, 1);
  assert.ok(result.sampledFrames >= 30);
});

for (const [name, html] of [
  ['different literal source', '<audio src="voice-b.wav"></audio>'],
  ['entity-decoded different source', '<audio src="voice&#45;b.wav"></audio>'],
  ['nested source element', '<audio><source src="voice-b.wav"></audio>'],
  ['second undeclared track', '<audio src="VOICE_A"></audio><audio src="voice-b.wav"></audio>'],
  ['computed dynamic source assignment', '<audio id="n" src="VOICE_A"></audio><script>document.getElementById("n")["s"+"rc"]="voice-b.wav";</script>'],
  ['new detached audio', '<audio src="VOICE_A"></audio><script>new Audio("voice-b.wav");</script>'],
  ['timeline source mutation', '<audio id="n" src="VOICE_A"></audio><script>window.__timelines={main:{seek(t){if(t>0.2)document.getElementById("n").setAttribute("src","voice-b.wav")}}};</script>'],
] as const) {
  test(`audio gate blocks ${name} before HyperFrames rendering`, async t => {
    const f = await fixture(t, html);
    await assert.rejects(inspectCompositionAudio(f.root, f.project, f.plan), /audio.*binding|unsupported.*media|narration.*source/i);
  });
}

test('declared voice bytes changed on disk cannot pass DOM binding', async t => {
  const f = await fixture(t, '<audio src="VOICE_A"></audio>');
  await writeFile(path.join(f.root, f.plan.narration.voicePath), 'changed bytes');
  await assert.rejects(inspectCompositionAudio(f.root, f.project, f.plan), /voice.*hash/i);
});

async function mixedFixture(t: TestContext, source = 'MIX') {
  const f = await fixture(t, `<audio src="${source}" data-start="0" data-duration="1" data-volume="1"></audio>`);
  const bytes = { music: 'fixture music', license: 'fixture CC0 license', mix: 'fixture premix' };
  const paths = { music: 'projects/sample/assets/quality-frozen/music.wav', license: 'projects/sample/assets/quality-frozen/license.txt', mix: 'projects/sample/assets/quality-frozen/mix.wav' };
  for (const key of ['music', 'license', 'mix'] as const) await writeFile(path.join(f.root, paths[key]), bytes[key]);
  await writeFile(path.join(f.project, 'index.html'),
    `<!doctype html><audio src="${source === 'MIX' ? 'assets/quality-frozen/mix.wav' : `assets/quality-frozen/${f.plan.narration.voiceHash}.wav`}" data-start="0" data-duration="1" data-volume="1"></audio>`);
  const audioMix = { schemaVersion: '1.0' as const, voiceSha256: f.plan.narration.voiceHash,
    music: { path: paths.music, sha256: digest(bytes.music), licenseId: 'CC0-1.0', licensePath: paths.license, licenseSha256: digest(bytes.license) },
    mixPath: paths.mix, mixSha256: digest(bytes.mix), durationSec: 1, voiceOffsetSec: 0.1, voiceGainDb: 0,
    musicOffsetSec: 0, musicGainDb: -18, fadeInSec: 0.1, fadeOutSec: 0.2 };
  return { ...f, plan: { ...f.plan, audioMix } };
}

test('declared premix binds one actual mix while retaining the separate raw voice identity', async t => {
  const f = await mixedFixture(t);
  const result = await inspectCompositionAudio(f.root, f.project, f.plan) as { status: string; voiceSha256: string | null; mixSha256?: string | null };
  assert.equal(result.status, 'PASS');
  assert.equal(result.voiceSha256, f.plan.narration.voiceHash);
  assert.equal(result.mixSha256, f.plan.audioMix.mixSha256);
});

test('a premix plan cannot silently render only the raw voice', async t => {
  const f = await mixedFixture(t, 'VOICE_A');
  await assert.rejects(inspectCompositionAudio(f.root, f.project, f.plan), /audio.*binding/i);
});

test('a changed source music or time-shifted mix cannot pass actual audio binding', async t => {
  const f = await mixedFixture(t);
  await writeFile(path.join(f.project, 'index.html'), '<audio src="assets/quality-frozen/mix.wav" data-start="0.3" data-duration="1"></audio>');
  await assert.rejects(inspectCompositionAudio(f.root, f.project, f.plan), /audio.*binding/i);
  await writeFile(path.join(f.root, f.plan.audioMix.music.path), 'music changed');
  await assert.rejects(inspectCompositionAudio(f.root, f.project, f.plan), /music.*hash|hash.*music/i);
});
