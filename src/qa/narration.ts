import type { CheckResult, VideoSpec } from '../contracts.ts';

/** The user-selected silent poster has its own reading time after spoken content. */
export function narrationTimelineEnd(spec: VideoSpec): number | null | undefined {
  const last = spec.scenes.at(-1);
  if (!last?.authorPosterAssetId) return last?.actualEndSec;
  const previous = spec.scenes.at(-2);
  if (last.voiceover.trim() || last.caption?.trim()) throw new Error('Author poster must be silent');
  if (!previous || previous.actualEndSec !== last.actualStartSec) throw new Error('Author poster must be adjacent to the preceding narration scene');
  return previous.actualEndSec;
}
import { isDeepStrictEqual } from 'node:util';
import { ACTIVE_GENERATOR_POLICY } from '../quality/policy.ts';
import {
  applyPronunciationMap,
  assertNarrationProfile,
  pronunciationMapHash,
  spokenTextHash,
  voiceCacheKey,
  qwenReferenceControls,
  QWEN_DIRECTION_MAPPING_VERSION,
} from '../quality/voice-profile.ts';
import { validateQwenNarration, type QwenEvidenceFiles } from './qwen-narration.ts';
import {
  VOICE_DIRECTION_MAPPING_VERSION,
  resolveVoiceDirection,
  validateDeliveryMode,
  validateVoiceDirection,
} from '../quality/voice-direction.ts';

export interface TranscriptEntry {
  text: string;
  start: number;
  end: number;
}

export interface NarrationCue extends TranscriptEntry {
  sceneId: string;
  spokenText?: string;
  voiceDirection?: unknown;
  effectiveProviderControls?: unknown;
}

export interface NarrationGenerator {
  backend: string;
  backendVersion: string;
  model: string;
  frontend: string;
  frontendVersion: string;
  voice: string;
  deliveryMode?: string;
  directionMappingVersion?: string;
}

export interface NarrationCues {
  schemaVersion: '1.0';
  timingSource: 'tts-segment-duration' | 'provider-phoneme-timing' | 'whisper-cpp-asr';
  timingEvidence?: { path: string; sha256: string; method: string };
  audioSha256: string;
  generator: NarrationGenerator;
  cues: NarrationCue[];
}

export interface CurrentNarrationEvidenceOptions {
  generation?: unknown;
  providerTiming?: unknown;
  expectedCopySha256?: string;
  expectedScriptSha256?: string;
  qwenFiles?: QwenEvidenceFiles;
}

const SHA = /^[0-9a-f]{64}$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

/** Verify that a directed current narration binds the requested metadata to the real Kokoro controls.
 * Old frozen specifications have neither deliveryMode nor voiceDirection and retain their existing evidence contract.
 */
export function assertNarrationDirections(spec: VideoSpec, evidenceValue: unknown): void {
  const voicedScenes = spec.scenes.filter(scene => scene.voiceover.trim());
  const modeValue = spec.audio.deliveryMode;
  const hasDirection = voicedScenes.some(scene => scene.voiceDirection !== undefined);
  if (modeValue === undefined && !hasDirection) return;
  const mode = validateDeliveryMode(modeValue);
  if (!spec.audio.voiceProfile || voicedScenes.some(scene => scene.voiceDirection === undefined)) {
    throw new Error('Audio delivery mode and every voiced scene direction are required together');
  }
  const evidence = record(evidenceValue, 'Narration direction evidence');
  const generator = record(evidence.generator, 'Narration direction generator');
  const qwen = spec.audio.voiceProfile.provider === 'qwen3-tts';
  if (generator.deliveryMode !== mode || generator.directionMappingVersion !== (qwen ? QWEN_DIRECTION_MAPPING_VERSION : VOICE_DIRECTION_MAPPING_VERSION)) {
    throw new Error('Narration direction generator does not match the requested delivery mode and mapping');
  }
  if (!Array.isArray(evidence.cues) || evidence.cues.length === 0) throw new Error('Directed narration cues are required');
  const scenes = new Map(voicedScenes.map(scene => [scene.id, scene]));
  for (const [index, value] of evidence.cues.entries()) {
    const cue = record(value, `Directed narration cue ${index}`);
    const scene = scenes.get(nonEmptyString(cue.sceneId, `Directed narration cue ${index}.sceneId`));
    if (!scene) throw new Error(`Directed narration cue ${index} references a scene without speech`);
    const expectedDirection = validateVoiceDirection(scene.voiceDirection, scene.voiceover);
    const expectedControls = spec.audio.voiceProfile.provider === 'qwen3-tts'
      ? qwenReferenceControls(spec.audio.voiceProfile, mode)
      : resolveVoiceDirection(spec.audio.voiceProfile, mode, expectedDirection, scene.voiceover);
    if (!isDeepStrictEqual(cue.voiceDirection, expectedDirection)) throw new Error(`Directed narration cue ${index}.voiceDirection differs from the specification`);
    if (!isDeepStrictEqual(cue.effectiveProviderControls, expectedControls)) throw new Error(`Directed narration cue ${index}.effectiveProviderControls differs from the actual provider mapping`);
  }
  for (const scene of voicedScenes) {
    if (!evidence.cues.some(value => record(value, 'Directed narration cue').sceneId === scene.id)) {
      throw new Error(`Directed narration evidence is missing scene ${scene.id}`);
    }
  }
}

