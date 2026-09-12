import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import type { VideoSpec } from '../../src/contracts.ts';
import {
  checkNarrationComposition,
  validateCurrentNarrationEvidence,
  validateNarrationCues,
  validatePhraseTranscript,
  validateTranscriptTiming,
  type NarrationCues,
} from '../../src/qa/narration.ts';
import { narrationTimingEvidenceInputs } from '../../src/pipeline/run.ts';
import { hashFiles } from '../../src/pipeline/stage-state.ts';
import { ACTIVE_GENERATOR_POLICY } from '../../src/quality/policy.ts';
import {
  createVoiceSynthesisIdentity,
  pronunciationMapHash,
  spokenTextHash,
  voiceCacheKey,
  voiceProfileHash,
  type KokoroVoiceProfile,
} from '../../src/quality/voice-profile.ts';
import { resolveVoiceDirection, type VoiceDirection } from '../../src/quality/voice-direction.ts';
import { validVideoSpec } from '../fixtures/input.ts';

function narrationSpec(): VideoSpec {
  const spec = structuredClone(validVideoSpec);
  spec.audio.narrationMode = 'external-audio';
  spec.audio.externalAudioAssetId = 'narration';
  spec.assets.push({
    id: 'narration',
    type: 'audio',
    path: 'assets/narration.wav',
    sourceUrl: 'local-tts:koko-v1.1-zh',
    license: 'owned',
    required: true,
    fallbackAssetId: null,
  });
  for (const [index, scene] of spec.scenes.entries()) scene.voiceover = index === 0 ? '第一句。第二句。' : `第${index + 1}句。`;
  return spec;
}

function cueEvidence(spec: VideoSpec): NarrationCues {
  return {
    schemaVersion: '1.0',
    timingSource: 'tts-segment-duration',
    audioSha256: 'a'.repeat(64),
    generator: {
      backend: 'kokoro-onnx',
      backendVersion: '0.6.1',
      model: 'kokoro-v1.1-zh',
      frontend: 'misaki',
      frontendVersion: '0.9.4',
      voice: 'zf_001',
    },
    cues: spec.scenes.flatMap((scene, index) => index === 0
      ? [
          { sceneId: scene.id, text: '第一句。', start: 0.3, end: 2.2 },
          { sceneId: scene.id, text: '第二句。', start: 2.4, end: 4.8 },
        ]
      : [{ sceneId: scene.id, text: scene.voiceover, start: scene.actualStartSec! + 0.3, end: scene.actualStartSec! + 3 }]),
  };
}

test('real phrase cues bind the final audio and exactly reconstruct every scene voiceover', () => {
  const spec = narrationSpec();
  const evidence = cueEvidence(spec);
  assert.deepEqual(validateNarrationCues(evidence, spec, 'a'.repeat(64), 45), evidence);
});

test('provider sentence timing requires preserved evidence and remains distinct from segment synthesis or ASR', () => {
  const spec = narrationSpec();
  const evidence: NarrationCues = { ...cueEvidence(spec), timingSource: 'provider-phoneme-timing',
    timingEvidence: { path: 'assets/provider-timing.json', sha256: 'b'.repeat(64), method: 'Actual provider punctuation boundaries' } };
  assert.deepEqual(validateNarrationCues(evidence, spec, 'a'.repeat(64), 45), evidence);
  assert.throws(() => validateNarrationCues({ ...evidence, timingEvidence: undefined }, spec, 'a'.repeat(64), 45), /Provider timing evidence/);
  assert.throws(() => validateNarrationCues({ ...evidence, timingEvidence: { ...evidence.timingEvidence, path: '../outside.json' } }, spec, 'a'.repeat(64), 45), /project-relative/);
  assert.throws(() => validateNarrationCues({ ...evidence, timingSource: 'estimated-from-characters' }, spec, 'a'.repeat(64), 45), /measured TTS/);
});

const currentProfile: KokoroVoiceProfile = {
  provider: 'kokoro-onnx', modelId: 'kokoro-v1.1-zh', voiceId: 'zm_029', locale: 'zh-CN',
  speed: 1, sentencePauseSec: 0.3, clausePauseSec: 0.12,
};

