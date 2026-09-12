// SPDX-License-Identifier: Apache-2.0
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { VideoSpec } from '../contracts.ts';
import { normalizedRelativePath, resolveProjectAsset, writeExclusiveSnapshot } from '../assets/library.ts';
import { assertVideoSpecCopyApproved } from '../quality/copy.ts';
import { qwenEvidenceInputs } from '../qa/qwen-narration.ts';
import { digest, exists } from './stage-state.ts';
import { specFor } from './project.ts';
import { trustedGeneratorPolicy } from '../quality/policy.ts';

export const VOICE_REUSE_FILE = 'reports/voice-reuse.json';
const SNAPSHOT = 'reports/voice-reuse-source';
const CORE = ['video-spec.json', 'input/product-input.json', 'copy-script.json', 'input/narration-script.json',
  'input/current-voice-profile.json', 'input/current-pronunciation.json', 'assets/narration.wav',
  'transcript.json', 'captions.srt', 'reports/narration-cues.json', 'reports/tts-generation.json'];
const contextOnly = (file: string) => ['video-spec.json', 'copy-script.json', 'input/product-input.json'].includes(file) || file.startsWith('copy-approvals/');
interface Binding {
  schemaVersion: '1.0'; mode: 'visual-only-byte-reuse'; inferenceCount: 0;
  sourceProject: string; targetProject: string; targetSpecSha256: string; targetCopySha256: string;
  sourceCopySha256: string; files: Array<{ path: string; sha256: string }>;
}

/** Project identity and visuals may differ; every audible instruction and time remains exact. */
export function assertVoiceReuseCompatible(source: VideoSpec, target: VideoSpec): void {
  const spokenPolicy = (spec: VideoSpec) => {
    if (!spec.generatorPolicy) return undefined;
    const policy = trustedGeneratorPolicy(spec.generatorPolicy);
    if (!policy) throw new Error('Visual-only voice reuse requires a trusted policy');
    // A separately approved visual CTA may change; every other rule and all audible instructions remain exact.
    const { version: _version, rulesSha256: _hash, ...rules } = policy;
    return { ...rules, marketing: { ...rules.marketing, screenAction: '' } };
  };
  const speech = (spec: VideoSpec) => ({ audio: spec.audio, generatorPolicy: spokenPolicy(spec),
    fps: spec.output.fps, duration: spec.output.targetDurationSec,
    scenes: spec.scenes.map(scene => ({ id: scene.id, voiceover: scene.voiceover, caption: scene.caption,
      voiceDirection: scene.voiceDirection, actualStartSec: scene.actualStartSec,
      actualEndSec: scene.actualEndSec, plannedDurationSec: scene.plannedDurationSec })) });
  if (!isDeepStrictEqual(speech(source), speech(target))) throw new Error('Visual-only voice reuse requires identical narration, subtitles, audio settings, directions and scene timing');
}

function relativeProject(root: string, project: string): string {
  const relative = normalizedRelativePath(path.relative(root, project));
  if (!/^projects\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(relative)) throw new Error('Voice reuse requires a direct project in the same repository');
  return relative;
}

async function sourceFiles(source: string, spec: VideoSpec): Promise<string[]> {
  const approvals = (await readdir(path.join(source, 'copy-approvals'))).filter(name => name.endsWith('.json')).map(name => `copy-approvals/${name}`);
  const localEvidence = (await qwenEvidenceInputs(source, spec)).filter(file => file.startsWith(path.resolve(source) + path.sep))
    .map(file => normalizedRelativePath(path.relative(source, file)));
  return [...new Set([...CORE, ...approvals, ...localEvidence])].sort();
}

async function preserve(file: string, bytes: Buffer): Promise<void> {
  if (await exists(file)) {
    if (digest(await readFile(file)) !== digest(bytes)) throw new Error(`Existing voice artifact preserved; use a new variant: ${path.basename(file)}`);
  } else {
    await mkdir(path.dirname(file), { recursive: true }); await writeExclusiveSnapshot(file, bytes);
  }
}

