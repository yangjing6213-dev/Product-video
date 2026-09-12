// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VOICE_DIRECTION_MAPPING_VERSION,
  resolveVoiceDirection,
  validateVoiceDirection,
  type VoiceDirection,
} from '../../src/quality/voice-direction.ts';

const profile = { speed: 1, sentencePauseSec: 0.3, clausePauseSec: 0.12 };
const direction: VoiceDirection = {
  purpose: '提出问题', attitude: '有兴趣，带一点疑问', emphasis: ['真的学会'],
  pace: 'steady', pause: 'balanced', visualEvent: '收藏夹数量出现',
};

test('voice direction keeps unsupported expression as metadata and maps only native controls', () => {
  const resolved = resolveVoiceDirection(profile, 'presenter', direction, '收藏夹越满，真的学会了吗？');
  assert.deepEqual(resolved, {
    mappingVersion: VOICE_DIRECTION_MAPPING_VERSION,
    deliveryMode: 'presenter',
    speed: 0.98,
    sentencePauseSec: 0.27,
    clausePauseSec: 0.108,
    metadataOnly: ['purpose', 'attitude', 'emphasis', 'visualEvent'],
    unsupported: ['emotion', 'pitch', 'energy', 'word-level-emphasis'],
  });
  assert.equal('emotion' in resolved, false);
});

test('presenter delivery uses a stronger but bounded pace and pause mapping', () => {
  const resolved = resolveVoiceDirection(profile, 'presenter', {
    ...direction, pace: 'brisk', pause: 'deliberate',
  }, '收藏夹越满，真的学会了吗？');
  assert.equal(resolved.speed, 1.08);
  assert.equal(resolved.sentencePauseSec, 0.42);
  assert.equal(resolved.clausePauseSec, 0.168);
});

test('direction rejects invented emphasis and invalid enums instead of passing unsupported tags', () => {
  assert.throws(() => validateVoiceDirection({ ...direction, emphasis: ['不存在的重点'] }, '收藏夹越满，真的学会了吗？'), /emphasis/i);
  assert.throws(() => validateVoiceDirection({ ...direction, pace: 'excited' }, '收藏夹越满，真的学会了吗？'), /direction/i);
  assert.throws(() => resolveVoiceDirection({ ...profile, speed: 1.3 }, 'presenter', { ...direction, pace: 'brisk' }, '收藏夹越满，真的学会了吗？'), /range/i);
});
