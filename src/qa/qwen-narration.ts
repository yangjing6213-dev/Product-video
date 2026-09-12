// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { VideoSpec } from '../contracts.ts';
import { resolveProjectAsset } from '../assets/library.ts';
import { digest } from '../pipeline/stage-state.ts';
import { applyPronunciationMap, pronunciationMapHash, validateVoiceProfile, voiceProfileHash } from '../quality/voice-profile.ts';

type Row = Record<string, any>;
const SHA = /^[a-f0-9]{64}$/;
const row = (value: unknown, label: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Row;
};
// These four equivalent written forms normalize script only; they never replace spoken words.
const WRITTEN_EQUIVALENTS: Record<string, string> = { 變: '变', 現: '现', 實: '实', 價: '价' };
export const lexicalQwenText = (text: string): string => text.normalize('NFKC').toLowerCase()
  .replace(/[變現實價]/gu, character => WRITTEN_EQUIVALENTS[character]!).replace(/[^\p{L}\p{N}]/gu, '');
const lexical = lexicalQwenText;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
export const qwenCacheKey = (identity: unknown): string => digest(JSON.stringify(canonical(identity)));

export interface QwenEvidenceFiles { alignment: Row; raw: Row; command: Row; selection: Row;
  runtime: { config: Row; modelManifest: Row; authorization: Row } }

function runtimeBaseFiles(files: QwenEvidenceFiles, generation: Row): Row[] {
  const { config, modelManifest: manifest, authorization } = files.runtime;
  if (config.referenceSelection && (config.referenceSelection.sha256 !== generation.synthesisIdentity?.selectionSha256
      || config.referenceSelection.path !== generation.sourceReceipt?.identity?.profile?.selectionPath
      || files.selection.referenceVoiceCloningAuthorized !== true || files.selection.productionIntegrationAuthorized !== true)) {
    throw new Error('Current reference production differs from its user authorization');
  }
  const bindings = row(generation.runtimeEvidence, 'Frozen Qwen runtime evidence');
  if (manifest.status !== 'PASS' || authorization.decision !== 'APPROVED' || authorization.noExternalUpload !== true
      || manifest.authorizationSha256 !== bindings.authorization?.sha256 || authorization.metadataSha256 !== manifest.metadataSha256
      || config.authorization?.sha256 !== bindings.authorization?.sha256 || config.modelManifest?.sha256 !== bindings.modelManifest?.sha256) {
    throw new Error('Qwen runtime authorization and model manifest differ');
  }
  const model = row(config.model, 'Configured Qwen Base model');
  if (model.repoId !== 'Qwen/Qwen3-TTS-12Hz-1.7B-Base' || !/^[a-f0-9]{40}$/.test(model.revision)
      || !SHA.test(model.sha256) || !Array.isArray(manifest.models)) throw new Error('Only the pinned Qwen Base model is supported');
  const groups = manifest.models.filter((item: Row) => item.repoId === model.repoId);
  if (groups.length !== 1 || groups[0].revision !== model.revision || groups[0].license !== 'apache-2.0'
      || !Array.isArray(groups[0].files) || groups[0].files.length !== groups[0].fileCount || !groups[0].files.length) throw new Error('Qwen Base manifest identity differs');
  const modelFiles: Row[] = groups[0].files;
  if (new Set(modelFiles.map(file => file.path)).size !== modelFiles.length || modelFiles.some(file => !SHA.test(String(file.sha256))
      || typeof file.sourcePath !== 'string' || file.path !== `${model.path}/${file.sourcePath}`)) throw new Error('Qwen Base file mapping differs');
  if (digest(JSON.stringify(modelFiles.map(file => ({ path: file.sourcePath, sha256: file.sha256 })))) !== model.sha256) throw new Error('Qwen Base aggregate differs from the preserved file manifest');
  const source = row(row(generation.sourceReceipt, 'Qwen source receipt').identity, 'Qwen source identity');
  if (!isDeepStrictEqual(source.model, model) || source.seed !== config.seed || !isDeepStrictEqual(source.generation, config.generation)) throw new Error('Qwen source model or actual synthesis controls differ from frozen runtime');
  if (source.packageLockSha256 !== config.packageLock?.sha256 || files.command.identity?.executableSha256 !== config.asr?.executable?.sha256) throw new Error('Qwen source dependency lock or ASR executable differs from runtime');
  if (!isDeepStrictEqual(config.asr?.model, files.alignment.model)
      || !Array.isArray(manifest.files) || !manifest.files.some((file: Row) => file.repoId === 'ggerganov/whisper.cpp'
        && file.path === files.alignment.model.path && file.sha256 === files.alignment.model.sha256)) throw new Error('ASR model differs from reviewed runtime manifest');
  if (generation.sourceMode === 'reference-synthesis' && generation.modelSha256 !== model.sha256) throw new Error('Generated Qwen model hash differs from its real Base files');
  if (generation.synthesisIdentity?.seed !== config.seed) throw new Error('Qwen synthesis seed differs from runtime');
  return modelFiles;
}

