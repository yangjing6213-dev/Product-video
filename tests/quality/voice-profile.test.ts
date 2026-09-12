// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertNarrationProfile,
  createVoiceSynthesisIdentity,
  spokenTextHash,
  validateVoiceApproval,
  validateVoiceProfile,
  voiceCacheKey,
  voiceProfileHash,
  type VoiceProfile,
} from '../../src/quality/voice-profile.ts';
import type { VoiceDirection } from '../../src/quality/voice-direction.ts';

const SHA = {
  text: '1'.repeat(64), pronunciation: '2'.repeat(64), model: '3'.repeat(64), voices: '4'.repeat(64),
  context: '5'.repeat(64), sample: '6'.repeat(64),
};
const profile: VoiceProfile = {
  provider: 'kokoro-onnx', modelId: 'kokoro-v1.1-zh', voiceId: 'zm_029', locale: 'zh-CN',
  speed: 1, sentencePauseSec: 0.3, clausePauseSec: 0.12,
};

test('voice policy rejects a denied voice without changing historical profiles', () => {
  assert.deepEqual(validateVoiceProfile(profile, { availableVoiceIds: ['zm_009', 'zm_011', 'zm_029'], rejectedVoiceIds: ['zm_011'] }), profile);
  assert.throws(() => validateVoiceProfile({ ...profile, voiceId: 'zm_011' }, { rejectedVoiceIds: ['zm_011'] }), /rejected/i);
  assert.doesNotThrow(() => validateVoiceProfile({ ...profile, voiceId: 'zm_011' }));
});

test('voice profile requires the explicit local Mandarin contract', () => {
  for (const invalid of [
    { ...profile, provider: 'fallback-provider' }, { ...profile, modelId: 'other-model' },
    { ...profile, voiceId: 'zf_001' }, { ...profile, locale: 'zh' },
    { ...profile, speed: 0 }, { ...profile, sentencePauseSec: -1 }, { ...profile, clausePauseSec: Number.NaN },
  ]) assert.throws(() => validateVoiceProfile(invalid), /voice profile/i);
  assert.throws(() => validateVoiceProfile(profile, { availableVoiceIds: ['zm_009'] }), /unavailable/i);
});

test('profile hash binds every reusable voice setting', () => {
  const original = voiceProfileHash(profile);
  for (const [key, value] of Object.entries({ voiceId: 'zm_009', speed: 1.05, sentencePauseSec: 0.2, clausePauseSec: 0.08 })) {
    assert.notEqual(voiceProfileHash({ ...profile, [key]: value }), original, key);
  }
});

function identity(overrides = {}) {
  return createVoiceSynthesisIdentity({
    profile, spokenTextSha256: SHA.text, pronunciationMapSha256: SHA.pronunciation,
    orderedSegments: ['第一段。', '第二段。'], segmentationVersion: 'semantic-scene-v1',
    modelSha256: SHA.model, voicesSha256: SHA.voices, backendVersion: '0.6.1',
    frontendVersion: '0.9.4', frontendModelVersion: '1.1', synthesisScriptVersion: '2.0.0',
    contextHash: SHA.context, ...overrides,
  });
}

test('raw speech cache binds spoken segments, pronunciation, runtime and rules context', () => {
  const first = voiceCacheKey(identity());
  for (const changed of [
    { orderedSegments: ['第二段。', '第一段。'] }, { pronunciationMapSha256: '7'.repeat(64) },
    { backendVersion: '0.6.2' }, { frontendVersion: '0.9.5' },
    { synthesisScriptVersion: '2.0.1' }, { contextHash: '8'.repeat(64) },
    { profile: { ...profile, speed: 1.05 } },
  ]) assert.notEqual(voiceCacheKey(identity(changed)), first);
});

