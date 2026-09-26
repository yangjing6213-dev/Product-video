// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { VideoSpec } from '../contracts.ts';
import { renderPuppetSvg, type CharacterRig, type RigPart } from './performance.ts';
import { normalizedRelativePath, resolveProjectAsset, writeExclusiveSnapshot } from '../assets/library.ts';
import { digest, exists } from '../pipeline/stage-state.ts';

export interface CharacterReviewFile { path: string; sha256: string }
export type CharacterReviewRig = CharacterRig & { assetId: string };
export interface CharacterReviewSelection {
  schemaVersion: '1.0'; mode: 'enhe' | 'stickman' | 'custom'; actorAssetIds: string[];
  rigs: CharacterReviewRig[];
  sources: CharacterReviewFile[]; references: CharacterReviewFile[]; prepared: CharacterReviewFile[];
  preview: CharacterReviewFile; rendererHash: string; qa: CharacterReviewFile;
}
export interface FrozenCharacterReview extends CharacterReviewSelection { projectId: string; projectPath: string; reviewSha256: string }
export interface CharacterDecisionInput { decision: 'ACCEPTED' | 'REJECTED'; userInstruction: string; reviewSha256: string }
export interface CharacterDecision extends CharacterDecisionInput {
  schemaVersion: '1.0'; reviewerType: 'USER'; projectId: string; projectPath: string;
  recordId: string; sequence: number; recordedAt: string;
}
export interface CharacterReviewAssessment {
  status: 'NOT_RUN' | 'PARTIAL' | 'PASS'; decision: 'NOT_RUN' | 'STALE' | 'REJECTED' | 'ACCEPTED';
  reviewSha256?: string; recordId?: string; reason?: string;
}
const SHA = /^[0-9a-f]{64}$/, ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const encode = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const FILE = 'character-review.json';
const PARTS: RigPart[] = ['head', 'body', 'upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot'];

