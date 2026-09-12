// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCachedCaptions } from '../../src/pipeline/generator.ts';

test('cached narration SRT must retain measured cue indexes, text, and timing', () => {
  const cues = [{ text: '第一段。', start: 0.5083333333333333, end: 3.991625 }];
  const valid = '1\n00:00:00,508 --> 00:00:03,992\n第一段。\n';
  assert.doesNotThrow(() => validateCachedCaptions(valid, cues));
  assert.throws(() => validateCachedCaptions(valid.replace('00:00:00,508', '00:00:00,608'), cues), /measured narration cue/i);
  assert.throws(() => validateCachedCaptions(valid.replace(/^1/, '2'), cues), /measured narration cue/i);
  assert.throws(() => validateCachedCaptions(valid.replace('第一段。', '另一段。'), cues), /measured narration cue/i);
});
