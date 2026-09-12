// SPDX-License-Identifier: Apache-2.0
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CheckResult, VideoSpec } from '../contracts.ts';
import { validateQaReport, validateSpec } from '../contracts.ts';
import { digest, exists, readState, type StageRecord } from '../pipeline/stage-state.ts';
import { checkGeneratorSpec } from './policy.ts';
import { assessAcceptance } from './plan.ts';

export interface ReleaseEvidence {
  engineering: 'PASS' | 'FAIL' | 'NOT_RUN';
  artifactAcceptance: 'PASS' | 'PARTIAL' | 'NOT_RUN';
  issues: string[];
  videoSha256?: string;
}

interface EvidenceReport {
  status?: unknown;
  projectId?: unknown;
  checks?: unknown;
}

interface RenderReport {
  quality?: unknown;
  output?: unknown;
  exitCode?: unknown;
  videoSha256?: unknown;
  specSha256?: unknown;
  entrySha256?: unknown;
}

interface ApprovalRecord {
  recordId?: unknown;
  reviewerType?: unknown;
  dimension?: unknown;
  decision?: unknown;
  planSha256?: unknown;
  videoSha256?: unknown;
  voiceSha256?: unknown;
}

const SHA = /^[0-9a-f]{64}$/;
const narratedQaIds = [
  'narration.evidence',
  'narration.audio-element',
  'narration.audio-duration',
  'narration.caption-source',
  'browser.narration.audio',
  'browser.narration.structure',
  'browser.narration.timing',
];
const generatorQaIds = ['policy', 'cta', 'spoken-cta', 'ending', 'author-contacts', 'subtitles', 'product-identity', 'prerequisites']
  .map((id) => `generator.${id}`);
const perSceneBrowserIds = ['caption-lines', 'caption-safe-area', 'logo-safe-area', 'text-overflow', 'minimum-type', 'images',
  'caption-ui-overlap', 'caption-background', 'small-player-type', 'brand-palette', 'font'];
const perSceneMotionIds = ['real-subject', 'observed-state', 'reverse-seek'];
const mediaIds = ['media.video-stream', 'media.resolution', 'media.fps', 'media.duration', 'media.video-codec',
  'media.audio-stream', 'media.audio-codec', 'decode', 'black-frames', 'silence', 'media.audio-binding'];

