// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { normalizedRelativePath, resolveProjectAsset, verifyFrozenBrandAssets, writeExclusiveSnapshot } from '../assets/library.ts';
import { digest, exists } from '../pipeline/stage-state.ts';
import { readCopyDraft } from './copy.ts';
import type { GeneratorPolicy } from './policy.ts';

export const CREATIVE_PLAN_FILE = 'resolved-creative-plan.json';
export interface AudioMix {
  schemaVersion: '1.0'; voiceSha256: string;
  music: { path: string; sha256: string; licenseId: string; licensePath: string; licenseSha256: string };
  mixPath: string; mixSha256: string; durationSec: number;
  voiceOffsetSec: number; voiceGainDb: number; musicOffsetSec: number; musicGainDb: number;
  fadeInSec: number; fadeOutSec: number;
}
export interface CreativePlan {
  generatorPolicy?: GeneratorPolicy;
  schemaVersion: '1.0'; projectId: string; variantId: string; productId: string;
  brief: string; sources: Array<{ source: string; sha256: string; path?: string }>;
  design: { style: string; rationale: { openingReason: string; productSpecificShots: string[];
    recentAcceptedComparison: Array<{ projectId: string; difference: string }> } };
  frameRate: 30; width: number; height: number; durationFrames: number;
  shots: Array<{ id: string; startFrame: number; endFrame: number; purpose: string; motion: string }>;
  fonts: Array<{ path: string; sha256: string; family: string; version: string }>;
  assets: { manifestPath: string; sha256: string };
  copy?: { sha256: string };
  audioMix?: AudioMix;
  narration: { status: 'PENDING_REVIEW' | 'APPROVED'; provider: string; modelId: string; voiceId: string;
    textHash: string; pronunciationMapHash: string; voicePath?: string; voiceHash?: string;
    alignmentPath?: string; alignmentHash?: string };
}
export interface ResolvedCreativePlan extends CreativePlan { authoredPlanSha256: string; resolvedPlanSha256: string }
export type ReviewDimension = 'visual' | 'voice' | 'audience' | 'final';
export interface HumanDecisionInput {
  dimension: ReviewDimension; decision: 'ACCEPTED' | 'REJECTED'; userInstruction: string;
  videoPath?: string; voicePath?: string;
}
export interface HumanDecision extends HumanDecisionInput {
  schemaVersion: '1.0'; reviewerType: 'USER'; recordId: string; sequence: number; recordedAt: string;
  planSha256: string; videoSha256?: string; voiceSha256?: string;
  mixPath?: string; mixSha256?: string;
}
export interface ReviewAssessment {
  status: 'NOT_RUN' | 'PARTIAL' | 'PASS'; decision: 'NOT_RUN' | 'STALE' | 'REJECTED' | 'ACCEPTED';
  recordId?: string; reason?: string;
}
export interface AcceptanceAssessment {
  visualReview: ReviewAssessment; voiceReview: ReviewAssessment; audienceReview: ReviewAssessment; userAcceptance: ReviewAssessment;
  planSha256?: string; issues: string[];
}
const SHA = /^[0-9a-f]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const missing = (): ReviewAssessment => ({ status: 'NOT_RUN', decision: 'NOT_RUN' });
const stale = (reason: string): ReviewAssessment => ({ status: 'NOT_RUN', decision: 'STALE', reason });