function transcriptEntry(value: unknown, label: string): TranscriptEntry {
  const item = record(value, label);
  const text = nonEmptyString(item.text, `${label}.text`);
  const start = finiteNumber(item.start, `${label}.start`);
  const end = finiteNumber(item.end, `${label}.end`);
  if (start < 0 || end <= start) throw new Error(`${label} timing must be non-negative and positive`);
  return { text, start, end };
}

export function validateTranscriptTiming(value: unknown, audioDurationSec: number): TranscriptEntry[] {
  if (!Number.isFinite(audioDurationSec) || audioDurationSec <= 0) throw new Error('Audio duration must be finite and positive');
  if (!Array.isArray(value) || value.length === 0) throw new Error('Transcript must contain timed entries');
  const entries = value.map((item, index) => transcriptEntry(item, `Transcript entry ${index}`));
  let previousEnd = 0;
  for (const entry of entries) {
    if (entry.start < previousEnd) throw new Error('Transcript timing must be ordered and non-overlapping');
    if (entry.end > audioDurationSec + 0.5) throw new Error('Transcript timing extends beyond narration audio');
    previousEnd = entry.end;
  }
  return entries;
}

export function validatePhraseTranscript(entries: TranscriptEntry[], evidence: NarrationCues): void {
  const expected = evidence.cues.map(({ text, start, end }) => ({ text, start, end }));
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    throw new Error('Phrase transcript must exactly match measured TTS segment cues');
  }
}