function asChecks(value: unknown, label: string, issues: string[]): CheckResult[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${label} checks are missing or empty`);
    return [];
  }
  const checks: CheckResult[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof (item as CheckResult).id !== 'string' ||
        !['PASS', 'FAIL', 'SKIPPED_WITH_REASON'].includes((item as CheckResult).status) ||
        typeof (item as CheckResult).message !== 'string' || !(item as CheckResult).message.trim()) {
      issues.push(`${label} contains an invalid check record`);
      continue;
    }
    const check = item as CheckResult;
    if (ids.has(check.id)) issues.push(`${label} contains duplicate check ${check.id}`);
    ids.add(check.id);
    checks.push(check);
  }
  for (const check of checks.filter((item) => item.status === 'FAIL')) issues.push(`${label} contains FAIL check ${check.id}`);
  return checks;
}

function requirePass(checks: CheckResult[], ids: readonly string[], label: string, issues: string[]): void {
  const byId = new Map(checks.map((check) => [check.id, check]));
  for (const id of ids) if (byId.get(id)?.status !== 'PASS') issues.push(`${label} required PASS check missing or not PASS: ${id}`);
}

function projectFile(project: string, relative: string): string {
  if (path.isAbsolute(relative) || path.win32.isAbsolute(relative)) throw new Error(`Release evidence path must be project-relative: ${relative}`);
  const file = path.resolve(project, relative);
  const back = path.relative(path.resolve(project), file);
  if (back === '..' || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) throw new Error(`Release evidence path escapes the project: ${relative}`);
  return file;
}

async function verifyStageOutputs(project: string, stageName: string, stage: StageRecord | undefined, required: readonly string[], issues: string[]): Promise<void> {
  if (stage?.status !== 'PASS' || !stage.result || !Array.isArray(stage.result.outputs) || !stage.result.outputHashes) {
    issues.push(`Current run-state ${stageName} stage is not PASS with output hashes`);
    return;
  }
  for (const relative of required) {
    if (!stage.result.outputs.includes(relative)) {
      issues.push(`Current run-state ${stageName} stage does not register ${relative}`);
      continue;
    }
    const expected = stage.result.outputHashes[relative];
    if (!SHA.test(expected ?? '')) {
      issues.push(`Current run-state ${stageName} stage has no valid hash for ${relative}`);
      continue;
    }
    try {
      if (digest(await readFile(projectFile(project, relative))) !== expected) issues.push(`Current run-state ${stageName} stage output hash differs for ${relative}`);
    } catch (error) {
      issues.push(`Current run-state ${stageName} stage output is unreadable for ${relative}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function requiredQaIds(spec: VideoSpec): string[] {
  const ids = [...generatorQaIds, 'browser.resources'];
  for (const scene of spec.scenes) {
    ids.push(...perSceneBrowserIds.map((id) => `browser.${scene.id}.${id}`));
    ids.push(...perSceneMotionIds.map((id) => `motion.${scene.id}.${id}`));
  }
  const ending = spec.scenes.at(-1)?.id;
  if (ending) ids.push(...['primary-cta', 'author-contacts', 'contact-reading-time'].map((id) => `browser.${ending}.${id}`));
  if (spec.audio.narrationMode !== 'none') ids.push(...narratedQaIds);
  return ids;
}

function requireNarrationCueChecks(checks: CheckResult[], issues: string[]): void {
  const suffixes = ['midpoint', 'boundaries', 'reverse-seek', 'lines', 'safe-area', 'ui-overlap'];
  const indexes = [...new Set(checks.flatMap((check) => /^browser\.narration\.cue-(\d+)\./.exec(check.id)?.[1] ?? []))];
  if (!indexes.length) {
    issues.push('QA required narration cue checks are missing');
    return;
  }
  requirePass(checks, indexes.flatMap((index) => suffixes.map((suffix) => `browser.narration.cue-${index}.${suffix}`)), 'QA', issues);
}

async function verifyApprovals(project: string, finalSha256: string): Promise<{ status: 'PASS' | 'PARTIAL' | 'NOT_RUN'; issues: string[] }> {
  const issues: string[] = [];
  const root = path.resolve(project, '../..');
  const acceptance = await assessAcceptance(root, project);
  issues.push(...acceptance.issues.map((issue) => `Approval evidence: ${issue}`));
  const dimensions = [
    ['visual', acceptance.visualReview],
    ['voice', acceptance.voiceReview],
    ['audience', acceptance.audienceReview],
    ['final', acceptance.userAcceptance],
  ] as const;
  for (const [dimension, review] of dimensions) if (review.status !== 'PASS' || !review.recordId) issues.push(`Current ${dimension} approval is not PASS`);
  let rows: ApprovalRecord[];
  try {
    rows = await Promise.all((await readdir(path.join(project, 'approvals'))).filter((name) => name.endsWith('.json'))
      .map(async (name) => JSON.parse(await readFile(path.join(project, 'approvals', name), 'utf8')) as ApprovalRecord));
  } catch (error) {
    issues.push(`Approval records are unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return { status: 'NOT_RUN', issues };
  }
  const selected = new Map<string, ApprovalRecord>();
  for (const [dimension, review] of dimensions) {
    const row = rows.find((item) => item.recordId === review.recordId);
    if (!row || row.reviewerType !== 'USER' || row.dimension !== dimension || row.decision !== 'ACCEPTED' || row.planSha256 !== acceptance.planSha256) {
      issues.push(`Current ${dimension} approval record is missing or invalid`);
      continue;
    }
    selected.set(dimension, row);
  }
  for (const dimension of ['visual', 'audience', 'final']) {
    const row = selected.get(dimension);
    if (row && row.videoSha256 !== finalSha256) issues.push(`Current ${dimension} approval is not bound to the final video`);
  }
  const voice = selected.get('voice')?.voiceSha256;
  const finalVoice = selected.get('final')?.voiceSha256;
  if (!SHA.test(typeof voice === 'string' ? voice : '') || finalVoice !== voice) issues.push('Current voice and final approvals are not bound to the same approved voice artifact');
  const anyRecorded = rows.length > 0 || dimensions.some(([, review]) => review.decision !== 'NOT_RUN');
  return { status: issues.length ? anyRecorded ? 'PARTIAL' : 'NOT_RUN' : 'PASS', issues };
}

/** Verify current release evidence without manufacturing user approval or re-running production. */
export async function verifyReleaseEvidence(project: string): Promise<ReleaseEvidence> {
  const files = {
    spec: path.join(project, 'video-spec.json'),
    entry: path.join(project, 'index.html'),
    video: path.join(project, 'renders/final.mp4'),
    qa: path.join(project, 'reports/qa-report.json'),
    media: path.join(project, 'reports/high-media-report.json'),
    render: path.join(project, 'reports/render-high-report.json'),
    state: path.join(project, 'run-state.json'),
    plan: path.join(project, 'resolved-creative-plan.json'),
  };
  const missing = (await Promise.all(Object.entries(files).map(async ([label, file]) => [label, await exists(file)] as const)))
    .filter(([, present]) => !present).map(([label]) => label);
  if (missing.length) return { engineering: 'NOT_RUN', artifactAcceptance: 'NOT_RUN', issues: [`Release evidence missing: ${missing.join(', ')}`] };

  const issues: string[] = [];
  let spec: VideoSpec;
  let qa: EvidenceReport;
  let media: EvidenceReport;
  let render: RenderReport;
  try {
    spec = validateSpec(JSON.parse(await readFile(files.spec, 'utf8')));
    qa = JSON.parse(await readFile(files.qa, 'utf8')) as EvidenceReport;
    validateQaReport(qa);
    media = JSON.parse(await readFile(files.media, 'utf8')) as EvidenceReport;
    render = JSON.parse(await readFile(files.render, 'utf8')) as RenderReport;
  } catch (error) {
    return { engineering: 'FAIL', artifactAcceptance: 'NOT_RUN', issues: [`Release evidence is invalid: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (spec.generatorPolicy === undefined) issues.push('Release specification is not a current generator task');
  if (spec.audio.narrationMode === 'none') issues.push('A silent technical draft cannot satisfy current high-quality release evidence');
  for (const check of checkGeneratorSpec(spec).filter((item) => item.status !== 'PASS')) issues.push(`Current specification fails ${check.id}`);

  if (qa.projectId !== spec.projectId) issues.push('QA report projectId differs from the video specification');
  if (qa.status !== 'PASS') issues.push('QA report status is not PASS');
  const qaChecks = asChecks(qa.checks, 'QA report', issues);
  requirePass(qaChecks, requiredQaIds(spec), 'QA', issues);
  if (spec.audio.narrationMode !== 'none') requireNarrationCueChecks(qaChecks, issues);

  if (media.status !== 'PASS') issues.push('High-media report status is not PASS');
  const mediaChecks = asChecks(media.checks, 'High-media report', issues);
  requirePass(mediaChecks, mediaIds, 'High-media', issues);

  let finalSha256: string;
  try {
    if ((await stat(files.video)).size <= 0) throw new Error('final video is empty');
    finalSha256 = digest(await readFile(files.video));
  } catch (error) {
    return { engineering: 'FAIL', artifactAcceptance: 'NOT_RUN', issues: [...issues, `Final video is unreadable: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (render.quality !== 'high' || render.exitCode !== 0 || render.output !== 'renders/final.mp4') issues.push('High render report does not identify a successful renders/final.mp4 output');
  if (render.videoSha256 !== finalSha256) issues.push('High render report video hash differs from the actual final video');
  if (render.specSha256 !== digest(await readFile(files.spec))) issues.push('High render report spec hash differs from the current video specification');
  if (render.entrySha256 !== digest(await readFile(files.entry))) issues.push('High render report entry hash differs from the current composition');

  try {
    const state = await readState(project);
    if (state.schemaVersion !== '1.0') issues.push('Current run-state schemaVersion is invalid');
    await verifyStageOutputs(project, 'final', state.stages.final,
      ['renders/final.mp4', 'reports/high-media-report.json', 'reports/render-high-report.json'], issues);
    await verifyStageOutputs(project, 'media', state.stages.media, ['reports/qa-report.json', 'reports/audio-binding.json'], issues);
  } catch (error) {
    issues.push(`Current run-state is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const engineeringIssues = [...new Set(issues)];
  const approvals = await verifyApprovals(project, finalSha256);
  const allIssues = [...new Set([...engineeringIssues, ...approvals.issues])];
  return {
    engineering: engineeringIssues.length ? 'FAIL' : 'PASS',
    artifactAcceptance: approvals.status,
    issues: allIssues,
    ...(engineeringIssues.length ? {} : { videoSha256: finalSha256 }),
  };
}