export function validateAudioMix(mix: AudioMix, voiceHash: string | undefined, durationSec: number): void {
  if (!mix || mix.schemaVersion !== '1.0' || !voiceHash || mix.voiceSha256 !== voiceHash || !SHA.test(mix.mixSha256) || mix.mixSha256 === voiceHash) throw new Error('Audio mix must bind a distinct mix and the exact raw voice');
  if (!mix.music || !SHA.test(mix.music.sha256) || !SHA.test(mix.music.licenseSha256) || !text(mix.music.licenseId) || /^(unknown|unreviewed|pending|none)$/i.test(mix.music.licenseId.trim())) throw new Error('Audio mix requires reviewed music license evidence');
  for (const file of [mix.music.path, mix.music.licensePath, mix.mixPath]) normalizedRelativePath(file);
  if (!Number.isFinite(mix.durationSec) || mix.durationSec <= 0 || Math.abs(mix.durationSec - durationSec) > 0.000001) throw new Error('Audio mix duration differs from the frozen timeline');
  if ([mix.voiceOffsetSec, mix.musicOffsetSec, mix.fadeInSec, mix.fadeOutSec].some(value => !Number.isFinite(value) || value < 0 || value >= durationSec) || mix.musicOffsetSec + mix.fadeInSec + mix.fadeOutSec > durationSec) throw new Error('Invalid audio mix offset or fade timing');
  if ([mix.voiceGainDb, mix.musicGainDb].some(value => !Number.isFinite(value) || value < -96 || value > 12)) throw new Error('Invalid audio mix gain');
}

function canonical(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)]));
    return item;
  };
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

function resolvedPlanHash(plan: ResolvedCreativePlan): string {
  const { resolvedPlanSha256: _checksum, ...payload } = plan;
  return digest(canonical(payload));
}

function validatePlan(plan: CreativePlan): void {
  if (!plan || plan.schemaVersion !== '1.0' || ![plan.projectId, plan.variantId, plan.productId].every(id => typeof id === 'string' && ID.test(id))) throw new Error('Invalid creative plan identity');
  const rationale = plan.design?.rationale;
  if (!text(plan.brief) || !text(plan.design?.style) || !text(rationale?.openingReason) || !Array.isArray(rationale?.productSpecificShots) || !rationale.productSpecificShots.length || !rationale.productSpecificShots.every(text)) throw new Error('A product-specific creative rationale is required');
  if (!Array.isArray(rationale.recentAcceptedComparison) || rationale.recentAcceptedComparison.length > 5 || rationale.recentAcceptedComparison.some(entry => !text(entry.projectId) || !text(entry.difference))) throw new Error('Compare at most five accepted works using authored reasons');
  if (plan.frameRate !== 30 || ![plan.width, plan.height, plan.durationFrames].every(v => Number.isSafeInteger(v) && v > 0)) throw new Error('Invalid frozen frame parameters');
  if (!Array.isArray(plan.shots) || !plan.shots.length) throw new Error('A shot timeline is required');
  const ids = new Set<string>(); let coverage = 0;
  for (const shot of [...plan.shots].sort((a, b) => a.startFrame - b.startFrame)) {
    if (!ID.test(shot.id) || ids.has(shot.id) || !text(shot.purpose) || !text(shot.motion) || !Number.isSafeInteger(shot.startFrame) || !Number.isSafeInteger(shot.endFrame) || shot.startFrame < 0 || shot.endFrame <= shot.startFrame || shot.endFrame > plan.durationFrames) throw new Error('Invalid or duplicate shot');
    if (shot.startFrame > coverage) throw new Error('Creative timeline has an uncovered gap');
    coverage = Math.max(coverage, shot.endFrame); ids.add(shot.id);
  }
  if (coverage !== plan.durationFrames) throw new Error('Creative timeline coverage differs from duration');
  if (!Array.isArray(plan.sources) || !plan.sources.length || plan.sources.some(source => !text(source.source) || !SHA.test(source.sha256))) throw new Error('Verified source hashes are required');
  if (!Array.isArray(plan.fonts) || !plan.fonts.length || plan.fonts.some(font => !text(font.family) || !text(font.version) || !SHA.test(font.sha256))) throw new Error('Versioned font hashes are required');
  if (!plan.assets || !SHA.test(plan.assets.sha256)) throw new Error('A frozen brand manifest hash is required');
  if (plan.copy !== undefined && (!plan.copy || !SHA.test(plan.copy.sha256))) throw new Error('Invalid frozen copy hash');
  const voice = plan.narration;
  if (!voice || !['PENDING_REVIEW', 'APPROVED'].includes(voice.status) || ![voice.provider, voice.modelId, voice.voiceId].every(text) || !SHA.test(voice.textHash) || !SHA.test(voice.pronunciationMapHash)) throw new Error('Invalid narration identity or text hashes');
  for (const [file, hash] of [[voice.voicePath, voice.voiceHash], [voice.alignmentPath, voice.alignmentHash]]) {
    if ((file === undefined) !== (hash === undefined) || (hash !== undefined && !SHA.test(hash))) throw new Error('Narration path and hash must be paired');
  }
  if (voice.alignmentPath && !voice.voicePath) throw new Error('Alignment requires a frozen voice');
  if (plan.audioMix !== undefined) validateAudioMix(plan.audioMix, voice.voicePath ? voice.voiceHash : undefined, plan.durationFrames / plan.frameRate);
  for (const relative of [plan.assets.manifestPath, ...plan.fonts.map(font => font.path), ...plan.sources.map(source => source.path), voice.voicePath, voice.alignmentPath]) {
    if (relative !== undefined) normalizedRelativePath(relative);
  }
}