export function validateNarrationCues(
  value: unknown,
  spec: VideoSpec,
  audioSha256: string,
  audioDurationSec: number,
): NarrationCues {
  const input = record(value, 'Narration cues');
  if (input.schemaVersion !== '1.0') throw new Error('Narration cues schemaVersion must be 1.0');
  if (!['tts-segment-duration', 'provider-phoneme-timing', 'whisper-cpp-asr'].includes(String(input.timingSource))) throw new Error('Narration cues timingSource must be measured TTS segments, actual provider phoneme timing or bound ASR');
  if (input.timingSource === 'whisper-cpp-asr' && spec.audio.voiceProfile?.provider !== 'qwen3-tts') throw new Error('ASR phrase cues require the explicit Qwen evidence contract');
  let timingEvidence: NarrationCues['timingEvidence'];
  if (input.timingSource === 'provider-phoneme-timing' || input.timingSource === 'whisper-cpp-asr') {
    const evidence = record(input.timingEvidence, 'Provider timing evidence');
    const file = nonEmptyString(evidence.path, 'Provider timing evidence path');
    if (/^(?:[A-Za-z]:|[\\/])|\.\.|[\\]/.test(file) || typeof evidence.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.sha256)) throw new Error('Provider timing evidence requires a project-relative file and SHA-256');
    timingEvidence = { path: file, sha256: evidence.sha256, method: nonEmptyString(evidence.method, 'Provider timing evidence method') };
  }
  if (typeof input.audioSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.audioSha256) || input.audioSha256 !== audioSha256) {
    throw new Error('Narration cues audioSha256 must match the final narration audio');
  }
  const generatorInput = record(input.generator, 'Narration cues generator');
  const generator: NarrationGenerator = {
    backend: nonEmptyString(generatorInput.backend, 'generator.backend'),
    backendVersion: nonEmptyString(generatorInput.backendVersion, 'generator.backendVersion'),
    model: nonEmptyString(generatorInput.model, 'generator.model'),
    frontend: nonEmptyString(generatorInput.frontend, 'generator.frontend'),
    frontendVersion: nonEmptyString(generatorInput.frontendVersion, 'generator.frontendVersion'),
    voice: nonEmptyString(generatorInput.voice, 'generator.voice'),
    ...(typeof generatorInput.deliveryMode === 'string' ? { deliveryMode: generatorInput.deliveryMode } : {}),
    ...(typeof generatorInput.directionMappingVersion === 'string' ? { directionMappingVersion: generatorInput.directionMappingVersion } : {}),
  };
  if (!Array.isArray(input.cues) || input.cues.length === 0) throw new Error('Narration cues must be non-empty');
  const scenes = new Map(spec.scenes.map(scene => [scene.id, scene]));
  const cues: NarrationCue[] = [];
  let previousEnd = 0;
  for (const [index, valueCue] of input.cues.entries()) {
    const cueInput = record(valueCue, `Narration cue ${index}`);
    const spokenText = cueInput.spokenText === undefined ? undefined : nonEmptyString(cueInput.spokenText, `Narration cue ${index}.spokenText`);
    const cue = { sceneId: nonEmptyString(cueInput.sceneId, `Narration cue ${index}.sceneId`), ...transcriptEntry(cueInput, `Narration cue ${index}`),
      ...(spokenText ? { spokenText } : {}),
      ...(cueInput.voiceDirection === undefined ? {} : { voiceDirection: cueInput.voiceDirection }),
      ...(cueInput.effectiveProviderControls === undefined ? {} : { effectiveProviderControls: cueInput.effectiveProviderControls }) };
    const scene = scenes.get(cue.sceneId);
    if (!scene || scene.actualStartSec === null || scene.actualEndSec === null || cue.start < scene.actualStartSec || cue.end > scene.actualEndSec) {
      throw new Error(`Narration cue ${index} must stay within its scene timing`);
    }
    if (cue.start < previousEnd) throw new Error('Narration cues must be ordered and non-overlapping');
    if (cue.end > audioDurationSec + 0.5) throw new Error('Narration cue timing extends beyond narration audio');
    cues.push(cue);
    previousEnd = cue.end;
  }
  for (const scene of spec.scenes) {
    const expected = scene.voiceover.trim();
    const actual = cues.filter(cue => cue.sceneId === scene.id).map(cue => cue.text).join('');
    if (actual !== expected) throw new Error(`Narration cues must reconstruct voiceover for ${scene.id}`);
  }
  return {
    schemaVersion: '1.0',
    timingSource: input.timingSource as NarrationCues['timingSource'],
    ...(timingEvidence ? { timingEvidence } : {}),
    audioSha256: input.audioSha256,
    generator,
    cues,
  };
}

/** Current generator tasks bind approved display copy to the actual text sent to TTS.
 * Historical tasks keep their original cue contract and do not enter this validator.
 */
