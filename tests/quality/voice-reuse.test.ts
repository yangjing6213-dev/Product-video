// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { assertVoiceReuseCompatible, snapshotVoiceReuse, narrationEvidenceContext, voiceReuseEvidenceInputs, VOICE_REUSE_FILE } from '../../src/pipeline/voice-reuse.ts';
import { copyDraftFromVideoSpec, freezeCopyDraft, recordCopyDecision } from '../../src/quality/copy.ts';
import { digest } from '../../src/pipeline/stage-state.ts';
import { validVideoSpec } from '../fixtures/input.ts';

test('visual-only voice reuse permits a new visual identity but rejects audio, text and timing changes', () => {
  const source = structuredClone(validVideoSpec), target = structuredClone(source);
  target.projectId = 'visual-derivative'; target.brand.visualStyle = 'editorial-v1';
  assert.doesNotThrow(() => assertVoiceReuseCompatible(source, target));
  for (const change of [
    (s: typeof target) => { s.scenes[0]!.voiceover += '新词'; },
    (s: typeof target) => { s.scenes[0]!.caption += '新字幕'; },
    (s: typeof target) => { s.scenes[0]!.actualEndSec = 123; },
    (s: typeof target) => { s.scenes[0]!.voiceDirection = { purpose: 'changed' } as never; },
    (s: typeof target) => { s.audio.pronunciationMap = { AI: '别的读音' }; },
    (s: typeof target) => { s.audio.voiceProfile = { voiceId: 'changed' } as never; },
    (s: typeof target) => { s.output.fps = 60 as never; },
  ]) {
    const changed = structuredClone(target); change(changed);
    assert.throws(() => assertVoiceReuseCompatible(source, changed), /visual-only voice reuse/i);
  }
});

async function fixture(approveTarget = true) {
  const base = path.resolve('.cache/voice-reuse-tests'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, '源证据 中文 '));
  const source = path.join(root, 'projects/source'), project = path.join(root, 'projects/derivative');
  const sourceSpec = structuredClone(validVideoSpec); sourceSpec.projectId = 'source';
  const spec = structuredClone(sourceSpec); spec.projectId = 'derivative'; spec.brand.visualStyle = 'editorial-v1';
  for (const [directory, value] of [[source, sourceSpec], [project, spec]] as const) {
    await mkdir(path.join(directory, 'reports'), { recursive: true });
    await mkdir(path.join(directory, 'input'), { recursive: true });
    await mkdir(path.join(directory, 'assets'), { recursive: true });
    await writeFile(path.join(directory, 'video-spec.json'), JSON.stringify(value));
    await writeFile(path.join(directory, 'input/product-input.json'), JSON.stringify({ projectId: value.projectId }));
  }
  // Small synthetic provenance; these fixture bytes do not claim real TTS or ASR validation.
  for (const file of ['input/narration-script.json', 'input/current-voice-profile.json', 'input/current-pronunciation.json',
    'assets/narration.wav', 'transcript.json', 'captions.srt', 'reports/narration-cues.json', 'reports/tts-generation.json']) {
    await writeFile(path.join(source, file), `synthetic source bytes: ${file}\n`);
  }
  const sourceCopy = await freezeCopyDraft(root, source, copyDraftFromVideoSpec(sourceSpec, 'fixture-v1'));
  const copy = await freezeCopyDraft(root, project, copyDraftFromVideoSpec(spec, 'fixture-v1'));
  const decision = { decision: 'ACCEPTED' as const, userInstruction: 'Synthetic test only; not actual user acceptance.' };
  await recordCopyDecision(root, source, { ...decision, copySha256: sourceCopy.copySha256 });
  if (approveTarget) await recordCopyDecision(root, project, { ...decision, copySha256: copy.copySha256 });
  return { root, source, project, sourceSpec, spec, sourceCopy, copy };
}