/** Read the actual local evidence, not just a report claiming ASR ran. */
export async function loadQwenEvidence(project: string, spec: VideoSpec, cueValue: unknown): Promise<QwenEvidenceFiles | undefined> {
  if (spec.audio.voiceProfile?.provider !== 'qwen3-tts') return undefined;
  const profile = validateVoiceProfile(spec.audio.voiceProfile);
  if (profile.provider !== 'qwen3-tts') throw new Error('Qwen profile required');
  const root = path.resolve(project, '../..'), evidence = row(cueValue, 'Qwen cues');
  const readBound = async (base: string, descriptor: unknown, label: string): Promise<Buffer> => {
    const binding = row(descriptor, label);
    if (typeof binding.path !== 'string' || !SHA.test(String(binding.sha256))) throw new Error(`${label} requires path and SHA-256`);
    const bytes = await readFile(await resolveProjectAsset(base, binding.path));
    if (digest(bytes) !== binding.sha256) throw new Error(`${label} file hash changed`);
    return bytes;
  };
  const alignment = row(JSON.parse((await readBound(project, evidence.timingEvidence, 'ASR alignment')).toString('utf8')), 'ASR alignment');
  const raw = row(JSON.parse((await readBound(project, alignment.raw, 'ASR raw')).toString('utf8')), 'ASR raw');
  const command = row(JSON.parse((await readBound(project, alignment.command, 'ASR command')).toString('utf8')), 'ASR command');
  const argumentsBytes = await readBound(project, command.argumentsFile, 'ASR UTF-8 arguments');
  let argumentsText: string;
  try { argumentsText = new TextDecoder('utf-8', { fatal: true }).decode(argumentsBytes); }
  catch { throw new Error('ASR argument file is not valid UTF-8'); }
  const argumentsLines = argumentsText.replace(/\r?\n$/, '').split(/\r?\n/);
  if (!isDeepStrictEqual(argumentsLines, command.expandedArguments) || !Array.isArray(command.command)
      || !command.command.some((argument: unknown) => typeof argument === 'string' && argument.startsWith('@'))
      || !argumentsLines.includes('-nfa') || !argumentsLines.includes('-dtw')) throw new Error('ASR command differs from preserved UTF-8 arguments or DTW settings');
  await readBound(root, alignment.model, 'ASR model');
  const selection = row(JSON.parse((await readBound(root, { path: profile.selectionPath, sha256: profile.selectionSha256 }, 'Voice selection')).toString('utf8')), 'Voice selection');
  await readBound(root, { path: selection.rawPath, sha256: profile.referenceAudioSha256 }, 'Selected reference audio');
  const generation = row(JSON.parse(await readFile(path.join(project, 'reports/tts-generation.json'), 'utf8')), 'Qwen generation');
  const bindings = row(generation.runtimeEvidence, 'Frozen Qwen runtime evidence');
  const runtime = { config: row(JSON.parse((await readBound(project, bindings.config, 'Frozen Qwen runtime config')).toString('utf8')), 'Runtime config'),
    modelManifest: row(JSON.parse((await readBound(project, bindings.modelManifest, 'Frozen Qwen model manifest')).toString('utf8')), 'Model manifest'),
    authorization: row(JSON.parse((await readBound(project, bindings.authorization, 'Frozen Qwen authorization')).toString('utf8')), 'Authorization') };
  const files = { alignment, raw, command, selection, runtime }, baseFiles = runtimeBaseFiles(files, generation);
  for (const [binding, label] of [[runtime.config.asr.executable, 'ASR executable'], [runtime.config.ffmpeg, 'Audio conversion executable'],
    [runtime.config.packageLock, 'Qwen dependency lock']] as const) await readBound(root, binding, label);
  await readBound(project, bindings.synthesisRunner, 'Historical Qwen synthesis runner');
  if (bindings.synthesisRunner?.sha256 !== generation.sourceReceipt?.runnerSha256) throw new Error('Qwen source runner differs from its preserved historical snapshot');
  const inputBytes = await readBound(root, command.input, 'ASR converted input');
  const inputIndex = argumentsLines.indexOf('-f'), conversion = row(command.conversion, 'ASR input conversion');
  if (inputIndex < 0 || argumentsLines[inputIndex + 1] !== command.input.path || digest(inputBytes) !== command.inputSha256
      || conversion.exitCode !== 0 || conversion.inputAudioSha256 !== evidence.audioSha256
      || conversion.outputSha256 !== command.inputSha256 || conversion.executableSha256 !== runtime.config.ffmpeg.sha256) throw new Error('ASR converted input differs from the recorded source audio conversion');
  if (generation.sourceMode === 'reference-synthesis') for (const file of baseFiles) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(await resolveProjectAsset(root, file.path))) hash.update(chunk);
    if (hash.digest('hex') !== file.sha256) throw new Error('Qwen Base model file hash changed');
  }
  return files;
}

