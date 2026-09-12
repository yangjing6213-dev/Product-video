// SPDX-License-Identifier: Apache-2.0
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { ProductInput, VideoSpec } from '../contracts.ts';
import { resolveProjectAsset, writeExclusiveSnapshot } from '../assets/library.ts';
import { composeVideo } from '../quality/composition.ts';
import { assertVideoSpecCopyApproved } from '../quality/copy.ts';
import { ACTIVE_GENERATOR_POLICY, checkGeneratorSpec, isActiveGeneratorPolicy, trustedGeneratorPolicy, type GeneratorPolicy } from '../quality/policy.ts';
import { assessAcceptance, freezeCreativePlan, resumeCreativePlan, type CreativePlan } from '../quality/plan.ts';
import { validateSceneAction } from '../quality/motion.ts';
import { assertNarrationProfile, validateVoiceProfile } from '../quality/voice-profile.ts';
import { resolveVoiceDirection } from '../quality/voice-direction.ts';
import { validateVoiceDirection } from '../quality/voice-direction.ts';
import { loadQwenEvidence } from '../qa/qwen-narration.ts';
import {
  assertNarrationDirections,
  validateCurrentNarrationEvidence,
  validateNarrationCues,
  validatePhraseTranscript,
  validateTranscriptTiming,
} from '../qa/narration.ts';
import { verifyReleaseEvidence } from '../quality/readiness.ts';
import { inputFor, specFor, verifyProjectBrand } from './project.ts';
import { digest, exists, atomicJson } from './stage-state.ts';
import { REPO, command, recordCommand, ensureSuccess } from './tools.ts';
import { narrationEvidenceContext, snapshotVoiceReuse, voiceReuseEvidenceInputs } from './voice-reuse.ts';

/** Keep optional input fields when comparing an authored specification with its frozen brief. */
export function productInputFromSpec(spec: VideoSpec): ProductInput {
  const { recipeVersion: _recipe, promptVersions: _prompts, narrative: _narrative, scenes: _scenes, qa: _qa, provenance: _provenance, ...input } = spec;
  return input;
}

export function validateGeneratorActions(spec: VideoSpec, cueIds: string[] = []): void {
  if (!spec.generatorPolicy) throw new Error('Common compose requires a current task; preserve historical compositions unchanged');
  const failures = checkGeneratorSpec(spec).filter(check => check.status === 'FAIL');
  if (failures.length) throw new Error(failures.map(check => `${check.id}: ${check.message}`).join('\n'));
  let subjectAction = false;
  for (const scene of spec.scenes) {
    if (!scene.action) throw new Error(`An explicit subject action or justified reading hold is required: ${scene.id}`);
    validateSceneAction(scene.action, { sceneId: scene.id,
      sceneDurationFrames: Math.round(((scene.actualEndSec ?? scene.plannedDurationSec) - (scene.actualStartSec ?? 0)) * spec.output.fps),
      sceneAssetRefs: scene.assetRefs, assets: spec.assets, cueIds,
      backgroundAssetId: scene.backgroundAssetId, workflow: scene.workflow,
    });
    subjectAction ||= scene.action.primitive !== 'reading-hold';
  }
  if (!subjectAction) throw new Error('A film of reading holds does not demonstrate a product subject action');
}

async function projectCueIds(project: string): Promise<string[]> {
  const file = path.join(project, 'reports/narration-cues.json');
  if (!await exists(file)) return [];
  return JSON.parse(await readFile(file, 'utf8')).cues.map((cue: { id?: string }, index: number) => cue.id ?? `cue-${index}`);
}

const CURRENT_VOICE_OUTPUTS = [
  'assets/narration.wav',
  'transcript.json',
  'captions.srt',
  'reports/narration-cues.json',
  'reports/tts-generation.json',
] as const;

function evidenceRecord(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, any>;
}