test('reuse requires separate target copy approval and retains original receipts plus explicit context', async () => {
  const f = await fixture(false);
  await assert.rejects(snapshotVoiceReuse(f.project, f.source), /Copy approval required/);
  await recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: f.copy.copySha256, userInstruction: 'Synthetic approval fixture.' });
  const receipt = await readFile(path.join(f.source, 'reports/tts-generation.json'));
  await snapshotVoiceReuse(f.project, f.source);
  assert.deepEqual(await readFile(path.join(f.project, 'reports/tts-generation.json')), receipt);
  assert.deepEqual(await readFile(path.join(f.source, 'reports/tts-generation.json')), receipt);
  assert.notEqual(f.copy.copySha256, f.sourceCopy.copySha256);
  const context = await narrationEvidenceContext(f.project, f.spec, f.copy.copySha256);
  assert.equal(context.copySha256, f.sourceCopy.copySha256);
  assert.equal(context.spec.projectId, 'source');
  assert.equal(context.specSha256, digest(await readFile(path.join(f.source, 'video-spec.json'))));
  const binding = JSON.parse(await readFile(path.join(f.project, VOICE_REUSE_FILE), 'utf8'));
  assert.equal(binding.inferenceCount, 0);
  const inputs = await voiceReuseEvidenceInputs(f.project);
  assert.ok(inputs.includes(path.join(f.source, 'reports/tts-generation.json')));
  assert.ok(inputs.includes(path.join(f.project, 'reports/voice-reuse-source/reports/tts-generation.json')));
  assert.ok(inputs.includes(path.join(f.project, VOICE_REUSE_FILE)));
  assert.ok((await voiceReuseEvidenceInputs(f.project, true)).every(file => file.startsWith(f.project + path.sep)));
  const before = await stat(path.join(f.project, VOICE_REUSE_FILE));
  await snapshotVoiceReuse(f.project, f.source);
  assert.equal((await stat(path.join(f.project, VOICE_REUSE_FILE))).mtimeMs, before.mtimeMs, 'resume does not rewrite the frozen binding');
});

test('reuse rejects target, original source, snapshot, approval and inventory tampering', async () => {
  const f = await fixture(); await snapshotVoiceReuse(f.project, f.source);
  for (const file of [path.join(f.source, 'reports/tts-generation.json'), path.join(f.project, 'reports/tts-generation.json'),
    path.join(f.project, 'reports/voice-reuse-source/reports/tts-generation.json'), path.join(f.source, 'input/narration-script.json'),
    path.join(f.project, 'input/current-pronunciation.json'), path.join(f.project, 'video-spec.json')]) {
    const before = await readFile(file); await writeFile(file, Buffer.concat([before, Buffer.from(' ')]));
    await assert.rejects(voiceReuseEvidenceInputs(f.project), /changed/);
    await writeFile(file, before);
  }
  const file = path.join(f.project, VOICE_REUSE_FILE), before = await readFile(file);
  const binding = JSON.parse(before.toString('utf8')); binding.files.pop(); await writeFile(file, JSON.stringify(binding));
  await assert.rejects(voiceReuseEvidenceInputs(f.project), /inventory changed/);
  await writeFile(file, before);
  await recordCopyDecision(f.root, f.source, { decision: 'REJECTED', copySha256: f.sourceCopy.copySha256, userInstruction: 'Synthetic revocation fixture.' });
  await assert.rejects(voiceReuseEvidenceInputs(f.project), /Copy approval required/);
});

test('reuse never replaces a conflicting target or follows another derivative', async () => {
  const f = await fixture(); const conflict = path.join(f.project, 'assets/narration.wav');
  await writeFile(conflict, 'existing user audio');
  await assert.rejects(snapshotVoiceReuse(f.project, f.source), /Existing voice artifact preserved/);
  assert.equal(await readFile(conflict, 'utf8'), 'existing user audio');
  await assert.rejects(readFile(path.join(f.project, 'reports/tts-generation.json')), { code: 'ENOENT' });
  await writeFile(path.join(f.source, VOICE_REUSE_FILE), '{}');
  await assert.rejects(snapshotVoiceReuse(f.project, f.source), /chained reuse is not supported/);
});

test('a reused task fails if its own approval is revoked after creation', async () => {
  const f = await fixture(); await snapshotVoiceReuse(f.project, f.source);
  await recordCopyDecision(f.root, f.project, { decision: 'REJECTED', copySha256: f.copy.copySha256, userInstruction: 'Synthetic revocation fixture.' });
  await assert.rejects(voiceReuseEvidenceInputs(f.project), /Copy approval required/);
});
