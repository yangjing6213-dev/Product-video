// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { normalizedRelativePath, resolveProjectAsset, writeExclusiveSnapshot } from '../assets/library.ts';
import { digest, exists } from '../pipeline/stage-state.ts';
import type { VideoSpec } from '../contracts.ts';
import { workflowText } from './workflow.ts';

export const COPY_FILE = 'copy-script.json';
export interface CopyDraft {
  schemaVersion: '1.0'; projectId: string; productId: string; revision: string;
  narration: string[]; onScreenText: string[]; subtitles: string[]; cta: string;
}
export interface FrozenCopy extends CopyDraft { projectPath: string; copySha256: string }
export interface CopyDecisionInput { decision: 'ACCEPTED' | 'REJECTED'; copySha256: string; userInstruction: string }
export interface CopyDecision extends CopyDecisionInput {
  schemaVersion: '1.0'; reviewerType: 'USER'; recordId: string; sequence: number; recordedAt: string;
  projectPath: string; projectId: string; productId: string; revision: string;
}
export interface CopyAssessment {
  status: 'NOT_RUN' | 'PARTIAL' | 'PASS'; decision: 'NOT_RUN' | 'STALE' | 'REJECTED' | 'ACCEPTED';
  copySha256?: string; recordId?: string; reason?: string;
}
export type CopyExpectation = Partial<Pick<FrozenCopy, 'projectId' | 'productId' | 'copySha256' | 'narration' | 'onScreenText' | 'subtitles' | 'cta'>>;
const SHA = /^[0-9a-f]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const encode = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function copyPayload(copy: CopyDraft): CopyDraft {
  return { schemaVersion: copy.schemaVersion, projectId: copy.projectId, productId: copy.productId, revision: copy.revision,
    narration: copy.narration, onScreenText: copy.onScreenText, subtitles: copy.subtitles, cta: copy.cta };
}
function relativeProject(root: string, project: string): string {
  return normalizedRelativePath(path.relative(path.resolve(root), path.resolve(project)));
}
function validateCopy(copy: CopyDraft): void {
  if (!copy || copy.schemaVersion !== '1.0' || ![copy.projectId, copy.productId, copy.revision].every(value => typeof value === 'string' && ID.test(value))) throw new Error('Copy project identity or revision is invalid');
  for (const values of [copy.narration, copy.onScreenText, copy.subtitles]) if (!Array.isArray(values) || !values.every(text)) throw new Error('Copy requires complete narration, screen text and subtitle lists');
  if (!copy.onScreenText.length || !text(copy.cta)) throw new Error('Copy requires screen text and an explicit CTA');
  if (copy.narration.length && copy.narration.join('').replace(/\r?\n/g, '') !== copy.subtitles.join('').replace(/\r?\n/g, '')) throw new Error('Subtitle words must match the reviewed narration; only line breaks may differ');
}