function projectPath(root: string, project: string): string {
  return normalizedRelativePath(path.relative(path.resolve(root), path.resolve(project)));
}

async function verifiedFile(root: string, relative: string, hash: string): Promise<string> {
  const file = await resolveProjectAsset(root, relative);
  if (!(await stat(file)).isFile() || digest(await readFile(file)) !== hash) throw new Error(`Frozen file hash changed: ${relative}`);
  return file;
}

async function verifyPlanAssets(root: string, project: string, plan: CreativePlan, frozen: boolean): Promise<void> {
  const relative = projectPath(root, project);
  if (plan.assets.manifestPath !== `${relative}/frozen-brand-assets.json`) throw new Error('Brand manifest must belong to this frozen task');
  await verifiedFile(root, plan.assets.manifestPath, plan.assets.sha256);
  await verifyFrozenBrandAssets(root, project);
  if (plan.copy) {
    const copy = await readCopyDraft(root, project);
    if (copy.copySha256 !== plan.copy.sha256 || copy.projectId !== plan.projectId || copy.productId !== plan.productId) throw new Error('Creative plan copy hash or video identity differs from frozen copy');
    const withoutLineBreaks = (value: string): string => value.replace(/[\r\n]/g, '');
    if (copy.narration.length) {
      const textSource = plan.sources.find(source => source.path && source.sha256 === plan.narration.textHash);
      if (!textSource?.path) throw new Error('Approved narration requires an actual frozen text source matching narration.textHash');
      const actualText = await readFile(await verifiedFile(root, textSource.path, textSource.sha256), 'utf8');
      if (withoutLineBreaks(actualText) !== withoutLineBreaks(copy.narration.join(''))) throw new Error('Text source differs from approved narration');
    } else if (plan.narration.textHash !== digest('') || plan.narration.voicePath) throw new Error('A copy without narration cannot bind unapproved narration or audio');
    if (plan.narration.voicePath) {
      if (!plan.narration.alignmentPath) throw new Error('Approved spoken copy requires actual subtitle alignment');
      const alignment = JSON.parse(await readFile(await verifiedFile(root, plan.narration.alignmentPath, plan.narration.alignmentHash!), 'utf8')) as {
        copySha256?: unknown; voiceSha256?: unknown; cues?: Array<{ text?: unknown; start?: unknown; end?: unknown }> };
      if (alignment.copySha256 !== copy.copySha256 || alignment.voiceSha256 !== plan.narration.voiceHash) throw new Error('Copy alignment or voice hash differs from the approved text/audio binding');
      if (!Array.isArray(alignment.cues) || !alignment.cues.length || alignment.cues.some(cue => !text(cue.text) || typeof cue.start !== 'number' || !Number.isFinite(cue.start) || cue.start < 0 || typeof cue.end !== 'number' || !Number.isFinite(cue.end) || cue.end <= cue.start)) throw new Error('Invalid subtitle cues for approved copy');
      if (withoutLineBreaks(alignment.cues.map(cue => cue.text).join('')) !== withoutLineBreaks(copy.subtitles.join(''))) throw new Error('Subtitle words differ from approved copy');
    }
  }
  const files = [...plan.fonts, ...plan.sources.filter(source => source.path !== undefined).map(source => ({ path: source.path!, sha256: source.sha256 }))];
  if (plan.narration.voicePath) files.push({ path: plan.narration.voicePath, sha256: plan.narration.voiceHash! });
  if (plan.narration.alignmentPath) files.push({ path: plan.narration.alignmentPath, sha256: plan.narration.alignmentHash! });
  if (plan.audioMix) files.push({ path: plan.audioMix.music.path, sha256: plan.audioMix.music.sha256 },
    { path: plan.audioMix.music.licensePath, sha256: plan.audioMix.music.licenseSha256 },
    { path: plan.audioMix.mixPath, sha256: plan.audioMix.mixSha256 });
  for (const file of files) {
    if (frozen && !file.path.startsWith(`${relative}/assets/quality-frozen/`)) throw new Error('Resolved resources must stay in their frozen task snapshot');
    await verifiedFile(root, file.path, file.sha256);
  }
}