/** Include linked evidence in replay fingerprints; preserve the original reports for audit. */
export async function qwenEvidenceInputs(project: string, spec: VideoSpec): Promise<string[]> {
  if (spec.audio.voiceProfile?.provider !== 'qwen3-tts') return [];
  const profile = spec.audio.voiceProfile, root = path.resolve(project, '../..');
  const cue = row(JSON.parse(await readFile(path.join(project, 'reports/narration-cues.json'), 'utf8')), 'Qwen cues');
  const alignmentFile = await resolveProjectAsset(project, row(cue.timingEvidence, 'ASR evidence').path);
  const alignment = row(JSON.parse(await readFile(alignmentFile, 'utf8')), 'ASR alignment');
  const selectionFile = await resolveProjectAsset(root, profile.selectionPath);
  const selection = row(JSON.parse(await readFile(selectionFile, 'utf8')), 'Voice selection');
  const commandFile = await resolveProjectAsset(project, row(alignment.command, 'ASR command').path);
  const command = row(JSON.parse(await readFile(commandFile, 'utf8')), 'ASR command');
  const generation = row(JSON.parse(await readFile(path.join(project, 'reports/tts-generation.json'), 'utf8')), 'Qwen generation');
  const runtime = row(generation.runtimeEvidence, 'Frozen Qwen runtime evidence');
  const runtimeFiles = await Promise.all(['config', 'modelManifest', 'authorization', 'synthesisRunner'].map(name => resolveProjectAsset(project, row(runtime[name], 'Qwen runtime file').path)));
  const config = row(JSON.parse(await readFile(runtimeFiles[0]!, 'utf8')), 'Qwen runtime config');
  const manifest = row(JSON.parse(await readFile(runtimeFiles[1]!, 'utf8')), 'Qwen model manifest');
  const baseFiles = generation.sourceMode === 'reference-synthesis'
    ? (manifest.models as Row[]).find(group => group.repoId === config.model.repoId)?.files ?? [] : [];
  return [alignmentFile, await resolveProjectAsset(project, row(alignment.raw, 'ASR raw').path),
    commandFile, await resolveProjectAsset(project, row(command.argumentsFile, 'ASR UTF-8 arguments').path),
    await resolveProjectAsset(root, row(alignment.model, 'ASR model').path), selectionFile,
    await resolveProjectAsset(root, selection.rawPath), ...runtimeFiles,
    ...await Promise.all([config.asr.executable, config.ffmpeg, config.packageLock, command.input].map(binding => resolveProjectAsset(root, row(binding, 'Qwen runtime resource').path))),
    ...await Promise.all(baseFiles.map((file: Row) => resolveProjectAsset(root, file.path)))];
}