function currentEvidenceFixture() {
  const spec = narrationSpec();
  spec.generatorPolicy = structuredClone(ACTIVE_GENERATOR_POLICY);
  spec.audio.voiceProfile = currentProfile;
  spec.audio.pronunciationMap = { AI: '人工智能' };
  spec.scenes[0]!.voiceover = '更多 AI 工具。';
  const evidence = cueEvidence(spec) as NarrationCues;
  evidence.cues[0] = { ...evidence.cues[0]!, text: '更多 AI 工具。', spokenText: '更多 人工智能 工具。' };
  Object.assign(evidence, {
    qualityRulesSha256: ACTIVE_GENERATOR_POLICY.rulesSha256,
    contextHash: ACTIVE_GENERATOR_POLICY.rulesSha256,
    generator: {
      provider: currentProfile.provider, backend: currentProfile.provider, backendVersion: '0.6.1',
      model: currentProfile.modelId, frontend: 'misaki', frontendVersion: '0.9.4', frontendModelVersion: '1.1',
      voice: currentProfile.voiceId, locale: currentProfile.locale, profileHash: voiceProfileHash(currentProfile),
      settings: { speed: 1, sentencePauseSec: 0.3, clausePauseSec: 0.12, trim: true, continuous: false, isPhonemes: true },
    },
  });
  for (const cue of evidence.cues.slice(1)) cue.spokenText = cue.text;
  const orderedSegments = evidence.cues.map(cue => cue.spokenText!);
  const identity = { ...createVoiceSynthesisIdentity({
    profile: currentProfile, spokenTextSha256: '0'.repeat(64), pronunciationMapSha256: pronunciationMapHash(spec.audio.pronunciationMap),
    orderedSegments, segmentationVersion: 'semantic-scene-v1', modelSha256: '1'.repeat(64), voicesSha256: '2'.repeat(64),
    backendVersion: '0.6.1', frontendVersion: '0.9.4', frontendModelVersion: '1.1', synthesisScriptVersion: '2.0.0',
    contextHash: ACTIVE_GENERATOR_POLICY.rulesSha256,
  }), scriptSha256: '3'.repeat(64), copySha256: '4'.repeat(64) };
  identity.spokenTextSha256 = spokenTextHash(orderedSegments);
  const generation = {
    status: 'PASS', audioSha256: evidence.audioSha256, modelSha256: identity.modelSha256, voicesSha256: identity.voicesSha256,
    scriptSha256: identity.scriptSha256, copySha256: identity.copySha256, timingSource: evidence.timingSource,
    generator: evidence.generator, synthesisIdentity: identity, cacheKey: voiceCacheKey(identity),
    segments: evidence.cues.map(cue => ({ text: cue.text, ...(cue.spokenText === cue.text ? {} : { spokenText: cue.spokenText }) })),
  };
  return { spec, evidence, generation };
}

function directedEvidenceFixture() {
  const { spec, evidence, generation } = currentEvidenceFixture();
  spec.audio.deliveryMode = 'presenter';
  for (const scene of spec.scenes) {
    scene.voiceDirection = {
      purpose: `讲清${scene.id}`, attitude: '有兴趣', emphasis: [], pace: 'steady', pause: 'balanced', visualEvent: `${scene.id}画面出现`,
    } satisfies VoiceDirection;
  }
  Object.assign(evidence.generator, { deliveryMode: 'presenter', directionMappingVersion: 'kokoro-zh-direction-v1' });
  for (const cue of evidence.cues) {
    const scene = spec.scenes.find(item => item.id === cue.sceneId)!;
    cue.voiceDirection = scene.voiceDirection;
    cue.effectiveProviderControls = resolveVoiceDirection(currentProfile, 'presenter', scene.voiceDirection, scene.voiceover);
  }
  const orderedSegments = evidence.cues.map(cue => cue.spokenText!);
  const directions = evidence.cues.map(cue => cue.voiceDirection as VoiceDirection);
  const identity = { ...createVoiceSynthesisIdentity({
    profile: currentProfile, spokenTextSha256: spokenTextHash(orderedSegments), pronunciationMapSha256: pronunciationMapHash(spec.audio.pronunciationMap),
    orderedSegments, segmentationVersion: 'semantic-scene-direction-v1', modelSha256: '1'.repeat(64), voicesSha256: '2'.repeat(64),
    backendVersion: '0.6.1', frontendVersion: '0.9.4', frontendModelVersion: '1.1', synthesisScriptVersion: '3.0.0',
    contextHash: ACTIVE_GENERATOR_POLICY.rulesSha256, deliveryMode: 'presenter', orderedDirections: directions,
  }), scriptSha256: '3'.repeat(64), copySha256: '4'.repeat(64) };
  Object.assign(generation, {
    generator: evidence.generator,
    synthesisIdentity: identity,
    cacheKey: voiceCacheKey(identity),
    segments: evidence.cues.map(cue => ({ text: cue.text, ...(cue.spokenText === cue.text ? {} : { spokenText: cue.spokenText }),
      voiceDirection: cue.voiceDirection, effectiveProviderControls: cue.effectiveProviderControls })),
  });
  return { spec, evidence, generation };
}