/** Copy declared resources once; repeated calls read only the exact frozen plan and its snapshots. */
export async function freezeCreativePlan(root: string, project: string, authored: CreativePlan): Promise<ResolvedCreativePlan> {
  validatePlan(authored);
  const relative = projectPath(root, project);
  const output = await resolveProjectAsset(root, `${relative}/${CREATIVE_PLAN_FILE}`, true);
  const authoredHash = digest(canonical(authored));
  if (await exists(output)) {
    const current = await resumeCreativePlan(root, project);
    if (current.authoredPlanSha256 !== authoredHash) throw new Error('Different existing plan requires a new variant in a new task directory');
    return current;
  }
  await verifyPlanAssets(root, project, authored, false);
  const resolved: ResolvedCreativePlan = { ...structuredClone(authored), authoredPlanSha256: authoredHash, resolvedPlanSha256: '' };
  const snapshot = async (sourcePath: string, sha256: string): Promise<string> => {
    const source = await verifiedFile(root, sourcePath, sha256);
    const extension = path.extname(source).toLowerCase();
    if (!/^\.[a-z0-9]{1,16}$/.test(extension)) throw new Error('Frozen resource needs a safe file extension');
    const destination = `${relative}/assets/quality-frozen/${sha256}${extension}`;
    const target = await resolveProjectAsset(root, destination, true);
    await mkdir(path.dirname(target), { recursive: true });
    if (!await exists(target)) {
      const bytes = await readFile(source);
      if (digest(bytes) !== sha256) throw new Error('Source changed before snapshot publication');
      await writeExclusiveSnapshot(target, bytes);
    }
    await verifiedFile(root, destination, sha256);
    return destination;
  };
  for (const font of resolved.fonts) font.path = await snapshot(font.path, font.sha256);
  for (const source of resolved.sources) if (source.path) source.path = await snapshot(source.path, source.sha256);
  if (resolved.narration.voicePath) resolved.narration.voicePath = await snapshot(resolved.narration.voicePath, resolved.narration.voiceHash!);
  if (resolved.narration.alignmentPath) resolved.narration.alignmentPath = await snapshot(resolved.narration.alignmentPath, resolved.narration.alignmentHash!);
  if (resolved.audioMix) {
    resolved.audioMix.music.path = await snapshot(resolved.audioMix.music.path, resolved.audioMix.music.sha256);
    resolved.audioMix.music.licensePath = await snapshot(resolved.audioMix.music.licensePath, resolved.audioMix.music.licenseSha256);
    resolved.audioMix.mixPath = await snapshot(resolved.audioMix.mixPath, resolved.audioMix.mixSha256);
  }
  await verifyPlanAssets(root, project, resolved, true);
  resolved.resolvedPlanSha256 = resolvedPlanHash(resolved);
  await writeExclusiveSnapshot(output, canonical(resolved));
  return resumeCreativePlan(root, project);
}