function identity(root: string, project: string): { projectId: string; projectPath: string } {
  const relative = normalizedRelativePath(path.relative(path.resolve(root), path.resolve(project)));
  if (!/^projects\/[^/]+$/.test(relative) || !ID.test(path.basename(project))) throw new Error('Character review must belong to one project task');
  return { projectId: path.basename(project), projectPath: relative };
}
function fileShape(file: CharacterReviewFile): void {
  if (!file || !SHA.test(file.sha256)) throw new Error('Character review file requires a SHA-256 hash');
  normalizedRelativePath(file.path);
}
function validateSelection(selection: CharacterReviewSelection): void {
  if (!selection || selection.schemaVersion !== '1.0' || !['enhe', 'stickman', 'custom'].includes(selection.mode)) throw new Error('Character review requires an explicit supported selection mode');
  if (!Array.isArray(selection.actorAssetIds) || !selection.actorAssetIds.length || selection.actorAssetIds.length > 2 || selection.actorAssetIds.some(id => !ID.test(id)) || new Set(selection.actorAssetIds).size !== selection.actorAssetIds.length) throw new Error('Character review requires one or two distinct actor asset IDs');
  if (!Array.isArray(selection.rigs) || selection.rigs.length !== selection.actorAssetIds.length || new Set(selection.rigs.map(rig => rig?.assetId)).size !== selection.rigs.length || selection.rigs.some(rig => !selection.actorAssetIds.includes(rig?.assetId) || !['tuotuo', 'xinbi', 'stickman', 'custom'].includes(rig?.kind))) throw new Error('Character review must freeze every actor rig binding');
  for (const rig of selection.rigs) {
    if (!(selection.mode === 'enhe' ? ['tuotuo', 'xinbi'] : [selection.mode]).includes(rig.kind)) throw new Error('Character selection mode differs from its rig kinds');
    if (rig.kind === 'custom' && (!rig.parts || PARTS.some(part => !ID.test(rig.parts![part] ?? '')) || new Set(PARTS.map(part => rig.parts![part])).size !== PARTS.length)) throw new Error('Custom character requires eight distinct reviewed body parts; one uploaded image is not an articulated rig');
    if (rig.kind !== 'custom' && rig.parts !== undefined) throw new Error('Built-in characters cannot include unreviewed custom parts');
  }
  for (const key of ['sources', 'references', 'prepared'] as const) {
    const files = selection[key];
    if (!Array.isArray(files) || (key !== 'references' && !files.length) || new Set(files.map(file => file?.path)).size !== files.length) throw new Error(`Character review needs unique ${key} file evidence`);
    files.forEach(fileShape);
  }
  fileShape(selection.preview); fileShape(selection.qa);
  if (!/\.(html|mp4|webm)$/i.test(selection.preview.path) || !/\.json$/i.test(selection.qa.path) || !SHA.test(selection.rendererHash)) throw new Error('Character review requires a real action preview, JSON QA and renderer hash');
}
async function bytes(project: string, file: CharacterReviewFile): Promise<Buffer> {
  const value = await readFile(await resolveProjectAsset(project, file.path));
  if (!value.length || digest(value) !== file.sha256) throw new Error(`Character review file bytes changed: ${file.path}`);
  return value;
}
function matrix(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = /^matrix(3d)?\(([^)]+)\)$/.exec(value);
  if (!match) return false;
  const numbers = match[2]!.split(',').map(value => Number(value.trim()));
  return numbers.length === (match[1] ? 16 : 6) && numbers.every(Number.isFinite);
}
/** These are measured technical observations, never a substitute for a user decision. */
function validateQa(value: any, selection: CharacterReviewSelection): void {
  if (!value || value.schemaVersion !== '1.0' || value.previewSha256 !== selection.preview.sha256 || value.rendererHash !== selection.rendererHash || !Array.isArray(value.actors) || value.actors.length !== selection.actorAssetIds.length || new Set(value.actors.map((actor: any) => actor?.assetId)).size !== value.actors.length) throw new Error('Character QA must bind the exact preview, renderer and every chosen actor');
  for (const actor of value.actors) {
    if (!selection.actorAssetIds.includes(actor?.assetId)) throw new Error('Character QA actor differs from selection');
    const alpha = actor.alpha;
    if (!alpha || ![alpha.totalPixels, alpha.transparentPixels, alpha.borderPixels, alpha.opaqueBorderPixels].every(Number.isSafeInteger)
        || alpha.totalPixels < 1 || alpha.transparentPixels / alpha.totalPixels <= .05 || alpha.transparentPixels > alpha.totalPixels
        || alpha.borderPixels < 1 || alpha.borderPixels > alpha.totalPixels || alpha.opaqueBorderPixels !== 0) throw new Error('Character QA requires measured transparent pixels and no opaque outer border');
    const samples = actor.jointSamples;
    if (!Array.isArray(samples) || samples.length < 3) throw new Error('Character QA requires at least three adjacent continuous joint samples');
    let previous = -1;
    for (const sample of samples) {
      if (!Number.isFinite(sample?.timeSec) || sample.timeSec < 0 || sample.timeSec <= previous || (previous >= 0 && sample.timeSec - previous > .200001)
          || !sample.joints || typeof sample.joints !== 'object' || Array.isArray(sample.joints) || !Object.values(sample.joints).every(matrix)) throw new Error('Character QA joint samples must be chronological measured transform matrices');
      previous = sample.timeSec;
    }
    const moving = Object.keys(samples[0].joints).filter(key => samples.every((sample: any) => matrix(sample.joints[key])) && new Set(samples.map((sample: any) => sample.joints[key])).size >= 3);
    if (moving.length < 2) throw new Error('Character QA requires multiple intermediate states in at least two joints, not two static pose swaps');
  }
}
async function verifyFiles(root: string, project: string, selection: CharacterReviewSelection): Promise<void> {
  await resolveProjectAsset(root, identity(root, project).projectPath);
  const renderer = await readFile(await resolveProjectAsset(root, 'src/quality/performance.ts'));
  if (digest(renderer) !== selection.rendererHash) throw new Error('Character renderer changed since the reviewed action preview');
  for (const file of [...selection.sources, ...selection.references, ...selection.prepared, selection.preview]) await bytes(project, file);
  validateQa(JSON.parse((await bytes(project, selection.qa)).toString('utf8')), selection);
}
async function readReview(root: string, project: string): Promise<FrozenCharacterReview> {
  const expected = identity(root, project);
  await resolveProjectAsset(root, expected.projectPath);
  const review = JSON.parse(await readFile(await resolveProjectAsset(project, FILE), 'utf8')) as FrozenCharacterReview;
  validateSelection(review);
  const { reviewSha256, ...payload } = review;
  if (review.projectId !== expected.projectId || review.projectPath !== expected.projectPath || !SHA.test(reviewSha256) || digest(encode(payload)) !== reviewSha256) throw new Error('Frozen character review identity or content hash changed');
  await verifyFiles(root, project, review);
  return review;
}