test('current narration binds cue spoken text, pronunciation map and synthesis identity', () => {
  const { spec, evidence, generation } = currentEvidenceFixture();
  const expected = { generation, expectedScriptSha256: '3'.repeat(64), expectedCopySha256: '4'.repeat(64) };
  assert.doesNotThrow(() => validateCurrentNarrationEvidence(evidence, spec, expected));

  const wrongSpeech = structuredClone(evidence);
  wrongSpeech.cues[0]!.spokenText = '错误旁白内容。';
  assert.throws(() => validateCurrentNarrationEvidence(wrongSpeech, spec, { generation }), /spokenText/i);

  const wrongPronunciation = structuredClone(generation);
  wrongPronunciation.synthesisIdentity.pronunciationMapSha256 = '5'.repeat(64);
  wrongPronunciation.cacheKey = voiceCacheKey(wrongPronunciation.synthesisIdentity);
  assert.throws(() => validateCurrentNarrationEvidence(evidence, spec, { generation: wrongPronunciation }), /pronunciation/i);

  const wrongSegments = structuredClone(generation);
  wrongSegments.synthesisIdentity.orderedSegments[0] = '错误旁白内容。';
  wrongSegments.synthesisIdentity.spokenTextSha256 = spokenTextHash(wrongSegments.synthesisIdentity.orderedSegments);
  wrongSegments.cacheKey = voiceCacheKey(wrongSegments.synthesisIdentity);
  assert.throws(() => validateCurrentNarrationEvidence(evidence, spec, { generation: wrongSegments }), /orderedSegments/i);

  const wrongGenerationSegments = structuredClone(generation);
  wrongGenerationSegments.segments[0]!.spokenText = '错误旁白内容。';
  assert.throws(() => validateCurrentNarrationEvidence(evidence, spec, { generation: wrongGenerationSegments }), /generation.*segments/i);

  const wrongCopyBinding = structuredClone(generation);
  wrongCopyBinding.copySha256 = '5'.repeat(64);
  assert.throws(() => validateCurrentNarrationEvidence(evidence, spec, { generation: wrongCopyBinding }), /copySha256/i);
});

test('directed narration binds requested direction, effective native controls and cache identity', () => {
  const { spec, evidence, generation } = directedEvidenceFixture();
  assert.doesNotThrow(() => validateCurrentNarrationEvidence(evidence, spec, { generation }));

  const missingDirection = structuredClone(evidence);
  delete missingDirection.cues[0]!.voiceDirection;
  assert.throws(() => validateCurrentNarrationEvidence(missingDirection, spec, { generation }), /voiceDirection/i);

  const wrongControls = structuredClone(evidence);
  (wrongControls.cues[0]!.effectiveProviderControls as { speed: number }).speed = 1.2;
  assert.throws(() => validateCurrentNarrationEvidence(wrongControls, spec, { generation }), /effectiveProviderControls/i);

  const wrongGeneration = structuredClone(generation);
  (wrongGeneration.segments[0]! as unknown as { voiceDirection: { attitude: string } }).voiceDirection.attitude = '平淡';
  assert.throws(() => validateCurrentNarrationEvidence(evidence, spec, { generation: wrongGeneration }), /generation.*segments/i);

  const wrongIdentity = structuredClone(generation);
  wrongIdentity.synthesisIdentity.orderedDirections![0]!.attitude = '平淡';
  wrongIdentity.cacheKey = voiceCacheKey(wrongIdentity.synthesisIdentity);
  assert.throws(() => validateCurrentNarrationEvidence(evidence, spec, { generation: wrongIdentity }), /orderedDirections/i);
});