export async function resumeCreativePlan(root: string, project: string): Promise<ResolvedCreativePlan> {
  const file = await resolveProjectAsset(root, `${projectPath(root, project)}/${CREATIVE_PLAN_FILE}`);
  const plan = JSON.parse(await readFile(file, 'utf8')) as ResolvedCreativePlan;
  validatePlan(plan);
  if (!SHA.test(plan.authoredPlanSha256)) throw new Error('Invalid frozen authored plan hash');
  if (!SHA.test(plan.resolvedPlanSha256) || resolvedPlanHash(plan) !== plan.resolvedPlanSha256) throw new Error('Frozen plan content hash changed');
  await verifyPlanAssets(root, project, plan, true);
  return plan;
}

async function decisions(root: string, project: string): Promise<HumanDecision[]> {
  const directory = await resolveProjectAsset(root, `${projectPath(root, project)}/approvals`, true);
  let names: string[];
  try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const rows: HumanDecision[] = [];
  for (const name of names.filter(name => name.endsWith('.json'))) {
    const file = await resolveProjectAsset(root, `${projectPath(root, project)}/approvals/${name}`);
    const row = JSON.parse(await readFile(file, 'utf8')) as HumanDecision;
    if (row.schemaVersion !== '1.0' || row.reviewerType !== 'USER' || !['visual', 'voice', 'audience', 'final'].includes(row.dimension) || !['ACCEPTED', 'REJECTED'].includes(row.decision) || !text(row.userInstruction) || !SHA.test(row.planSha256) || !Number.isSafeInteger(row.sequence) || row.sequence < 1 || rows.some(previous => previous.sequence === row.sequence)) throw new Error('Invalid or ambiguous human approval history');
    rows.push(row);
  }
  return rows.sort((a, b) => a.sequence - b.sequence);
}

async function reviewedMedia(root: string, project: string, relative: string): Promise<string> {
  const normalized = normalizedRelativePath(relative);
  if (!normalized.startsWith(`${projectPath(root, project)}/`)) throw new Error('Review media must belong to its task path');
  const file = await resolveProjectAsset(root, normalized);
  if (!(await stat(file)).isFile()) throw new Error('Review media must be a file');
  return digest(await readFile(file));
}

/** Caller must supply the user's actual current instruction; this API cannot authenticate a human. */
export async function recordHumanDecision(root: string, project: string, input: HumanDecisionInput): Promise<HumanDecision> {
  if (!input || !text(input.userInstruction)) throw new Error('An explicit current user instruction is required');
  if (!['visual', 'voice', 'audience', 'final'].includes(input.dimension) || !['ACCEPTED', 'REJECTED'].includes(input.decision)) throw new Error('Invalid human decision');
  const plan = await resumeCreativePlan(root, project);
  const voicePath = input.voicePath ?? plan.narration.voicePath;
  if ((input.dimension === 'visual' || input.dimension === 'audience' || input.dimension === 'final') && !input.videoPath) throw new Error('Visual or final review requires a video');
  if ((input.dimension === 'voice' || input.dimension === 'final') && !voicePath) throw new Error('Voice review requires actual frozen voice audio');
  if (voicePath !== plan.narration.voicePath) throw new Error('Voice approval must bind the plan frozen voice');
  const history = await decisions(root, project);
  const record: HumanDecision = { schemaVersion: '1.0', reviewerType: 'USER', recordId: randomUUID(), sequence: (history.at(-1)?.sequence ?? 0) + 1,
    recordedAt: new Date().toISOString(), dimension: input.dimension, decision: input.decision, userInstruction: input.userInstruction,
    planSha256: digest(await readFile(await resolveProjectAsset(root, `${projectPath(root, project)}/${CREATIVE_PLAN_FILE}`))),
    ...(input.videoPath ? { videoPath: normalizedRelativePath(input.videoPath), videoSha256: await reviewedMedia(root, project, input.videoPath) } : {}),
    ...(voicePath ? { voicePath, voiceSha256: await reviewedMedia(root, project, voicePath) } : {}),
    ...(input.dimension === 'final' && plan.audioMix ? { mixPath: plan.audioMix.mixPath, mixSha256: await reviewedMedia(root, project, plan.audioMix.mixPath) } : {}) };
  if (input.dimension === 'final' && input.decision === 'ACCEPTED') {
    const assessment = await assessAcceptance(root, project);
    const visual = history.findLast(row => row.dimension === 'visual');
    const voice = history.findLast(row => row.dimension === 'voice');
    if (assessment.visualReview.status !== 'PASS' || assessment.voiceReview.status !== 'PASS' || visual?.videoSha256 !== record.videoSha256 || voice?.voiceSha256 !== record.voiceSha256) throw new Error('Final acceptance requires current visual and voice approvals for these exact artifacts');
  }
  const file = await resolveProjectAsset(root, `${projectPath(root, project)}/approvals/${String(record.sequence).padStart(6, '0')}-${record.recordId}.json`, true);
  await mkdir(path.dirname(file), { recursive: true });
  await writeExclusiveSnapshot(file, canonical(record));
  return record;
}