/** Called only after the source has passed the ordinary full narration validator. No receipt is rewritten. */
export async function snapshotVoiceReuse(project: string, source: string): Promise<string> {
  const root = path.resolve(project, '../..'), targetSpec = await specFor(project), sourceSpec = await specFor(source);
  const targetProject = relativeProject(root, project), sourceProject = relativeProject(root, source);
  if (targetProject === sourceProject || await exists(path.join(source, VOICE_REUSE_FILE))) throw new Error('Reuse requires a different original narration project; chained reuse is not supported');
  assertVoiceReuseCompatible(sourceSpec, targetSpec);
  const targetCopy = await assertVideoSpecCopyApproved(root, project, targetSpec), sourceCopy = await assertVideoSpecCopyApproved(root, source, sourceSpec);
  const records = await Promise.all((await sourceFiles(source, sourceSpec)).map(async file => ({ path: file, bytes: await readFile(await resolveProjectAsset(source, file)) })));
  const binding: Binding = { schemaVersion: '1.0', mode: 'visual-only-byte-reuse', inferenceCount: 0, sourceProject, targetProject,
    targetSpecSha256: digest(await readFile(path.join(project, 'video-spec.json'))), targetCopySha256: targetCopy.copySha256,
    sourceCopySha256: sourceCopy.copySha256, files: records.map(file => ({ path: file.path, sha256: digest(file.bytes) })) };
  // Precheck every collision before writing; interrupted identical copies can be resumed.
  const destinations = records.flatMap(record => [path.join(SNAPSHOT, record.path), ...(contextOnly(record.path) ? [] : [record.path])].map(file => ({ file, bytes: record.bytes })));
  for (const item of destinations) {
    const file = await resolveProjectAsset(project, item.file, true);
    if (await exists(file) && digest(await readFile(file)) !== digest(item.bytes)) throw new Error(`Existing voice artifact preserved; use a new variant: ${item.file}`);
  }
  for (const item of destinations) await preserve(await resolveProjectAsset(project, item.file, true), item.bytes);
  for (const record of records) if (digest(await readFile(await resolveProjectAsset(source, record.path))) !== digest(record.bytes)) throw new Error(`Source narration changed during reuse: ${record.path}`);
  await preserve(path.join(project, VOICE_REUSE_FILE), Buffer.from(`${JSON.stringify(binding, null, 2)}\n`));
  await narrationEvidenceContext(project, targetSpec, targetCopy.copySha256);
  return path.join(project, VOICE_REUSE_FILE);
}

/** Validate both approved project contexts and byte-identical provenance before interpreting old receipts. */
export async function narrationEvidenceContext(project: string, spec: VideoSpec, copySha256: string): Promise<{ spec: VideoSpec; copySha256: string; specSha256: string; scriptSha256?: string }> {
  const script = path.join(project, 'input/narration-script.json');
  const current = { spec, copySha256, specSha256: digest(await readFile(path.join(project, 'video-spec.json'))),
    scriptSha256: await exists(script) ? digest(await readFile(script)) : undefined };
  const bindingFile = path.join(project, VOICE_REUSE_FILE);
  if (!await exists(bindingFile)) return current;
  const binding = JSON.parse(await readFile(bindingFile, 'utf8')) as Binding, root = path.resolve(project, '../..');
  if (binding.schemaVersion !== '1.0' || binding.mode !== 'visual-only-byte-reuse' || binding.inferenceCount !== 0
      || binding.targetProject !== relativeProject(root, project) || binding.targetSpecSha256 !== current.specSha256
      || binding.targetCopySha256 !== copySha256 || !Array.isArray(binding.files)
      || !isDeepStrictEqual(spec, await specFor(project))) throw new Error('Voice reuse target binding changed');
  const source = await resolveProjectAsset(root, binding.sourceProject);
  if (relativeProject(root, source) !== binding.sourceProject || source === path.resolve(project)
      || await exists(path.join(source, VOICE_REUSE_FILE))) throw new Error('Voice reuse source project is invalid');
  const sourceSpec = await specFor(source);
  assertVoiceReuseCompatible(sourceSpec, spec);
  await assertVideoSpecCopyApproved(root, project, spec);
  const sourceCopy = await assertVideoSpecCopyApproved(root, source, sourceSpec);
  if (sourceCopy.copySha256 !== binding.sourceCopySha256 || !isDeepStrictEqual(binding.files.map(file => file.path), await sourceFiles(source, sourceSpec))) throw new Error('Voice reuse source copy or evidence inventory changed');
  for (const file of binding.files) {
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Voice reuse evidence hash is invalid');
    for (const actual of [await resolveProjectAsset(source, file.path), await resolveProjectAsset(project, `${SNAPSHOT}/${file.path}`),
      ...(contextOnly(file.path) ? [] : [await resolveProjectAsset(project, file.path)])]) {
      if (digest(await readFile(actual)) !== file.sha256) throw new Error(`Voice reuse evidence changed: ${file.path}`);
    }
  }
  return { spec: sourceSpec, copySha256: sourceCopy.copySha256,
    specSha256: binding.files.find(file => file.path === 'video-spec.json')!.sha256,
    scriptSha256: binding.files.find(file => file.path === 'input/narration-script.json')!.sha256 };
}

/** Bound originals and snapshots participate in every replay fingerprint; deletion/tampering fails closed. */
export async function voiceReuseEvidenceInputs(project: string, localOnly = false): Promise<string[]> {
  const file = path.join(project, VOICE_REUSE_FILE);
  if (!await exists(file)) return [];
  const spec = await specFor(project), root = path.resolve(project, '../..');
  const copy = await assertVideoSpecCopyApproved(root, project, spec);
  await narrationEvidenceContext(project, spec, copy.copySha256);
  const binding = JSON.parse(await readFile(file, 'utf8')) as Binding;
  const source = await resolveProjectAsset(root, binding.sourceProject);
  return [file, ...binding.files.flatMap(item => [path.join(project, SNAPSHOT, item.path),
    ...(contextOnly(item.path) ? [] : [path.join(project, item.path)]), ...(localOnly ? [] : [path.join(source, item.path)])])];
}