test('current whole-passage provider evidence remains valid without a synthetic tts-generation receipt', () => {
  const { spec, evidence } = currentEvidenceFixture();
  evidence.timingSource = 'provider-phoneme-timing';
  evidence.timingEvidence = { path: 'assets/provider-timing.json', sha256: '6'.repeat(64), method: 'Provider phoneme sentence punctuation and PCM sample duration' };
  Object.assign(evidence, { sourceBinding: { paddedVoiceSha256: evidence.audioSha256, speechResynthesized: false } });
  const timing = {
    text: evidence.cues.map(cue => cue.spokenText).join(''),
    timingSource: 'provider-phoneme-output',
    timings: evidence.cues.map(cue => ({ phoneme: '.', start: cue.start, end: cue.end })),
  };
  assert.doesNotThrow(() => validateCurrentNarrationEvidence(evidence, spec, { providerTiming: timing }));
  const trimmedFinalPunctuation = structuredClone(timing);
  const finalEnd = trimmedFinalPunctuation.timings.at(-1)!.end;
  trimmedFinalPunctuation.timings.push({ phoneme: '.', start: finalEnd, end: finalEnd });
  assert.doesNotThrow(() => validateCurrentNarrationEvidence(evidence, spec, { providerTiming: trimmedFinalPunctuation }));

  const zeroDurationSpeech = structuredClone(trimmedFinalPunctuation);
  zeroDurationSpeech.timings.at(-1)!.phoneme = 'ㄅ';
  assert.throws(() => validateCurrentNarrationEvidence(evidence, spec, { providerTiming: zeroDurationSpeech }), /positive/i);
  const changed = structuredClone(timing); changed.text = '错误旁白内容。';
  assert.throws(() => validateCurrentNarrationEvidence(evidence, spec, { providerTiming: changed }), /provider.*text/i);
});

test('timing evidence bytes participate in the normal voice resume fingerprint', async t => {
  const base = path.resolve('.cache/generator-quality-003/tests'); await mkdir(base, { recursive: true });
  const project = await mkdtemp(path.join(base, 'voice-timing-cache '));
  t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(path.join(project, 'reports')); await mkdir(path.join(project, 'assets'));
  await writeFile(path.join(project, 'reports/narration-cues.json'), JSON.stringify({
    timingEvidence: { path: 'assets/provider-timing.json', sha256: '6'.repeat(64), method: 'fixture' },
  }));
  const timing = path.join(project, 'assets/provider-timing.json');
  await writeFile(timing, '{"version":1}');
  const inputs = await narrationTimingEvidenceInputs(project);
  assert.deepEqual(inputs, [timing]);
  const first = await hashFiles(inputs);
  await writeFile(timing, '{"version":2}');
  assert.notEqual(await hashFiles(await narrationTimingEvidenceInputs(project)), first);
});

test('phrase cues reject stale audio hashes, invalid timing, overlap and text drift', () => {
  const spec = narrationSpec();
  const valid = cueEvidence(spec);
  assert.throws(() => validateNarrationCues(valid, spec, 'b'.repeat(64), 45), /audioSha256/);

  const nonFinite = structuredClone(valid);
  nonFinite.cues[0]!.start = Number.NaN;
  assert.throws(() => validateNarrationCues(nonFinite, spec, valid.audioSha256, 45), /finite/);

  const overlap = structuredClone(valid);
  overlap.cues[1]!.start = overlap.cues[0]!.end - 0.1;
  assert.throws(() => validateNarrationCues(overlap, spec, valid.audioSha256, 45), /overlap|ordered/);

  const outsideScene = structuredClone(valid);
  outsideScene.cues[0]!.end = spec.scenes[0]!.actualEndSec! + 0.1;
  assert.throws(() => validateNarrationCues(outsideScene, spec, valid.audioSha256, 45), /scene timing/);

  const textDrift = structuredClone(valid);
  textDrift.cues[1]!.text = '另一句。';
  assert.throws(() => validateNarrationCues(textDrift, spec, valid.audioSha256, 45), /voiceover/);
});