/** Subtitle display intervals use adjacent actual DTW anchors; original offsets remain in raw JSON. */
export function whisperTokens(value: unknown, audioDurationSec?: number): Array<{ text: string; start: number; end: number }> {
  if (audioDurationSec !== undefined && (!Number.isFinite(audioDurationSec) || audioDurationSec <= 0)) throw new Error('Measured narration duration must be finite and positive');
  const raw = row(value, 'Whisper raw');
  if (!Array.isArray(raw.transcription) || !raw.transcription.length) throw new Error('Whisper raw transcription is required');
  const rawTokens = raw.transcription.flatMap((entry: unknown) => {
    const segment = row(entry, 'Whisper segment');
    if (!Array.isArray(segment.tokens)) throw new Error('Whisper raw token evidence is required');
    return segment.tokens;
  }).filter((value: unknown) => {
    const token = row(value, 'Whisper token');
    return typeof token.text === 'string' && !token.text.startsWith('[_') && !token.text.startsWith('<|') && lexical(token.text).length > 0;
  });
  const tokens = rawTokens.map((value: unknown, index: number) => {
    const token = row(value, 'Whisper token'), offsets = row(token.offsets, 'Whisper token offsets');
    const start = token.t_dtw / 100, rawEnd = index + 1 < rawTokens.length ? row(rawTokens[index + 1], 'Next Whisper token').t_dtw / 100
      : row(row(raw.transcription.at(-1), 'Final Whisper segment').offsets, 'Final Whisper offsets').to / 1000;
    // Whisper may retain decoder padding after the actual WAV ends. Only the final display interval is capped.
    const end = index + 1 === rawTokens.length && audioDurationSec !== undefined ? Math.min(rawEnd, audioDurationSec) : rawEnd;
    // Classic decoder offsets can be reversed in real output; they are retained as evidence, not used for timing.
    // The independently recorded DTW anchors below must still be ordered and inside the actual WAV.
    if (typeof offsets.from !== 'number' || typeof offsets.to !== 'number' || !Number.isFinite(offsets.from) || !Number.isFinite(offsets.to)
        || offsets.from < 0 || offsets.to < 0 || !Number.isFinite(start) || !Number.isFinite(end)
        || start < 0 || end < start || !Number.isSafeInteger(token.t_dtw) || token.t_dtw < 0
        || audioDurationSec !== undefined && (start > audioDurationSec || end > audioDurationSec)) throw new Error('Whisper token must retain measured offsets and actual DTW timing inside the audio');
    return { text: token.text as string, start, end };
  });
  if (!tokens.length || tokens.some((token, index) => index > 0 && token.start < tokens[index - 1]!.end)) throw new Error('Whisper tokens must be ordered and non-overlapping');
  return tokens;
}

