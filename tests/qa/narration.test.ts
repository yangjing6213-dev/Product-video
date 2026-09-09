import assert from 'node:assert/strict';
import test from 'node:test';

import type { VideoSpec } from '../../src/contracts.ts';
import {
  checkNarrationComposition,
  validateNarrationCues,
  validatePhraseTranscript,
  validateTranscriptTiming,
  type NarrationCues,
} from '../../src/qa/narration.ts';
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