export async function freezeCharacterReview(root: string, project: string, selection: CharacterReviewSelection): Promise<FrozenCharacterReview> {
  validateSelection(selection);
  const payload = { ...structuredClone(selection), ...identity(root, project) }, reviewSha256 = digest(encode(payload));
  await verifyFiles(root, project, selection);
  const file = await resolveProjectAsset(project, FILE, true);
  if (await exists(file)) {
    const old = await readReview(root, project);
    if (old.reviewSha256 !== reviewSha256) throw new Error('Existing character review preserved; changed selection requires a new variant');
    return old;
  }
  await writeExclusiveSnapshot(file, encode({ ...payload, reviewSha256 }));
  return readReview(root, project);
}
async function decisions(root: string, project: string): Promise<CharacterDecision[]> {
  const expected = identity(root, project), directory = await resolveProjectAsset(project, 'character-approvals', true);
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const result: CharacterDecision[] = [];
  for (const name of names.filter(name => name.endsWith('.json'))) {
    const item = JSON.parse(await readFile(await resolveProjectAsset(project, `character-approvals/${name}`), 'utf8')) as CharacterDecision;
    if (item.schemaVersion !== '1.0' || item.reviewerType !== 'USER' || item.projectId !== expected.projectId || item.projectPath !== expected.projectPath
        || !['ACCEPTED', 'REJECTED'].includes(item.decision) || !text(item.userInstruction) || !SHA.test(item.reviewSha256) || !text(item.recordId)
        || !Number.isSafeInteger(item.sequence) || item.sequence < 1 || result.some(previous => previous.sequence === item.sequence) || !Number.isFinite(Date.parse(item.recordedAt))) throw new Error('Invalid or transferred character review decision history');
    result.push(item);
  }
  return result.sort((left, right) => left.sequence - right.sequence);
}
/** The caller must supply an actual user instruction; this local API cannot authenticate a human. */
export async function recordCharacterDecision(root: string, project: string, input: CharacterDecisionInput): Promise<CharacterDecision> {
  if (!input || !text(input.userInstruction) || !['ACCEPTED', 'REJECTED'].includes(input.decision)) throw new Error('Character review requires an actual explicit user instruction and decision');
  const review = await readReview(root, project);
  if (input.reviewSha256 !== review.reviewSha256) throw new Error('Character decision hash differs from the reviewed selection');
  const history = await decisions(root, project);
  const row: CharacterDecision = { schemaVersion: '1.0', reviewerType: 'USER', ...identity(root, project), recordId: randomUUID(), sequence: (history.at(-1)?.sequence ?? 0) + 1,
    recordedAt: new Date().toISOString(), decision: input.decision, userInstruction: input.userInstruction, reviewSha256: input.reviewSha256 };
  const file = await resolveProjectAsset(project, `character-approvals/${String(row.sequence).padStart(6, '0')}-${row.recordId}.json`, true);
  await mkdir(path.dirname(file), { recursive: true });
  await writeExclusiveSnapshot(file, encode(row));
  return row;
}
export async function assessCharacterReview(root: string, project: string): Promise<CharacterReviewAssessment> {
  try {
    await resolveProjectAsset(root, identity(root, project).projectPath);
    if (!await exists(await resolveProjectAsset(project, FILE, true))) return { status: 'NOT_RUN', decision: 'NOT_RUN', reason: 'No frozen character selection review' };
    const review = await readReview(root, project), latest = (await decisions(root, project)).at(-1);
    if (!latest) return { status: 'NOT_RUN', decision: 'NOT_RUN', reviewSha256: review.reviewSha256 };
    if (latest.reviewSha256 !== review.reviewSha256) return { status: 'NOT_RUN', decision: 'STALE', reason: 'Character decision does not bind this review' };
    return { status: latest.decision === 'ACCEPTED' ? 'PASS' : 'PARTIAL', decision: latest.decision, reviewSha256: review.reviewSha256, recordId: latest.recordId };
  } catch (error) { return { status: 'NOT_RUN', decision: 'STALE', reason: error instanceof Error ? error.message : String(error) }; }
}