export function validateCurrentNarrationEvidence(
  evidenceValue: unknown,
  spec: VideoSpec,
  options: CurrentNarrationEvidenceOptions = {},
): void {
  if (!spec.generatorPolicy || !isDeepStrictEqual(spec.generatorPolicy, ACTIVE_GENERATOR_POLICY)) return;
  const evidence = record(evidenceValue, 'Current narration evidence');
  assertNarrationProfile(spec.audio.voiceProfile, evidence, spec.generatorPolicy.rulesSha256, spec.audio.deliveryMode);
  assertNarrationDirections(spec, evidence);
  if (spec.audio.voiceProfile?.provider === 'qwen3-tts') {
    validateQwenNarration(evidence, spec, options.generation, options.qwenFiles, options.expectedCopySha256, options.expectedScriptSha256);
    return;
  }
  if (!Array.isArray(evidence.cues) || evidence.cues.length === 0) throw new Error('Current narration cues are required');
  const orderedSegments = evidence.cues.map((value, index) => {
    const cue = record(value, `Current narration cue ${index}`);
    const display = nonEmptyString(cue.text, `Current narration cue ${index}.text`);
    const expected = applyPronunciationMap(display, spec.audio.pronunciationMap);
    const actual = cue.spokenText === undefined ? display : nonEmptyString(cue.spokenText, `Current narration cue ${index}.spokenText`);
    if (actual !== expected) throw new Error(`Current narration cue ${index}.spokenText differs from the pronunciation map`);
    return actual;
  });
  if (evidence.timingSource === 'provider-phoneme-timing') {
    const binding = record(evidence.sourceBinding, 'Whole-passage provider sourceBinding');
    if (binding.paddedVoiceSha256 !== evidence.audioSha256 || binding.speechResynthesized !== false) {
      throw new Error('Whole-passage provider sourceBinding must bind the unchanged narration audio');
    }
    const timing = record(options.providerTiming, 'Provider timing evidence');
    if (timing.timingSource !== 'provider-phoneme-output' || timing.text !== orderedSegments.join('')) {
      throw new Error('Provider timing text differs from current cue spokenText');
    }
    if (!Array.isArray(timing.timings) || timing.timings.length === 0) throw new Error('Provider phoneme timings are required');
    let previousEnd = 0;
    const boundaries: number[] = [];
    for (const [index, value] of timing.timings.entries()) {
      const item = record(value, `Provider timing ${index}`);
      if (typeof item.phoneme !== 'string' || item.phoneme.length === 0) throw new Error(`Provider timing ${index}.phoneme must be a string token`);
      const phoneme = item.phoneme;
      const start = finiteNumber(item.start, `Provider timing ${index}.start`);
      const end = finiteNumber(item.end, `Provider timing ${index}.end`);
      const silentToken = /^[\p{P}\p{Z}\s]+$/u.test(phoneme);
      if (start < 0 || start < previousEnd || end < start || (end === start && !silentToken)) {
        throw new Error('Provider phoneme timings must be ordered; audible tokens require positive duration');
      }
      boundaries.push(start, end); previousEnd = end;
    }
    const nearBoundary = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && boundaries.some(boundary => Math.abs(boundary - value) <= 1e-6);
    for (const [index, value] of evidence.cues.entries()) {
      const cue = record(value, `Current narration cue ${index}`);
      if (!nearBoundary(cue.start) || !nearBoundary(cue.end)) throw new Error(`Current narration cue ${index} is not bound to provider phoneme timing`);
    }
    return;
  }

  const generation = record(options.generation, 'Current tts-generation evidence');
  if (generation.status !== 'PASS' || generation.audioSha256 !== evidence.audioSha256) throw new Error('Current tts-generation must bind the narration audio');
  if (generation.timingSource !== evidence.timingSource) throw new Error('Current tts-generation timingSource differs from narration cues');
  assertNarrationProfile(spec.audio.voiceProfile, { ...evidence, generator: generation.generator }, spec.generatorPolicy.rulesSha256, spec.audio.deliveryMode);
  const identity = record(generation.synthesisIdentity, 'Current synthesisIdentity');
  const directed = spec.audio.deliveryMode !== undefined;
  const orderedDirections = directed ? evidence.cues.map((value, index) => {
    const cue = record(value, `Current narration cue ${index}`);
    return validateVoiceDirection(cue.voiceDirection);
  }) : undefined;
  const expectedIdentity = {
    profileHash: record(evidence.generator, 'Current narration generator').profileHash,
    spokenTextSha256: spokenTextHash(orderedSegments),
    pronunciationMapSha256: pronunciationMapHash(spec.audio.pronunciationMap),
    segmentationVersion: directed ? 'semantic-scene-direction-v1' : 'semantic-scene-v1',
    contextHash: spec.generatorPolicy.rulesSha256,
    ...(directed ? {
      deliveryMode: spec.audio.deliveryMode,
      orderedDirections,
      orderedEffectiveControls: evidence.cues.map((value, index) => record(value, `Current narration cue ${index}`).effectiveProviderControls),
      directionMappingVersion: VOICE_DIRECTION_MAPPING_VERSION,
    } : {}),
  };
  if (!Array.isArray(identity.orderedSegments) || !isDeepStrictEqual(identity.orderedSegments, orderedSegments)) {
    throw new Error('Current synthesisIdentity.orderedSegments differs from cue spokenText');
  }
  if (!Array.isArray(generation.segments) || generation.segments.length !== evidence.cues.length) {
    throw new Error('Current tts-generation segments differ from narration cues');
  }
  const generationSegments = generation.segments.map((value, index) => {
    const segment = record(value, `Current tts-generation segment ${index}`);
    const display = nonEmptyString(segment.text, `Current tts-generation segment ${index}.text`);
    return {
      text: display,
      spokenText: segment.spokenText === undefined ? display : nonEmptyString(segment.spokenText, `Current tts-generation segment ${index}.spokenText`),
      ...(directed ? { voiceDirection: segment.voiceDirection, effectiveProviderControls: segment.effectiveProviderControls } : {}),
    };
  });
  const cueSegments = evidence.cues.map((value, index) => {
    const cue = record(value, `Current narration cue ${index}`);
    const display = nonEmptyString(cue.text, `Current narration cue ${index}.text`);
    return { text: display, spokenText: orderedSegments[index],
      ...(directed ? { voiceDirection: cue.voiceDirection, effectiveProviderControls: cue.effectiveProviderControls } : {}) };
  });
  if (!isDeepStrictEqual(generationSegments, cueSegments)) throw new Error('Current tts-generation segments differ from narration cue spokenText');
  for (const [field, expected] of Object.entries(expectedIdentity)) {
    if (!isDeepStrictEqual(identity[field], expected)) throw new Error(`Current synthesisIdentity.${field} differs from narration evidence`);
  }
  for (const field of ['modelSha256', 'voicesSha256', 'scriptSha256', 'copySha256']) {
    if (!SHA.test(String(identity[field] ?? ''))) throw new Error(`Current synthesisIdentity.${field} is invalid`);
  }
  if (generation.modelSha256 !== identity.modelSha256 || generation.voicesSha256 !== identity.voicesSha256) {
    throw new Error('Current tts-generation model or voices hash differs from synthesisIdentity');
  }
  if (generation.scriptSha256 !== identity.scriptSha256) throw new Error('Current tts-generation scriptSha256 differs from synthesisIdentity');
  if (generation.copySha256 !== identity.copySha256) throw new Error('Current tts-generation copySha256 differs from synthesisIdentity');
  if (options.expectedCopySha256 !== undefined && identity.copySha256 !== options.expectedCopySha256) throw new Error('Current synthesisIdentity.copySha256 differs from approved copy');
  if (options.expectedScriptSha256 !== undefined && identity.scriptSha256 !== options.expectedScriptSha256) throw new Error('Current synthesisIdentity.scriptSha256 differs from narration script');
  if (generation.cacheKey !== voiceCacheKey(identity as ReturnType<typeof import('../quality/voice-profile.ts').createVoiceSynthesisIdentity>)) {
    throw new Error('Current tts-generation cacheKey differs from synthesisIdentity');
  }
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match?.[1] ?? match?.[2];
}