function pcmWav(bytes: Buffer, label: string): { sampleRate: number; samples: number } {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${label} must be a PCM WAV`);
  let format: { kind: number; channels: number; sampleRate: number; bits: number } | undefined;
  let dataBytes: number | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > bytes.length) throw new Error(`${label} contains a truncated WAV chunk`);
    if (id === 'fmt ' && size >= 16) format = { kind: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4), bits: bytes.readUInt16LE(start + 14) };
    if (id === 'data') dataBytes = size;
    offset = start + size + (size % 2);
  }
  if (!format || format.kind !== 1 || format.channels !== 1 || ![16, 24].includes(format.bits) || !dataBytes || dataBytes % (format.bits / 8)) throw new Error(`${label} must be mono PCM16 or PCM24 audio`);
  return { sampleRate: format.sampleRate, samples: dataBytes / (format.bits / 8) };
}

function srtSeconds(value: string): number {
  const match = /^(\d+):(\d+):(\d+),(\d{3})$/.exec(value);
  if (!match) throw new Error('Cached captions contain an invalid timestamp');
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

export function validateCachedCaptions(value: string, cues: readonly { text: string; start: number; end: number }[]): void {
  const captions = value.trim().split(/\r?\n\r?\n/);
  if (captions.length !== cues.length) throw new Error('Cached captions differ from the measured narration cues');
  captions.forEach((block, index) => {
    const [number, range, ...captionText] = block.split(/\r?\n/), cue = cues[index]!;
    const [start, end] = range?.split(' --> ') ?? [];
    if (Number(number) !== index + 1 || !start || !end || captionText.join('\n') !== cue.text
        || Math.abs(srtSeconds(start) - cue.start) > .00051 || Math.abs(srtSeconds(end) - cue.end) > .00051) {
      throw new Error(`Cached caption ${index} differs from the measured narration cue`);
    }
  });
}

async function reuseCurrentVoice(project: string, spec: VideoSpec, copySha256: string): Promise<boolean> {
  const files = CURRENT_VOICE_OUTPUTS.map(relative => path.join(project, relative));
  const present = await Promise.all(files.map(exists));
  if (!present.some(Boolean)) return false;
  if (!present.every(Boolean)) throw new Error('Existing narration cache is incomplete; preserve it and create a repaired variant');

  const [audioBytes, transcriptBytes, captionsBytes, cueBytes, generationBytes] = await Promise.all([
    readFile(files[0]), readFile(files[1]), readFile(files[2]), readFile(files[3]), readFile(files[4]),
  ]);
  const generation = evidenceRecord(JSON.parse(generationBytes.toString('utf8')), 'Cached TTS generation');
  const context = await narrationEvidenceContext(project, spec, copySha256);
  const wav = pcmWav(audioBytes, 'Cached narration');
  if (generation.status !== 'PASS' || generation.audioSha256 !== digest(audioBytes)
      || generation.specSha256 !== context.specSha256 || generation.scriptSha256 !== context.scriptSha256
      || generation.copySha256 !== context.copySha256 || generation.sampleRate !== wav.sampleRate
      || generation.durationSec !== wav.samples / wav.sampleRate) throw new Error('Cached narration identity or audio bytes changed');
  const cueValue = JSON.parse(cueBytes.toString('utf8'));
  const cues = validateNarrationCues(cueValue, spec, digest(audioBytes), wav.samples / wav.sampleRate);
  const transcript = validateTranscriptTiming(JSON.parse(transcriptBytes.toString('utf8')), wav.samples / wav.sampleRate);
  validatePhraseTranscript(transcript, cues);
  validateCurrentNarrationEvidence(cueValue, context.spec, {
    generation,
    expectedCopySha256: context.copySha256,
    expectedScriptSha256: context.scriptSha256,
    qwenFiles: await loadQwenEvidence(project, spec, cueValue),
  });

  if (spec.audio.voiceProfile?.provider === 'qwen3-tts') {
    validateCachedCaptions(captionsBytes.toString('utf8'), cues.cues);
    return true;
  }

  const identity = evidenceRecord(generation.synthesisIdentity, 'Cached synthesis identity');
  if (identity.synthesisScriptVersion !== '3.0.0') throw new Error('Cached narration uses another synthesis script version');
  if (!Array.isArray(generation.segments) || generation.segments.length !== cues.cues.length) throw new Error('Cached narration segment timing is incomplete');
  for (const [index, value] of generation.segments.entries()) {
    const segment = evidenceRecord(value, `Cached narration segment ${index}`), cue = cues.cues[index]!;
    if (segment.sceneId !== cue.sceneId || segment.start !== cue.start || segment.end !== cue.end
        || segment.sampleRate !== wav.sampleRate || segment.samples !== Math.round((cue.end - cue.start) * wav.sampleRate)) {
      throw new Error(`Cached narration segment ${index} differs from measured cue timing`);
    }
    if (typeof segment.file !== 'string') throw new Error(`Cached narration segment ${index} path is invalid`);
    const segmentBytes = await readFile(await resolveProjectAsset(project, segment.file));
    const segmentWav = pcmWav(segmentBytes, `Cached narration segment ${index}`);
    if (segment.sha256 !== digest(segmentBytes) || segmentWav.sampleRate !== wav.sampleRate || segmentWav.samples !== segment.samples) {
      throw new Error(`Cached narration segment ${index} hash or sample count changed`);
    }
    if (!Array.isArray(segment.phonemeTimings) || !segment.phonemeTimings.length) throw new Error(`Cached narration segment ${index} has no original provider timing`);
    let previousEnd = 0;
    for (const timingValue of segment.phonemeTimings) {
      const timing = evidenceRecord(timingValue, `Cached narration segment ${index} provider timing`);
      if (typeof timing.phoneme !== 'string' || typeof timing.start !== 'number' || typeof timing.end !== 'number'
          || !Number.isFinite(timing.start) || !Number.isFinite(timing.end) || timing.start < previousEnd || timing.end < timing.start
          || timing.end > segment.samples / segment.sampleRate) throw new Error(`Cached narration segment ${index} provider timing changed`);
      previousEnd = timing.end;
    }
  }
  validateCachedCaptions(captionsBytes.toString('utf8'), cues.cues);
  return true;
}

/** Explicit local speech entry; no provider discovery, paid calls or automatic replacement voice. */
export async function synthesizeProjectVoice(project: string, reuseFrom?: string): Promise<string> {
  const root = path.resolve(project, '../..'), spec = await specFor(project);
  if (root !== path.resolve(REPO)) throw new Error('Speech runtime belongs to this complete local repository; use supplied measured audio for external test roots');
  if (!isActiveGeneratorPolicy(spec.generatorPolicy)) throw new Error('Explicit voice generation requires the current task policy');
  if (spec.audio.narrationMode !== 'external-audio' || spec.assets.find(asset => asset.id === spec.audio.externalAudioAssetId)?.path !== 'assets/narration.wav') throw new Error('Declare the generated narration asset at assets/narration.wav as external-audio before voice generation');
  const profile = validateVoiceProfile(spec.audio.voiceProfile, { rejectedVoiceIds: ['zm_011'] });
  if (spec.audio.deliveryMode) for (const scene of spec.scenes.filter(scene => scene.voiceover.trim())) {
    if (profile.provider === 'qwen3-tts') validateVoiceDirection(scene.voiceDirection, scene.voiceover);
    else resolveVoiceDirection(profile, spec.audio.deliveryMode, scene.voiceDirection, scene.voiceover);
  }
  const approvedCopy = await assertVideoSpecCopyApproved(root, project, spec);
  if (reuseFrom) {
    const source = await resolveProjectAsset(root, `projects/${reuseFrom}`), sourceSpec = await specFor(source);
    if (profile.provider !== 'qwen3-tts' || sourceSpec.audio.voiceProfile?.provider !== 'qwen3-tts') throw new Error('Explicit visual-only reuse currently requires original Qwen narration');
    const sourceCopy = await assertVideoSpecCopyApproved(root, source, sourceSpec);
    if (!await reuseCurrentVoice(source, sourceSpec, sourceCopy.copySha256)) throw new Error('Voice reuse source has no verified narration');
    await snapshotVoiceReuse(project, source);
    if (!await reuseCurrentVoice(project, spec, approvedCopy.copySha256)) throw new Error('Voice reuse did not produce verified narration');
    return path.join(project, 'reports/tts-generation.json');
  }
  const profileFile = 'input/current-voice-profile.json', pronunciationFile = 'input/current-pronunciation.json';
  await snapshot(path.join(project, profileFile), `${JSON.stringify(profile, null, 2)}\n`);
  await snapshot(path.join(project, pronunciationFile), `${JSON.stringify({ replacements: Object.entries(spec.audio.pronunciationMap ?? {}).map(([display, spoken]) => ({ display, spoken })) }, null, 2)}\n`);
  const script = path.join(project, 'input/narration-script.json');
  await snapshot(script, `${JSON.stringify({ scenes: spec.scenes.map(scene => ({ sceneId: scene.id, captionSegments: [{ text: scene.voiceover }], ...(spec.audio.deliveryMode ? { voiceDirection: scene.voiceDirection } : {}) })) }, null, 2)}\n`);
  if (await reuseCurrentVoice(project, spec, approvedCopy.copySha256)) return path.join(project, 'reports/tts-generation.json');
  const relative = (file: string) => path.relative(root, path.join(project, file)).replaceAll('\\', '/');
  const qwen = profile.provider === 'qwen3-tts';
  const result = await command(path.join(root, qwen ? '.tools/qwen3-tts-venv/Scripts/python.exe' : '.tools/tts-venv/Scripts/python.exe'), ['-X', 'utf8', path.join(root, qwen ? 'scripts/synthesize-qwen3.py' : 'scripts/synthesize-zh.py'), '--semantic-scenes', '--voice-profile', relative(profileFile), '--pronunciation', relative(pronunciationFile), '--context-hash', ACTIVE_GENERATOR_POLICY.rulesSha256, spec.projectId], { cwd: root, timeoutMs: qwen ? 1_800_000 : 600_000 });
  await recordCommand(project, 'current-local-voice', result); ensureSuccess(result, 'Explicit local Mandarin voice');
  if (qwen && !await reuseCurrentVoice(project, await specFor(project), approvedCopy.copySha256)) throw new Error('Qwen generation did not produce verified narration outputs');
  return path.join(project, 'reports/tts-generation.json');
}

async function snapshot(file: string, bytes: string | Buffer): Promise<void> {
  if (await exists(file)) {
    if (digest(await readFile(file)) !== digest(bytes)) throw new Error(`Existing artifact preserved; create a new variant: ${path.basename(file)}`);
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeExclusiveSnapshot(file, bytes);
}

/** The normal CLI consumes authored structured actions; it does not branch on product names. */
export async function composeProject(project: string): Promise<string> {
  await verifyProjectBrand(project);
  const root = path.resolve(project, '../..'), spec = await specFor(project);
  if (!isDeepStrictEqual(productInputFromSpec(spec), await inputFor(project))) throw new Error('Creative specification differs from the frozen input');
  if (await exists(path.join(project, 'resolved-creative-plan.json'))) {
    await assertGeneratorSnapshot(project);
    return path.join(project, 'index.html');
  }
  validateGeneratorActions(spec, await projectCueIds(project));
  const approvedCopy = await assertVideoSpecCopyApproved(root, project, spec);
  if (spec.audio.voiceProfile?.provider === 'qwen3-tts' && !await reuseCurrentVoice(project, spec, approvedCopy.copySha256)) throw new Error('Generate and verify the selected Qwen voice before composition');
  const fonts = spec.assets.filter(asset => asset.type === 'font').map(asset => {
    if (!asset.fontFamily) throw new Error(`Font family metadata missing: ${asset.id}`);
    return { family: asset.fontFamily, path: asset.path, weight: asset.fontWeight };
  });
  if (!fonts.length) throw new Error('Common composition requires local versioned fonts');
  const gsapPath = 'assets/vendor/gsap.min.js';
  await snapshot(path.join(project, gsapPath), await readFile(path.join(REPO, 'node_modules/gsap/dist/gsap.min.js')));
  let narration;
  if (spec.audio.narrationMode !== 'none') {
    const voice = spec.assets.find(asset => asset.id === spec.audio.externalAudioAssetId);
    if (!voice || spec.audio.narrationMode !== 'external-audio') throw new Error('First synthesize an explicit reviewed local voice configuration and bind measured external audio; no automatic voice fallback');
    const evidence = JSON.parse(await readFile(path.join(project, 'reports/narration-cues.json'), 'utf8'));
    const context = await narrationEvidenceContext(project, spec, approvedCopy.copySha256);
    assertNarrationProfile(context.spec.audio.voiceProfile, evidence, context.spec.generatorPolicy!.rulesSha256, context.spec.audio.deliveryMode);
    assertNarrationDirections(context.spec, evidence);
    const audioBytes = await readFile(path.join(project, voice.path));
    if (evidence.audioSha256 !== digest(audioBytes)) throw new Error('Measured narration hash differs from the declared audio');
    const wav = pcmWav(audioBytes, 'Composition narration');
    narration = { path: voice.path, cues: evidence.cues, durationSec: wav.samples / wav.sampleRate };
  }
  const output = path.join(project, 'index.html');
  await snapshot(output, composeVideo(spec, { gsapPath, fonts, narration }));
  return output;
}

/** Freeze the normal generator's actual input, code entry, media and copy using the existing plan store. */
export async function freezeGeneratorProject(project: string): Promise<void> {
  const root = path.resolve(project, '../..'), spec = await specFor(project);
  if (!spec.generatorPolicy) return;
  if (await exists(path.join(project, 'resolved-creative-plan.json'))) { await assertGeneratorSnapshot(project); return; }
  validateGeneratorActions(spec, await projectCueIds(project));
  if (!isDeepStrictEqual(productInputFromSpec(spec), await inputFor(project))) throw new Error('Frozen input differs from authored specification');
  const copy = await assertVideoSpecCopyApproved(root, project, spec);
  const relative = (file: string) => path.relative(root, path.join(project, file)).replaceAll('\\', '/');
  const textFile = 'reports/frozen-narration.txt';
  await snapshot(path.join(project, textFile), copy.narration.join(''));
  const sources: CreativePlan['sources'] = [];
  const support: string[] = [];
  for (const file of ['transcript.json', 'reports/narration-cues.json', 'reports/tts-generation.json', 'assets/provider-timing.json',
    'assets/music-license.txt', 'assets/music-attribution.txt', 'reports/music-source.json', 'reports/voice-source.json', 'reports/copy-provenance.json',
    'reports/asr-alignment.json', 'reports/asr-raw.json', 'reports/asr-command.json', 'reports/asr-arguments.txt',
    'reports/qwen-runtime-config.json', 'reports/qwen-model-files.json', 'reports/qwen-authorization.json', 'reports/qwen-synthesis-runner.py']) if (await exists(path.join(project, file))) support.push(file);
  support.push(...(await voiceReuseEvidenceInputs(project, true)).map(file => path.relative(project, file).replaceAll('\\', '/')));
  for (const file of [...new Set(['input/product-input.json', 'video-spec.json', 'index.html', 'DESIGN.md', 'SCRIPT.md', 'STORYBOARD.md', textFile,
    'assets/vendor/gsap.min.js', ...spec.assets.map(asset => asset.path), ...support])]) {
    sources.push({ source: `runtime:${file}`, path: relative(file), sha256: digest(await readFile(path.join(project, file))) });
  }
  sources.push({ ...sources.find(source => source.source === 'runtime:index.html')!, source: 'composition-entry' });
  const audio = spec.assets.find(asset => asset.id === spec.audio.externalAudioAssetId);
  const narration: CreativePlan['narration'] = { status: 'PENDING_REVIEW', provider: spec.audio.voiceProfile?.provider ?? 'none', modelId: spec.audio.voiceProfile?.modelId ?? 'none', voiceId: spec.audio.voiceProfile?.voiceId ?? 'none',
    textHash: digest(copy.narration.join('')), pronunciationMapHash: digest(JSON.stringify(spec.audio.pronunciationMap ?? {})) };
  if (audio && spec.audio.narrationMode !== 'none') {
    narration.voicePath = relative(audio.path); narration.voiceHash = digest(await readFile(path.join(project, audio.path)));
    const cues = JSON.parse(await readFile(path.join(project, 'reports/narration-cues.json'), 'utf8')).cues;
    const alignment = 'reports/copy-alignment.json';
    await snapshot(path.join(project, alignment), `${JSON.stringify({ copySha256: copy.copySha256, voiceSha256: narration.voiceHash, cues }, null, 2)}\n`);
    narration.alignmentPath = relative(alignment); narration.alignmentHash = digest(await readFile(path.join(project, alignment)));
  }
  const duration = spec.scenes.at(-1)?.actualEndSec ?? spec.output.targetDurationSec;
  const plan: CreativePlan = { schemaVersion: '1.0', generatorPolicy: spec.generatorPolicy, projectId: spec.projectId, variantId: 'normal-v1', productId: copy.productId,
    brief: spec.product.oneLiner, sources,
    design: { style: spec.brand.motionTone, rationale: { openingReason: spec.scenes[0]!.goal, productSpecificShots: spec.scenes.map(scene => scene.goal), recentAcceptedComparison: [] } },
    frameRate: 30, width: spec.output.width, height: spec.output.height, durationFrames: Math.round(duration * 30),
    shots: spec.scenes.map(scene => ({ id: scene.id, startFrame: Math.round(scene.actualStartSec! * 30), endFrame: Math.round(scene.actualEndSec! * 30), purpose: scene.goal, motion: JSON.stringify(scene.action) })),
    fonts: spec.assets.filter(asset => asset.type === 'font').map(asset => ({ path: relative(asset.path), sha256: sources.find(source => source.source === `runtime:${asset.path}`)!.sha256, family: asset.fontFamily!, version: 'sha256-pinned' })),
    assets: { manifestPath: relative('frozen-brand-assets.json'), sha256: digest(await readFile(path.join(project, 'frozen-brand-assets.json'))) }, copy: { sha256: copy.copySha256 }, narration };
  await freezeCreativePlan(root, project, plan);
}

export async function assertGeneratorSnapshot(project: string): Promise<GeneratorPolicy> {
  const root = path.resolve(project, '../..'), plan = await resumeCreativePlan(root, project);
  const policy = trustedGeneratorPolicy(plan.generatorPolicy);
  if (!policy) throw new Error('Frozen generator policy is unknown or changed');
  const spec = await specFor(project);
  if (!isDeepStrictEqual(spec.generatorPolicy, policy)) throw new Error('Video specification policy differs from its trusted frozen plan');
  await assertVideoSpecCopyApproved(root, project, spec);
  await voiceReuseEvidenceInputs(project);
  for (const source of plan.sources.filter(source => source.source.startsWith('runtime:'))) {
    const file = await resolveProjectAsset(root, `${path.relative(root, project).replaceAll('\\', '/')}/${source.source.slice(8)}`);
    if (digest(await readFile(file)) !== source.sha256) throw new Error(`Runtime asset changed since freezing: ${source.source}`);
  }
  return policy;
}

/** This is a local readiness report, never a publication action or automated subjective approval. */
export async function generatorReleaseStatus(project: string) {
  const acceptance = await assessAcceptance(path.resolve(project, '../..'), project);
  const issues: string[] = [];
  try { await assertGeneratorSnapshot(project); } catch (error) { issues.push(String(error)); }
  const evidence = await verifyReleaseEvidence(project);
  const report = { status: issues.length || evidence.engineering === 'FAIL' ? 'FAIL' : evidence.engineering === 'PASS' && evidence.artifactAcceptance === 'PASS' && [acceptance.visualReview, acceptance.voiceReview, acceptance.audienceReview, acceptance.userAcceptance].every(review => review.status === 'PASS') ? 'PASS' : 'PARTIAL',
    engineering: evidence.engineering, artifactAcceptance: evidence.artifactAcceptance,
    scope: 'local quality readiness only; publishing is not performed', ...acceptance, issues: [...acceptance.issues, ...issues, ...evidence.issues] };
  await atomicJson(path.join(project, 'reports/generator-readiness.json'), report);
  return report;
}