export async function assertCharacterReview(root: string, project: string, spec: VideoSpec): Promise<void> {
  // The separate stage version deliberately leaves old frozen character projects untouched.
  const scenes = spec.scenes as Array<{ character?: { performance?: unknown; actors: Array<{ assetId: string }> } }>;
  if (!scenes.some(scene => scene.character?.performance)) {
    const hasReview=await exists(path.join(project,FILE));
    const html=await exists(path.join(project,'index.html'))?await readFile(path.join(project,'index.html'),'utf8'):'';
    if(hasReview||html.includes('data-performance-stage'))throw new Error('Character performance contract removed while its review or rendered stage remains; restore the reviewed contract');
    return;
  }
  const status = await assessCharacterReview(root, project);
  if (status.status !== 'PASS') throw new Error(`Character review approval required before production: ${status.decision}${status.reason ? `: ${status.reason}` : ''}`);
  const review = await readReview(root, project);
  if (spec.projectId !== review.projectId) throw new Error('Character review belongs to a different task');
  const ids = [...new Set(scenes.filter(scene => scene.character?.performance).flatMap(scene => scene.character!.actors.map(actor => actor.assetId)))].sort();
  if (encode(ids) !== encode([...review.actorAssetIds].sort())) throw new Error('Character cast differs from the reviewed selection');
  const assets = spec.assets;
  const verifiedAsset = async (id: string) => {
    const asset = assets.find(asset => asset.id === id);
    if (!asset || !['owned', 'authorized'].includes(asset.license)) throw new Error(`Character asset must have an authorized license: ${id}`);
    const file = review.prepared.find(file => file.path === asset.path);
    if (!file) throw new Error(`Character runtime asset is not part of the reviewed prepared files: ${id}`);
    await bytes(project, file);
    return asset;
  };
  const kinds: string[] = [];
  for (const id of ids) {
    const asset = await verifiedAsset(id), rig = asset.characterRig;
    if (!rig || !(review.mode === 'enhe' ? ['tuotuo', 'xinbi'] : [review.mode]).includes(rig.kind)) throw new Error('Character rig kind differs from the reviewed choice mode');
    const frozen = review.rigs.find(item => item.assetId === id)!;
    const { assetId: _assetId, ...reviewedRig } = frozen;
    if (!isDeepStrictEqual(reviewedRig, rig)) throw new Error('Character rig geometry, parts or kind changed since review');
    if(rig.kind!=='custom'&&(await readFile(await resolveProjectAsset(project,asset.path),'utf8'))!==renderPuppetSvg(rig.kind,undefined,rig.vector))throw new Error('Prepared character SVG differs from the actual inline rig geometry');
    kinds.push(rig.kind);
    if (rig.kind === 'custom') {
      if (!rig.parts || PARTS.some(part => !ID.test(rig.parts![part as keyof typeof rig.parts] ?? ''))) throw new Error('Custom character requires explicitly uploaded and reviewed rig parts');
      for (const part of PARTS) await verifiedAsset(rig.parts[part as keyof typeof rig.parts]!);
    }
  }
  if (review.mode === 'enhe' && (kinds.length !== 2 || !kinds.includes('tuotuo') || !kinds.includes('xinbi'))) throw new Error('ENHE selection must contain TUOTUO and XINBI');
}

/** Include the actual review inputs and append-only decisions in a production snapshot. */
export async function characterReviewEvidenceInputs(root: string, project: string, spec: VideoSpec): Promise<string[]> {
  if (!spec.scenes.some(scene => scene.character?.performance)) return [];
  await assertCharacterReview(root, project, spec);
  const review = await readReview(root, project);
  const names = (await readdir(await resolveProjectAsset(project, 'character-approvals'))).filter(name => name.endsWith('.json')).sort();
  const paths = [FILE, ...review.sources.map(file => file.path), ...review.references.map(file => file.path), ...review.prepared.map(file => file.path), review.preview.path, review.qa.path,
    ...names.map(name => `character-approvals/${name}`)];
  return Promise.all([...new Set(paths)].map(file => resolveProjectAsset(project, file)));
}
