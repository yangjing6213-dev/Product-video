import type { CheckResult, VideoSpec } from '../contracts.ts';

export interface TranscriptEntry {
  text: string;
  start: number;
  end: number;
}

export interface NarrationCue extends TranscriptEntry {
  sceneId: string;
}

export interface NarrationGenerator {
  backend: string;
  backendVersion: string;
  model: string;
  frontend: string;
  frontendVersion: string;
  voice: string;
}

export interface NarrationCues {
  schemaVersion: '1.0';
  timingSource: 'tts-segment-duration';
  audioSha256: string;
  generator: NarrationGenerator;
  cues: NarrationCue[];
}

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
  if (input.timingSource !== 'tts-segment-duration') throw new Error('Narration cues timingSource must be tts-segment-duration');
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
  };
  if (!Array.isArray(input.cues) || input.cues.length === 0) throw new Error('Narration cues must be non-empty');
  const scenes = new Map(spec.scenes.map(scene => [scene.id, scene]));
  const cues: NarrationCue[] = [];
  let previousEnd = 0;
  for (const [index, valueCue] of input.cues.entries()) {
    const cueInput = record(valueCue, `Narration cue ${index}`);
    const cue = { sceneId: nonEmptyString(cueInput.sceneId, `Narration cue ${index}.sceneId`), ...transcriptEntry(cueInput, `Narration cue ${index}`) };
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
    timingSource: 'tts-segment-duration',
    audioSha256: input.audioSha256,
    generator,
    cues,
  };
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
  const expectedCaptions = evidence?.cues ?? transcript;
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