export function validateQwenNarration(
  evidenceValue: unknown, spec: VideoSpec, generationValue: unknown, files: QwenEvidenceFiles | undefined,
  expectedCopySha256?: string, expectedScriptSha256?: string,
): void {
  const profile = validateVoiceProfile(spec.audio.voiceProfile);
  if (profile.provider !== 'qwen3-tts') throw new Error('Qwen profile required');
  const evidence = row(evidenceValue, 'Qwen cues'), generation = row(generationValue, 'Qwen generation');
  if (!files) throw new Error('Qwen requires actual ASR evidence files');
  const { alignment, raw, command, selection } = files;
  runtimeBaseFiles(files, generation);
  if (selection.decision !== 'APPROVED' || selection.selectedVoice !== profile.voiceId || selection.rawSha256 !== profile.referenceAudioSha256
      || typeof selection.userAnswer !== 'string' || !selection.userAnswer.trim()) throw new Error('Qwen selected voice is not the accepted B reference');
  if (evidence.timingSource !== 'whisper-cpp-asr' || alignment.timingSource !== 'whisper-cpp-asr' || alignment.status !== 'PASS'
      || alignment.schemaVersion !== '1.0' || evidence.timingEvidence?.method !== 'whisper-cpp-dtw-anchors-v1') throw new Error('Qwen requires genuine Whisper ASR alignment');
  if (generation.status !== 'PASS' || generation.timingSource !== evidence.timingSource || generation.audioSha256 !== evidence.audioSha256
      || alignment.audioSha256 !== evidence.audioSha256 || alignment.selectionSha256 !== profile.selectionSha256
      || generation.alignmentSha256 !== evidence.timingEvidence.sha256) throw new Error('Qwen audio or alignment binding changed');
  for (const hash of [generation.audioSha256, generation.copySha256, generation.scriptSha256, generation.modelSha256, generation.asrModelSha256]) {
    if (!SHA.test(String(hash))) throw new Error('Qwen generation requires exact resource hashes');
  }
  if (!isDeepStrictEqual(generation.generator, evidence.generator) || generation.sourceMode !== evidence.generator.sourceMode) throw new Error('Qwen generator or sourceMode differs between evidence files');
  if (command.exitCode !== 0 || command.audioSha256 !== evidence.audioSha256 || command.modelSha256 !== alignment.model.sha256
      || command.rawSha256 !== alignment.raw.sha256 || !Array.isArray(command.command) || !command.command.length) throw new Error('ASR command must bind its successful execution, audio, model and raw output');
  if (alignment.model.sha256 !== generation.asrModelSha256) throw new Error('ASR model differs from generation');
  if (alignment.copySha256 !== generation.copySha256 || expectedCopySha256 !== undefined && generation.copySha256 !== expectedCopySha256
      || expectedScriptSha256 !== undefined && generation.scriptSha256 !== expectedScriptSha256) throw new Error('Qwen copy or script binding changed');
  if (typeof generation.durationSec !== 'number' || !Number.isFinite(generation.durationSec) || generation.durationSec <= 0
      || alignment.audioDurationSec !== generation.durationSec) throw new Error('ASR duration must match the measured narration WAV duration');
  const tokens = whisperTokens(raw, generation.durationSec);
  if (!isDeepStrictEqual(alignment.tokens, tokens)) throw new Error('ASR normalized tokens differ from original raw token timestamps');
  const omitted = alignment.omittedDiscourseTokens ?? [];
  if (!Array.isArray(omitted)) throw new Error('ASR discourse differences must be an explicit array');
  if (omitted.length) {
    const exception = row(omitted[0], 'ASR discourse omission');
    const review = row(alignment.omissionReview, 'ASR omission review');
    const display = spec.scenes.map(scene => scene.voiceover).join(''), questionEnd = display.search(/[？?]/u);
    const question = questionEnd < 0 ? '' : lexical(applyPronunciationMap(display.slice(0, questionEnd + 1), spec.audio.pronunciationMap));
    if (omitted.length !== 1 || generation.sourceMode !== 'reuse-approved-audio' || evidence.audioSha256 !== profile.referenceAudioSha256
        || review.audioSha256 !== evidence.audioSha256 || review.rawSha256 !== alignment.raw.sha256 || review.selectionSha256 !== profile.selectionSha256
        || review.reviewerType !== 'model' || review.humanReviewed !== false || typeof review.reason !== 'string' || !review.reason.trim()
        || !Number.isSafeInteger(exception.tokenIndex) || exception.tokenIndex < 0 || exception.tokenIndex >= tokens.length
        || exception.text !== '啊' || exception.reviewerType !== 'model' || exception.humanReviewed !== false
        || typeof exception.reason !== 'string' || !exception.reason.trim()
        || tokens[exception.tokenIndex]?.text !== '啊' || !question
        || lexical(tokens.slice(0, exception.tokenIndex).map(token => token.text).join('')) !== question) {
      throw new Error('Only the explicitly recorded discourse token in the exact accepted B sample may be omitted from display');
    }
  }
  const textMatch = omitted.length ? 'MATCH_WITH_DOCUMENTED_DISCOURSE_OMISSION' : 'MATCH_AFTER_WRITTEN_NORMALIZATION';
  if (alignment.lexicalMatch !== textMatch) throw new Error('ASR text match must truthfully report written normalization and any discourse omission');
  if (!Array.isArray(evidence.cues) || !Array.isArray(alignment.cues) || evidence.cues.length !== alignment.cues.length) throw new Error('ASR cue coverage differs');
  let nextToken = 0;
  for (const [index, cueValue] of evidence.cues.entries()) {
    const cue = row(cueValue, 'Qwen cue'), bound = row(alignment.cues[index], 'ASR aligned cue');
    for (const field of ['sceneId', 'text', 'spokenText', 'start', 'end']) if (cue[field] !== bound[field]) throw new Error(`ASR cue ${index}.${field} differs from preserved alignment`);
    if (!Number.isSafeInteger(bound.tokenStart) || !Number.isSafeInteger(bound.tokenEnd) || bound.tokenStart !== nextToken
        || bound.tokenEnd < bound.tokenStart || bound.tokenEnd >= tokens.length) throw new Error('ASR cue token range is incomplete or overlaps');
    const spoken = applyPronunciationMap(cue.text, spec.audio.pronunciationMap);
    const selected = tokens.slice(bound.tokenStart, bound.tokenEnd + 1);
    const included = selected.filter((_token, offset) => !omitted.some((item: Row) => item.tokenIndex === bound.tokenStart + offset));
    if (omitted.some((item: Row) => item.tokenIndex >= bound.tokenStart && item.tokenIndex <= bound.tokenEnd)
        && (bound.tokenEnd !== omitted[0].tokenIndex || !/[？?]$/u.test(cue.text))) throw new Error('The accepted B discourse token belongs only to its approved question ending');
    if (cue.spokenText !== spoken || lexical(included.map(token => token.text).join('')) !== lexical(spoken)) throw new Error('ASR words differ from approved spoken text');
    if (cue.end <= cue.start || cue.start !== selected[0]!.start || cue.end !== selected.at(-1)!.end) throw new Error('ASR cue timestamps must be actual positive token-group boundaries');
    nextToken = bound.tokenEnd + 1;
  }
  if (nextToken !== tokens.length) throw new Error('ASR includes unbound speech');
  const spokenText = evidence.cues.map((cue: Row) => cue.spokenText).join('');
  if (alignment.spokenTextSha256 !== digest(spokenText)) throw new Error('ASR spoken text hash changed');
  const sourceReceipt = row(generation.sourceReceipt, 'Qwen source receipt'), source = row(sourceReceipt.identity, 'Qwen source identity');
  if (sourceReceipt.audioSha256 !== generation.audioSha256 || sourceReceipt.sourceMode !== generation.sourceMode
      || source.sourceMode !== generation.sourceMode || sourceReceipt.inference?.inferenceCount !== (generation.sourceMode === 'reuse-approved-audio' ? 0 : 1)) {
    throw new Error('Qwen source receipt differs from final audio, source mode or inference count');
  }
  if (source.text !== spokenText || source.copySha256 !== generation.copySha256 || !isDeepStrictEqual(source.profile, profile)
      || !isDeepStrictEqual(source.pronunciation, spec.audio.pronunciationMap ?? {})) throw new Error('Qwen source receipt differs from actual copy, pronunciation or reference profile');
  if (generation.crossTextVoiceIdentity !== 'NOT_VERIFIED') throw new Error('Technical narration evidence cannot claim accepted cross-text voice identity');
  const identity = row(generation.synthesisIdentity, 'Qwen synthesis identity');
  const expected = { profileHash: voiceProfileHash(profile), selectionSha256: profile.selectionSha256,
    referenceAudioSha256: profile.referenceAudioSha256, copySha256: generation.copySha256, scriptSha256: generation.scriptSha256,
    spokenTextSha256: digest(spokenText), pronunciationMapSha256: pronunciationMapHash(spec.audio.pronunciationMap),
    contextHash: spec.generatorPolicy?.rulesSha256, modelSha256: generation.modelSha256, asrModelSha256: generation.asrModelSha256,
    sourceMode: generation.sourceMode, settings: evidence.generator.settings, synthesisScriptVersion: 'qwen3-production-v1' };
  for (const [key, value] of Object.entries(expected)) if (!isDeepStrictEqual(identity[key], value)) throw new Error(`Qwen synthesis identity ${key} changed`);
  if (!Number.isSafeInteger(identity.seed) || !SHA.test(identity.sourceAudioSha256) || generation.cacheKey !== qwenCacheKey(identity)) throw new Error('Qwen cache identity changed');
  if (generation.sourceMode === 'reuse-approved-audio') {
    if (identity.sourceAudioSha256 !== profile.referenceAudioSha256 || generation.audioSha256 !== profile.referenceAudioSha256
        || generation.modelSha256 !== selection.identity?.modelAggregateSha256 || identity.spokenTextSha256 !== selection.identity?.spokenTextSha256
        || evidence.generator.model !== selection.identity?.modelId?.split('/').at(-1)) throw new Error('Reused reference audio must retain its selected original bytes, text and actual model');
  } else if (generation.sourceMode !== 'reference-synthesis' || identity.sourceAudioSha256 !== generation.audioSha256) throw new Error('Qwen source audio identity is invalid');
}