/** Freeze one complete copy version per video; changed words require a new video variant. */
export async function freezeCopyDraft(root: string, project: string, draft: CopyDraft): Promise<FrozenCopy> {
  validateCopy(draft);
  const payload = { ...copyPayload(draft), projectPath: relativeProject(root, project) }; const copySha256 = digest(encode(payload));
  const file = await resolveProjectAsset(root, `${relativeProject(root, project)}/${COPY_FILE}`, true);
  if (await exists(file)) {
    const previous = await readCopyDraft(root, project);
    if (previous.copySha256 !== copySha256) throw new Error('Existing copy preserved; changed copy requires a new video variant');
    return previous;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeExclusiveSnapshot(file, encode({ ...payload, copySha256 }));
  return readCopyDraft(root, project);
}

export async function readCopyDraft(root: string, project: string): Promise<FrozenCopy> {
  const file = await resolveProjectAsset(root, `${relativeProject(root, project)}/${COPY_FILE}`);
  const copy = JSON.parse(await readFile(file, 'utf8')) as FrozenCopy;
  validateCopy(copy);
  if (copy.projectPath !== relativeProject(root, project)) throw new Error('Copy project path identity changed');
  if (!SHA.test(copy.copySha256) || digest(encode({ ...copyPayload(copy), projectPath: copy.projectPath })) !== copy.copySha256) throw new Error('Frozen copy content hash changed');
  return copy;
}

async function copyDecisions(root: string, project: string): Promise<CopyDecision[]> {
  const relative = relativeProject(root, project);
  const directory = await resolveProjectAsset(root, `${relative}/copy-approvals`, true);
  let names: string[];
  try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const decisions: CopyDecision[] = [];
  for (const name of names.filter(name => name.endsWith('.json'))) {
    const file = await resolveProjectAsset(root, `${relative}/copy-approvals/${name}`);
    const row = JSON.parse(await readFile(file, 'utf8')) as CopyDecision;
    if (row.schemaVersion !== '1.0' || row.reviewerType !== 'USER' || row.projectPath !== relative || ![row.projectId, row.productId, row.revision].every(value => typeof value === 'string' && ID.test(value)) || !['ACCEPTED', 'REJECTED'].includes(row.decision) || !text(row.userInstruction) || !text(row.recordId) || !Number.isFinite(Date.parse(row.recordedAt)) || !SHA.test(row.copySha256) || !Number.isSafeInteger(row.sequence) || row.sequence < 1 || decisions.some(previous => previous.sequence === row.sequence)) throw new Error('Invalid, transferred or ambiguous copy approval history');
    decisions.push(row);
  }
  return decisions.sort((left, right) => left.sequence - right.sequence);
}

/** The caller must provide the user's actual words and reviewed hash; this local API cannot authenticate a human. */
export async function recordCopyDecision(root: string, project: string, input: CopyDecisionInput): Promise<CopyDecision> {
  if (!input || !text(input.userInstruction)) throw new Error('An actual explicit user instruction is required for copy approval');
  if (!['ACCEPTED', 'REJECTED'].includes(input.decision)) throw new Error('Invalid copy decision');
  const copy = await readCopyDraft(root, project);
  if (input.copySha256 !== copy.copySha256) throw new Error('The reviewed copy hash differs from this frozen copy');
  const history = await copyDecisions(root, project); const projectRelative = relativeProject(root, project);
  const row: CopyDecision = { schemaVersion: '1.0', reviewerType: 'USER', recordId: randomUUID(), sequence: (history.at(-1)?.sequence ?? 0) + 1,
    recordedAt: new Date().toISOString(), projectPath: projectRelative, projectId: copy.projectId, productId: copy.productId, revision: copy.revision,
    decision: input.decision, copySha256: copy.copySha256, userInstruction: input.userInstruction };
  const file = await resolveProjectAsset(root, `${projectRelative}/copy-approvals/${String(row.sequence).padStart(6, '0')}-${row.recordId}.json`, true);
  await mkdir(path.dirname(file), { recursive: true });
  await writeExclusiveSnapshot(file, encode(row));
  return row;
}

async function assessment(root: string, project: string, copy: FrozenCopy): Promise<CopyAssessment> {
  const latest = (await copyDecisions(root, project)).at(-1);
  if (!latest) return { status: 'NOT_RUN', decision: 'NOT_RUN', copySha256: copy.copySha256 };
  if (latest.copySha256 !== copy.copySha256 || latest.projectId !== copy.projectId || latest.productId !== copy.productId || latest.revision !== copy.revision) return { status: 'NOT_RUN', decision: 'STALE', copySha256: copy.copySha256, reason: 'Copy or video identity changed since review' };
  return { status: latest.decision === 'ACCEPTED' ? 'PASS' : 'PARTIAL', decision: latest.decision, copySha256: copy.copySha256, recordId: latest.recordId };
}

export async function assessCopyReview(root: string, project: string): Promise<CopyAssessment> {
  try {
    const file = await resolveProjectAsset(root, `${relativeProject(root, project)}/${COPY_FILE}`, true);
    if (!await exists(file)) return { status: 'NOT_RUN', decision: 'NOT_RUN', reason: 'No frozen copy draft' };
    return await assessment(root, project, await readCopyDraft(root, project));
  } catch (error) { return { status: 'NOT_RUN', decision: 'STALE', reason: error instanceof Error ? error.message : String(error) }; }
}

/** Call inside real generation stages; successful cache reads do not generate and need no fabricated retrospective approval. */
export async function assertCopyApproved(root: string, project: string, expected: CopyExpectation = {}): Promise<FrozenCopy> {
  let copy: FrozenCopy; let review: CopyAssessment;
  try { copy = await readCopyDraft(root, project); review = await assessment(root, project, copy); }
  catch (error) { throw new Error(`Copy approval required before generation: ${error instanceof Error ? error.message : String(error)}`); }
  if (review.status !== 'PASS') throw new Error(`Copy approval required before generation: ${review.decision}`);
  for (const [key, value] of Object.entries(expected)) {
    if (value !== undefined && encode(copy[key as keyof CopyExpectation]) !== encode(value)) throw new Error(`Approved copy ${key} differs from current generation input; confirm a new copy variant`);
  }
  return copy;
}

/** The legacy scene contract uses narration itself as the spoken-caption text source. */
export function copyDraftFromVideoSpec(spec: VideoSpec, revision: string): CopyDraft {
  for (const scene of spec.scenes) {
    if (scene.workflow && workflowText(scene.workflow).some(word => !scene.onScreenText.includes(word))) {
      throw new Error(`Workflow copy must be included verbatim in reviewed onScreenText: ${scene.id}`);
    }
  }
  const slug = spec.product.url ? new URL(spec.product.url).pathname.split('/').filter(Boolean).at(-1) : undefined;
  const productId = slug && ID.test(slug) ? slug : `product-${digest(JSON.stringify({ name: spec.product.name, url: spec.product.url })).slice(0, 24)}`;
  const narration = spec.scenes.map(scene => scene.voiceover).filter(text);
  return { schemaVersion: '1.0', projectId: spec.projectId, productId, revision, narration,
    onScreenText: [...spec.scenes.flatMap(scene => scene.onScreenText),
      ...(spec.generatorPolicy ? [spec.product.name, spec.generatorPolicy.marketing.brand, spec.generatorPolicy.marketing.screenAction, spec.generatorPolicy.marketing.displayDomain,
        ...(spec.product.example ? [`演示项目：${spec.product.example.name}`, spec.product.example.explanation] : [])] : []),
      ...(spec.authorContacts ? [spec.authorContacts.name, ...spec.authorContacts.items.map(item => `${item.label}：${item.value}`)] : [])],
    subtitles: spec.audio.narrationMode === 'none' ? spec.scenes.map(scene => scene.caption).filter(text) : [...narration],
    cta: spec.narrative.cta };
}

export async function assertVideoSpecCopyApproved(root: string, project: string, spec: VideoSpec): Promise<FrozenCopy> {
  const { schemaVersion: _schema, revision: _revision, ...expected } = copyDraftFromVideoSpec(spec, 'current');
  return assertCopyApproved(root, project, expected);
}

export async function assertApprovedTranscript(root: string, project: string, spec: VideoSpec, entries: readonly { text: string }[]): Promise<FrozenCopy> {
  const copy = await assertVideoSpecCopyApproved(root, project, spec);
  const actual = entries.map(entry => entry.text).join('').replace(/[\r\n]/g, '');
  const expected = copy.subtitles.join('').replace(/[\r\n]/g, '');
  if (actual !== expected) throw new Error('Transcript text differs from approved subtitles; review corrected copy before generation');
  return copy;
}