function normalizedMediaPath(value: string | undefined): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value).replace(/^\.\//, '').replaceAll('\\', '/');
  } catch {
    return '';
  }
}

function assignedArray(html: string, variable: 'NARRATION_CUES' | 'TRANSCRIPT'): unknown {
  const assignment = new RegExp(`\\b(?:var|const|let)\\s+${variable}\\s*=\\s*`, 'g').exec(html);
  if (!assignment) return null;
  const start = assignment.index + assignment[0].length;
  if (html[start] !== '[') return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '[') depth += 1;
    else if (character === ']' && --depth === 0) {
      try { return JSON.parse(html.slice(start, index + 1)); } catch { return null; }
    }
  }
  return null;
}

export function checkNarrationComposition(
  html: string,
  spec: VideoSpec,
  evidence: NarrationCues | null,
  audioDurationSec: number,
  transcript: TranscriptEntry[],
): CheckResult[] {
  if (spec.audio.narrationMode === 'none') return [];
  const expectedAsset = spec.audio.narrationMode === 'external-audio'
    ? spec.assets.find(asset => asset.id === spec.audio.externalAudioAssetId)?.path
    : 'narration.wav';
  const audioTags = html.match(/<audio\b[^>]*>/gi) ?? [];
  const matching = audioTags.find(tag => normalizedMediaPath(attribute(tag, 'src')) === normalizedMediaPath(expectedAsset));
  const candidate = matching ?? audioTags[0];
  const start = Number(attribute(candidate ?? '', 'data-start'));
  const track = Number(attribute(candidate ?? '', 'data-track-index'));
  const duration = Number(attribute(candidate ?? '', 'data-duration'));
  const audioElementPass = Boolean(matching) && start === 0 && Number.isInteger(track) && track >= 0;
  const expectedCaptions = evidence
    ? evidence.cues.map(({ sceneId, text, start, end }) => ({ sceneId, text, start, end }))
    : transcript;
  const inlineCaptions = assignedArray(html, evidence ? 'NARRATION_CUES' : 'TRANSCRIPT');
  return [
    {
      id: 'narration.audio-element',
      status: audioElementPass ? 'PASS' : 'FAIL',
      message: audioElementPass ? 'Composition references the declared narration audio on a timed track' : 'Composition must contain a timed audio element for the declared narration asset',
    },
    {
      id: 'narration.audio-duration',
      status: matching && Number.isFinite(duration) && Math.abs(duration - audioDurationSec) <= 0.05 ? 'PASS' : 'FAIL',
      message: 'Composition audio duration must match the probed narration duration',
    },
    {
      id: 'narration.caption-source',
      status: JSON.stringify(inlineCaptions) === JSON.stringify(expectedCaptions) ? 'PASS' : 'FAIL',
      message: evidence
        ? 'Inline NARRATION_CUES must exactly match the validated phrase-level cue evidence'
        : 'Inline TRANSCRIPT must exactly match the validated ASR transcript',
    },
  ];
}