test('transcript timing must be non-empty, finite, positive, ordered and inside audio', () => {
  const valid = [{ text: '第一', start: 0.2, end: 1.1 }, { text: '句', start: 1.1, end: 1.5 }];
  assert.deepEqual(validateTranscriptTiming(valid, 45), valid);
  for (const invalid of [
    [],
    [{ text: '', start: 0, end: 1 }],
    [{ text: 'x', start: Number.POSITIVE_INFINITY, end: 1 }],
    [{ text: 'x', start: 1, end: 1 }],
    [{ text: 'x', start: -0.1, end: 1 }],
    [{ text: 'x', start: 44, end: 45.6 }],
    [{ text: 'x', start: 2, end: 3 }, { text: 'y', start: 1, end: 2 }],
  ]) assert.throws(() => validateTranscriptTiming(invalid, 45));
});

test('phrase transcript is an exact normalized projection of measured TTS segment cues', () => {
  const spec = narrationSpec();
  const evidence = cueEvidence(spec);
  const transcript = evidence.cues.map(({ text, start, end }) => ({ text, start, end }));
  assert.doesNotThrow(() => validatePhraseTranscript(transcript, evidence));
  transcript[0]!.end += 0.01;
  assert.throws(() => validatePhraseTranscript(transcript, evidence), /exactly match/);
});

test('narrated composition must reference the declared audio with real duration and inline exact cues', () => {
  const spec = narrationSpec();
  const evidence = cueEvidence(spec);
  const html = `<div data-composition-id="main"><audio id="narration" src="assets/narration.wav" data-start="0" data-duration="45" data-track-index="20" data-volume="1"></audio><div class="caption-stack"></div><script>var NARRATION_CUES = ${JSON.stringify(evidence.cues)}; NARRATION_CUES.forEach((cue,index) => { const caption = document.createElement('p'); caption.id = 'narration-caption-' + index; caption.dataset.captionStart = String(cue.start); caption.dataset.captionEnd = String(cue.end); document.querySelector('.caption-stack').append(caption); });</script></div>`;
  const transcript = evidence.cues.map(({ text, start, end }) => ({ text, start, end }));
  const passing = checkNarrationComposition(html, spec, evidence, 45, transcript);
  assert.ok(passing.every(check => check.status === 'PASS'));
  assert.equal(passing.some(check => check.id === 'narration.caption-cues'), false);

  const wrong = html
    .replace('assets/narration.wav', 'assets/other.wav')
    .replace('data-duration="45"', 'data-duration="40"')
    .replace(JSON.stringify(evidence.cues), JSON.stringify([{ ...evidence.cues[0], text: '错误字幕。' }, ...evidence.cues.slice(1)]));
  const failing = checkNarrationComposition(wrong, spec, evidence, 45, transcript);
  for (const id of ['narration.audio-element', 'narration.audio-duration', 'narration.caption-source']) {
    assert.equal(failing.find(check => check.id === id)?.status, 'FAIL', id);
  }
});

test('spoken TTS identity stays out of the display-only runtime caption projection', () => {
  const spec = narrationSpec();
  const evidence = cueEvidence(spec);
  for (const cue of evidence.cues) cue.spokenText = cue.text.replace('AI', '人工智能');
  const displayCues = evidence.cues.map(({ sceneId, text, start, end }) => ({ sceneId, text, start, end }));
  const html = `<audio src="assets/narration.wav" data-start="0" data-duration="45" data-track-index="20"></audio><script>const NARRATION_CUES = ${JSON.stringify(displayCues)};</script>`;
  const transcript = evidence.cues.map(({ text, start, end }) => ({ text, start, end }));
  assert.equal(checkNarrationComposition(html, spec, evidence, 45, transcript)
    .find(check => check.id === 'narration.caption-source')?.status, 'PASS');
});