test('new speech cache identity binds delivery mode and ordered voice directions while old identities stay byte-compatible', () => {
  const oldIdentity = identity();
  assert.equal('deliveryMode' in oldIdentity, false);
  const directions: VoiceDirection[] = [
    { purpose: '提出问题', attitude: '好奇', emphasis: ['第一段'], pace: 'steady', pause: 'balanced', visualEvent: '问题出现' },
    { purpose: '给出判断', attitude: '有把握', emphasis: ['第二段'], pace: 'slower', pause: 'deliberate', visualEvent: '结果出现' },
  ];
  const directed = identity({ deliveryMode: 'natural', orderedDirections: directions });
  assert.notEqual(voiceCacheKey(directed), voiceCacheKey(oldIdentity));
  assert.notEqual(voiceCacheKey(identity({ deliveryMode: 'presenter', orderedDirections: directions })), voiceCacheKey(directed));
  assert.notEqual(voiceCacheKey(identity({ deliveryMode: 'natural', orderedDirections: [{ ...directions[0]!, attitude: '认真' }, directions[1]!] })), voiceCacheKey(directed));
  assert.deepEqual(directed.orderedDirections, directions);
  assert.equal(directed.directionMappingVersion, 'kokoro-zh-direction-v1');
  assert.throws(() => identity({ deliveryMode: 'natural' }), /directions/i);
});

test('spoken text hash ignores segmentation while the cache identity keeps segment order', () => {
  assert.equal(spokenTextHash(['第一段。', '第二段。']), 'cdccc50938b9276afa3998f7091d86b435ef0d0fe3bc261d04731f8ae71e73fe');
  assert.equal(spokenTextHash(['第一段。第二段。']), 'cdccc50938b9276afa3998f7091d86b435ef0d0fe3bc261d04731f8ae71e73fe');
  assert.notEqual(voiceCacheKey(identity({ orderedSegments: ['第一段。', '第二段。'] })),
                  voiceCacheKey(identity({ orderedSegments: ['第一段。第二段。'] })));
});

test('approval must bind the exact profile and audition bytes', () => {
  const approval = { status: 'APPROVED' as const, profileHash: voiceProfileHash(profile), sampleAudioHash: SHA.sample };
  assert.deepEqual(validateVoiceApproval(profile, approval), approval);
  assert.throws(() => validateVoiceApproval(profile, { ...approval, profileHash: '9'.repeat(64) }), /profile/i);
  assert.throws(() => validateVoiceApproval(profile, true as unknown), /approval/i);
});

function narrationEvidence(overrides: Record<string, unknown> = {}) {
  return {
    qualityRulesSha256: SHA.context,
    contextHash: SHA.context,
    generator: {
      provider: 'kokoro-onnx', backend: 'kokoro-onnx', model: 'kokoro-v1.1-zh', voice: 'zm_029', locale: 'zh-CN',
      profileHash: voiceProfileHash(profile),
      settings: { speed: 1, sentencePauseSec: 0.3, clausePauseSec: 0.12, trim: true, continuous: false, isPhonemes: true },
    },
    ...overrides,
  };
}

test('narration evidence must bind the complete profile and current rules context', () => {
  assert.doesNotThrow(() => assertNarrationProfile(profile, narrationEvidence(), SHA.context));
  assert.throws(() => assertNarrationProfile(undefined, narrationEvidence(), SHA.context), /profile/i);
  assert.throws(() => assertNarrationProfile(profile, undefined, SHA.context), /evidence/i);
  assert.throws(() => assertNarrationProfile({ ...profile, voiceId: 'zm_011' }, narrationEvidence(), SHA.context), /rejected/i);
  assert.throws(() => assertNarrationProfile(profile, narrationEvidence({ qualityRulesSha256: '7'.repeat(64) }), SHA.context), /qualityRulesSha256/);
  assert.throws(() => assertNarrationProfile(profile, narrationEvidence({ contextHash: '7'.repeat(64) }), SHA.context), /contextHash/);
});

test('narration evidence rejects every generator identity mismatch', () => {
  const baseline = narrationEvidence().generator as Record<string, unknown>;
  for (const [field, value] of Object.entries({
    provider: 'other', backend: 'other', model: 'other', voice: 'zm_031', locale: 'zh', profileHash: '7'.repeat(64),
  })) {
    assert.throws(() => assertNarrationProfile(profile, narrationEvidence({ generator: { ...baseline, [field]: value } }), SHA.context), new RegExp(field, 'i'));
  }
  for (const [field, value] of Object.entries({
    speed: 1.1, sentencePauseSec: 0.2, clausePauseSec: 0.08, trim: false, continuous: true, isPhonemes: false,
  })) {
    const settings = baseline.settings as Record<string, unknown>;
    assert.throws(() => assertNarrationProfile(profile, narrationEvidence({ generator: { ...baseline, settings: { ...settings, [field]: value } } }), SHA.context), new RegExp(field, 'i'));
  }
});