export async function assessAcceptance(root: string, project: string): Promise<AcceptanceAssessment> {
  const result: AcceptanceAssessment = { visualReview: missing(), voiceReview: missing(), audienceReview: missing(), userAcceptance: missing(), issues: [] };
  let history: HumanDecision[]; let plan: ResolvedCreativePlan;
  try {
    history = await decisions(root, project);
    plan = await resumeCreativePlan(root, project);
    result.planSha256 = digest(await readFile(await resolveProjectAsset(root, `${projectPath(root, project)}/${CREATIVE_PLAN_FILE}`)));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    result.issues.push(reason);
    result.visualReview = stale(reason); result.voiceReview = stale(reason); result.audienceReview = stale(reason); result.userAcceptance = stale(reason);
    return result;
  }
  const latest = (dimension: ReviewDimension) => history.findLast(row => row.dimension === dimension);
  const evaluate = async (dimension: ReviewDimension): Promise<ReviewAssessment> => {
    const row = latest(dimension);
    if (!row) return missing();
    try {
      if (row.planSha256 !== result.planSha256) throw new Error('Plan changed since review');
      if ((dimension === 'visual' || dimension === 'audience' || dimension === 'final') && (!row.videoPath || !row.videoSha256)) throw new Error('Missing reviewed video');
      if ((dimension === 'voice' || dimension === 'final') && (!row.voicePath || !row.voiceSha256)) throw new Error('Missing reviewed voice');
      if (row.videoPath && await reviewedMedia(root, project, row.videoPath) !== row.videoSha256) throw new Error('Video changed since review');
      if (row.voicePath !== plan.narration.voicePath || row.voiceSha256 !== plan.narration.voiceHash) throw new Error('Voice changed since review');
      if (row.voicePath && await reviewedMedia(root, project, row.voicePath) !== row.voiceSha256) throw new Error('Voice changed since review');
      if (dimension === 'final' && plan.audioMix && (row.mixPath !== plan.audioMix.mixPath || row.mixSha256 !== plan.audioMix.mixSha256 || await reviewedMedia(root, project, row.mixPath) !== row.mixSha256)) throw new Error('Audio mix changed or missing from final review');
      return { status: row.decision === 'ACCEPTED' ? 'PASS' : 'PARTIAL', decision: row.decision, recordId: row.recordId };
    } catch (error) { return { ...stale(error instanceof Error ? error.message : String(error)), recordId: row.recordId }; }
  };
  result.visualReview = await evaluate('visual'); result.voiceReview = await evaluate('voice'); result.audienceReview = await evaluate('audience'); result.userAcceptance = await evaluate('final');
  if (result.userAcceptance.status === 'PASS') {
    const final = latest('final')!;
    if (result.visualReview.status !== 'PASS' || result.voiceReview.status !== 'PASS' || final.videoSha256 !== latest('visual')?.videoSha256 || final.voiceSha256 !== latest('voice')?.voiceSha256) result.userAcceptance = stale('Independent visual or voice approval is missing, rejected, stale or for another artifact');
  }
  return result;
}
