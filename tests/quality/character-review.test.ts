// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { VideoSpec } from '../../src/contracts.ts';
import { validateSpec } from '../../src/contracts.ts';
import { digest } from '../../src/pipeline/stage-state.ts';
import { assessCharacterReview, assertCharacterReview, characterReviewEvidenceInputs, freezeCharacterReview, recordCharacterDecision, type CharacterReviewSelection } from '../../src/quality/character-review.ts';
import { characterFixture } from '../fixtures/character.ts';
import { assertGeneratorSnapshot, composeProject, freezeGeneratorProject, synthesizeProjectVoice } from '../../src/pipeline/generator.ts';
import { freezeCreativePlan, type CreativePlan } from '../../src/quality/plan.ts';
import { renderQuality } from '../../src/quality/render.ts';
import { renderProject, runProject } from '../../src/pipeline/run.ts';
import { sourceChecks } from '../../src/pipeline/qa.ts';
import {renderPuppetSvg} from '../../src/quality/performance.ts';

async function fixture(t: TestContext, mode: CharacterReviewSelection['mode'] = 'stickman') {
  const base = path.resolve('.cache'), root = path.join(base, `character-review-${randomUUID()}`), project = path.join(root, 'projects', 'sample');
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await mkdir(path.join(root, 'src/quality'), { recursive: true });
  t.after(async () => { assert.equal(path.dirname(root), base); assert.match(path.basename(root), /^character-review-/); await rm(root, { recursive: true }); });
  const renderer = 'export const rendererVersion = "test-v1";';
  await writeFile(path.join(root, 'src/quality/performance.ts'), renderer);
  const kinds = mode === 'enhe' ? ['tuotuo', 'xinbi'] : [mode];
  const assets: any[] = [];
  const files = [];
  for (const [index, kind] of kinds.entries()) {
    const vector=['tuotuo','xinbi'].includes(kind)?{color:'#A9D7FC',head:'<circle cx="120" cy="100" r="40"/>',body:'<ellipse cx="120" cy="230" rx="55" ry="60"/>'}:undefined;
    const content=kind==='custom'?'<svg>custom fixture</svg>':renderPuppetSvg(kind as any,undefined,vector);
    const id = `actor-${index}`, file = { path: `assets/${id}.svg`, sha256: digest(content) };
    await writeFile(path.join(project, file.path), content);
    assets.push({ id, path: file.path, license: 'authorized', characterRig: { kind,...(vector?{vector}:{}) } }); files.push(file);
  }
  const actorAssets = [...assets];
  if (mode === 'custom') {
    const parts: Record<string, string> = {};
    for (const part of ['head','body','upperArm','forearm','hand','thigh','shin','foot']) {
      const id = `part-${part}`, content = `<svg>${part}</svg>`, file = { path: `assets/${id}.svg`, sha256: digest(content) };
      await writeFile(path.join(project, file.path), content);
      assets.push({ id, path: file.path, license: 'authorized' }); files.push(file); parts[part] = id;
    }
    actorAssets[0]!.characterRig.parts = parts;
  }
  const preview = { path: 'preview.html', sha256: digest('<html>ACTUAL TEST PREVIEW FIXTURE</html>') };
  await writeFile(path.join(project, preview.path), '<html>ACTUAL TEST PREVIEW FIXTURE</html>');
  const qaValue = { schemaVersion: '1.0', previewSha256: preview.sha256, rendererHash: digest(renderer), actors: actorAssets.map(asset => ({
    assetId: asset.id, alpha: { totalPixels: 10000, transparentPixels: 6000, borderPixels: 396, opaqueBorderPixels: 0 },
    jointSamples: [0, .1, .2].map((timeSec, index) => ({ timeSec, joints: { 'left-arm': `matrix(1,0,0,1,${index},0)`, 'right-arm': `matrix(1,0,0,1,0,${index})` } })),
  })) };
  const qaBytes = JSON.stringify(qaValue), qa = { path: 'qa.json', sha256: digest(qaBytes) };
  await writeFile(path.join(project, qa.path), qaBytes);
  const selection: CharacterReviewSelection = { schemaVersion: '1.0', mode, actorAssetIds: actorAssets.map(a => a.id), rigs: actorAssets.map(asset => ({ assetId: asset.id, ...structuredClone(asset.characterRig) })), sources: files, references: [], prepared: files, preview, rendererHash: digest(renderer), qa };
  const spec = { projectId: 'sample', assets, scenes: [{ character: { performance: {}, actors: actorAssets.map(a => ({ assetId: a.id })) } }] } as unknown as VideoSpec;
  return { root, project, spec, selection, qaValue };
}
async function accept(f: Awaited<ReturnType<typeof fixture>>) {
  const frozen = await freezeCharacterReview(f.root, f.project, f.selection);
  await recordCharacterDecision(f.root, f.project, { decision: 'ACCEPTED', reviewSha256: frozen.reviewSha256, userInstruction: 'TEST FIXTURE ONLY: chosen characters and action preview accepted.' });
  return frozen;
}
test('removing performance from the spec cannot bypass an existing performance HTML or review',async t=>{
 const f=await fixture(t),legacy={scenes:[{character:{}}]} as VideoSpec;
 await writeFile(path.join(f.project,'index.html'),'<div data-performance-stage></div>');
 await assert.rejects(assertCharacterReview(f.root,f.project,legacy),/contract removed/);
 await writeFile(path.join(f.project,'index.html'),'<p>legacy</p>');
 await freezeCharacterReview(f.root,f.project,f.selection);
 await assert.rejects(assertCharacterReview(f.root,f.project,legacy),/contract removed/);
});
test('reviewing unrelated SVG bytes does not approve the inline vector renderer',async t=>{
 const f=await fixture(t),file=f.selection.prepared[0]!;
 await writeFile(path.join(f.project,file.path),'<svg>unrelated reviewed picture</svg>');
 file.sha256=digest('<svg>unrelated reviewed picture</svg>');
 await accept(f);
 await assert.rejects(assertCharacterReview(f.root,f.project,f.spec),/inline rig geometry/);
});
async function writeProductionSpec(f: Awaited<ReturnType<typeof fixture>>) {
  const spec = characterFixture(); spec.projectId = 'sample'; spec.audio.narrationMode = 'none';
  spec.assets = spec.assets.filter(asset => !asset.characterPoses);
  spec.assets.push(...f.spec.assets.map(asset => ({ ...asset, type: 'image' as const, sourceUrl: '', required: true, fallbackAssetId: null })));
  const background = { id: 'workplace', type: 'image' as const, path: 'assets/workplace.png', sourceUrl: '', license: 'authorized' as const, required: true, fallbackAssetId: null };
  spec.assets.push(background); const scene = spec.scenes[0]!;
  scene.assetRefs = [...f.selection.actorAssetIds, background.id]; scene.backgroundAssetId = background.id;
  scene.character!.actors = f.selection.actorAssetIds.map((assetId, i) => ({ assetId, side: i ? 'right' : 'left' }));
  scene.character!.performance = { version: 'performance-v1', fact: spec.product.primaryProblem, sourceField: 'product.primaryProblem', objective: 'Find materials', obstacle: 'Scattered inputs', outcome: 'One project',
    roles: f.selection.actorAssetIds.map((_, actor) => ({ actor, role: 'Product user' })), props: [{ id: 'brief', kind: 'document', textIndices: scene.onScreenText.slice(1).map((_, i) => i + 1), x: 300, y: 60 }],
    cues: [{ actor: 0, startFrame: 0, endFrame: 50, fromX: 90, toX: 300, propId: 'brief', verb: 'walk', meaning: 'Walk to the missing brief' }] };
  scene.action!.subject.assetId = f.selection.actorAssetIds[0]!;
  validateSpec(spec); await writeFile(path.join(f.project, 'video-spec.json'), JSON.stringify(spec));
  return spec;
}

test('character gate is opt-in for performance and requires explicit reviewed selection', async t => {
  const f = await fixture(t);
  await assertCharacterReview(f.root, f.project, { scenes: [{ character: {} }] } as VideoSpec);
  await assert.rejects(assertCharacterReview(f.root, f.project, f.spec), /character.*review|selection/i);
  await freezeCharacterReview(f.root, f.project, f.selection);
  assert.equal((await assessCharacterReview(f.root, f.project)).decision, 'NOT_RUN');
  await assert.rejects(assertCharacterReview(f.root, f.project, f.spec), /character.*review|approval/i);
});

for (const mode of ['enhe', 'stickman'] as const) test(`${mode} approved selection passes; latest rejection overrides it`, async t => {
  const f = await fixture(t, mode); const frozen = await accept(f);
  await assertCharacterReview(f.root, f.project, f.spec);
  const prior = await readdir(path.join(f.project, 'character-approvals'));
  await recordCharacterDecision(f.root, f.project, { decision: 'REJECTED', reviewSha256: frozen.reviewSha256, userInstruction: 'TEST FIXTURE: revise the action.' });
  assert.equal((await assessCharacterReview(f.root, f.project)).decision, 'REJECTED');
  await assert.rejects(assertCharacterReview(f.root, f.project, f.spec), /character.*review|approval/i);
  assert.equal((await readdir(path.join(f.project, 'character-approvals'))).length, prior.length + 1);
});

test('review freeze is idempotent and refuses silent mode or renderer changes', async t => {
  const f = await fixture(t); const frozen = await freezeCharacterReview(f.root, f.project, f.selection);
  const bytes = await readFile(path.join(f.project, 'character-review.json'));
  assert.deepEqual(await freezeCharacterReview(f.root, f.project, f.selection), frozen);
  await assert.rejects(freezeCharacterReview(f.root, f.project, { ...f.selection, mode: 'custom' }), /existing|variant|changed|mode/i);
  assert.deepEqual(await readFile(path.join(f.project, 'character-review.json')), bytes);
  await writeFile(path.join(f.root, 'src/quality/performance.ts'), 'changed renderer');
  assert.equal((await assessCharacterReview(f.root, f.project)).decision, 'STALE');
});

for (const target of ['asset', 'preview', 'qa', 'renderer'] as const) test(`${target} changed after approval rejects production`, async t => {
  const f = await fixture(t); await accept(f);
  const file = target === 'renderer' ? path.join(f.root, 'src/quality/performance.ts') : path.join(f.project, target === 'asset' ? f.selection.prepared[0]!.path : f.selection[target].path);
  await writeFile(file, 'changed bytes');
  await assert.rejects(assertCharacterReview(f.root, f.project, f.spec), /changed|review|hash/i);
});

test('a copied approval cannot transfer to a different task and unsafe paths are rejected', async t => {
  const f = await fixture(t); await accept(f);
  const other = path.join(f.root, 'projects/another'); await cp(f.project, other, { recursive: true });
  assert.equal((await assessCharacterReview(f.root, other)).decision, 'STALE');
  for (const file of ['../outside.png', 'C:/outside.png']) {
    const changed = structuredClone(f.selection); changed.sources[0]!.path = file;
    await assert.rejects(freezeCharacterReview(f.root, f.project, changed), /path|traversal|relative/i);
  }
});

test('catalog-like APPROVED booleans, missing evidence and static pose swaps cannot satisfy the gate', async t => {
  const f = await fixture(t);
  for (const mutation of [
    (qa: any) => { qa.actors[0].alpha.transparentPixels = 0; },
    (qa: any) => { qa.actors[0].alpha.opaqueBorderPixels = 3; },
    (qa: any) => { qa.actors[0].jointSamples[2].joints = qa.actors[0].jointSamples[0].joints; },
    (qa: any) => { qa.actors[0].jointSamples[1].timeSec = 10; },
    (qa: any) => { qa.actors = []; qa.approved = true; },
  ]) {
    const qa = structuredClone(f.qaValue); mutation(qa); const bytes = JSON.stringify(qa);
    await writeFile(path.join(f.project, f.selection.qa.path), bytes);
    await assert.rejects(freezeCharacterReview(f.root, f.project, { ...f.selection, qa: { ...f.selection.qa, sha256: digest(bytes) } }), /QA|transparent|joint|sample|actor/i);
  }
});

test('custom input requires the reviewed uploaded parts and rejects an unrelated or unauthorized cast', async t => {
  const f = await fixture(t, 'custom'); await accept(f);
  const actor = f.spec.assets[0] as any, originalParts = actor.characterRig.parts;
  delete actor.characterRig.parts;
  await assert.rejects(assertCharacterReview(f.root, f.project, f.spec), /custom|parts|rig/i);
  actor.characterRig.parts = originalParts;
  await assertCharacterReview(f.root, f.project, f.spec);
  [actor.characterRig.parts.head, actor.characterRig.parts.foot] = [actor.characterRig.parts.foot, actor.characterRig.parts.head];
  await assert.rejects(assertCharacterReview(f.root, f.project, f.spec), /parts|changed/i);
  [actor.characterRig.parts.head, actor.characterRig.parts.foot] = [actor.characterRig.parts.foot, actor.characterRig.parts.head];
  actor.characterRig.kind = 'stickman';
  await assert.rejects(assertCharacterReview(f.root, f.project, f.spec), /mode|kind|custom/i);
  actor.characterRig.kind = 'custom'; actor.license = 'unknown';
  await assert.rejects(assertCharacterReview(f.root, f.project, f.spec), /authorized|license/i);
});

test('empty or stale decisions and junction review directories fail closed', async t => {
  const f = await fixture(t); const frozen = await freezeCharacterReview(f.root, f.project, f.selection);
  await assert.rejects(recordCharacterDecision(f.root, f.project, { decision: 'ACCEPTED', reviewSha256: frozen.reviewSha256, userInstruction: ' ' }), /instruction/i);
  await assert.rejects(recordCharacterDecision(f.root, f.project, { decision: 'ACCEPTED', reviewSha256: '0'.repeat(64), userInstruction: 'test' }), /hash/i);
  const outside = path.join(f.root, 'outside'); await mkdir(outside); await symlink(outside, path.join(f.project, 'character-approvals'), 'junction');
  await assert.rejects(recordCharacterDecision(f.root, f.project, { decision: 'ACCEPTED', reviewSha256: frozen.reviewSha256, userInstruction: 'test' }), /junction|link/i);
  assert.deepEqual(await readdir(outside), []);
});

test('reference provenance, the real renderer and complete uploaded custom parts are mandatory evidence', async t => {
  const f = await fixture(t, 'custom');
  const incomplete = structuredClone(f.selection);
  for (const part of Object.keys(incomplete.rigs[0]!.parts!)) (incomplete.rigs[0]!.parts! as Record<string, string>)[part] = f.spec.assets[0]!.id;
  await assert.rejects(freezeCharacterReview(f.root, f.project, incomplete), /eight.*distinct|articulated/i);
  await assert.rejects(freezeCharacterReview(f.root, f.project, { ...f.selection, rendererHash: 'a'.repeat(64) }), /renderer/i);
  const original = { path: 'assets/original-reference.png', sha256: digest('original source fixture') };
  await writeFile(path.join(f.project, original.path), 'original source fixture'); f.selection.references.push(original);
  await accept(f);
  await writeFile(path.join(f.project, original.path), 'replacement source');
  assert.equal((await assessCharacterReview(f.root, f.project)).decision, 'STALE');
  await assert.rejects(assertCharacterReview(f.root, f.project, f.spec), /review|changed/i);
});

test('malformed, copied or ambiguous decisions cannot produce acceptance', async t => {
  const f = await fixture(t); await accept(f);
  const directory = path.join(f.project, 'character-approvals');
  const [name] = await readdir(directory), decision = JSON.parse(await readFile(path.join(directory, name!), 'utf8'));
  await writeFile(path.join(directory, 'duplicate.json'), JSON.stringify(decision));
  assert.equal((await assessCharacterReview(f.root, f.project)).decision, 'STALE');
  await assert.rejects(assertCharacterReview(f.root, f.project, f.spec), /history|review/i);
});

test('normal voice, compose, freeze and snapshot entries refuse unapproved performance before output', async t => {
  const f = await fixture(t); await writeProductionSpec(f);
  await freezeCharacterReview(f.root, f.project, f.selection);
  for (const entry of [synthesizeProjectVoice, composeProject, freezeGeneratorProject, assertGeneratorSnapshot]) {
    await assert.rejects(entry(f.project), /Character review approval required/);
  }
  assert.ok(!(await readdir(f.project)).includes('resolved-creative-plan.json'));
  assert.ok(!(await readdir(f.project)).includes('index.html'));
});

test('deleting generatorPolicy cannot bypass normal render, run or QA character gates', async t => {
  const f = await fixture(t), spec = await writeProductionSpec(f); delete spec.generatorPolicy;
  const scene = spec.scenes[0]!;
  spec.scenes = Array.from({ length: 5 }, (_, i) => ({ ...structuredClone(scene), id: `scene-${i}`, actualStartSec: i * 8, actualEndSec: (i + 1) * 8, heroFrameSec: i * 8 + 2 }));
  spec.output.targetDurationSec = 40; validateSpec(spec);
  await writeFile(path.join(f.project, 'video-spec.json'), JSON.stringify(spec));
  await assert.rejects(renderProject(f.project, 'draft', true), /Character review approval required/);
  await assert.rejects(runProject(f.project, true, true, 'draft'), /Character review approval required/);
  await assert.rejects(sourceChecks(f.project, spec), /Character review approval required/);
  assert.ok(!(await readdir(f.project)).includes('renders'));
});

test('review freezes private character vector geometry as well as body-part assignments', async t => {
  const f = await fixture(t, 'enhe');
  const vector = { color: '#A9D7FC', head: '<circle cx="50" cy="50" r="40"/>', body: '<ellipse cx="50" cy="150" rx="20" ry="40"/>' };
  f.selection.rigs[0]!.vector = structuredClone(vector); f.spec.assets[0]!.characterRig!.vector = structuredClone(vector);
  const content=renderPuppetSvg('tuotuo',undefined,vector),file=f.selection.prepared[0]!;
  await writeFile(path.join(f.project,file.path),content);file.sha256=digest(content);
  await accept(f); await assertCharacterReview(f.root, f.project, f.spec);
  f.spec.assets[0]!.characterRig!.vector!.head = '<circle cx="50" cy="50" r="45"/>';
  await assert.rejects(assertCharacterReview(f.root, f.project, f.spec), /geometry|changed/i);
});

test('production snapshot evidence includes the preview, QA, source assets, rig manifest and latest decision', async t => {
  const f = await fixture(t); await accept(f);
  const files = (await characterReviewEvidenceInputs(f.root, f.project, f.spec)).map(file => path.relative(f.project, file).replaceAll('\\', '/'));
  for (const file of ['character-review.json', ...f.selection.sources.map(file => file.path), ...f.selection.prepared.map(file => file.path), f.selection.preview.path, f.selection.qa.path]) assert.ok(files.includes(file));
  assert.equal(files.filter(file => file.startsWith('character-approvals/')).length, 1);
  assert.deepEqual(await characterReviewEvidenceInputs(f.root, f.project, { scenes: [] } as unknown as VideoSpec), []);
});

test('the actual character CLI freezes, reports, records and checks the explicit task selection', async t => {
  const f = await fixture(t); await writeProductionSpec(f);
  const input = path.join(f.root, 'selection.json'); await writeFile(input, JSON.stringify(f.selection));
  const run = (args: string[]) => promisify(execFile)(process.execPath, [path.resolve('src/quality/cli.ts'), ...args, '--project-root', f.root, '--project', 'sample'], { cwd: process.cwd(), windowsHide: true });
  const frozen = JSON.parse((await run(['character-freeze', '--selection', input])).stdout);
  assert.equal(JSON.parse((await run(['character-status'])).stdout).decision, 'NOT_RUN');
  await assert.rejects(run(['character-check']), /Character review approval required/);
  const decision = path.join(f.root, 'decision.json');
  await writeFile(decision, JSON.stringify({ decision: 'ACCEPTED', reviewSha256: frozen.reviewSha256, userInstruction: 'TEST FIXTURE ONLY: this chosen actor and preview are accepted.' }));
  await run(['character-review', '--decision', decision]);
  assert.equal(JSON.parse((await run(['character-check'])).stdout).status, 'PASS');
});

test('standalone quality render rejects missing character approval even when a render cache is present', async t => {
  const f = await fixture(t); await writeProductionSpec(f); await freezeCharacterReview(f.root, f.project, f.selection);
  const html = '<div data-performance-stage>TEST FIXTURE action preview</div>';
  await writeFile(path.join(f.project, 'index.html'), html);
  const manifest = JSON.stringify({ schemaVersion: '1.0', libraryVersion: 'v1', catalogSha256: digest('catalog'), selection: { selections: [], omissionReason: 'Synthetic test.' }, assets: [] });
  await writeFile(path.join(f.project, 'frozen-brand-assets.json'), manifest); await writeFile(path.join(f.project, 'font.woff2'), 'test font');
  const plan: CreativePlan = { schemaVersion: '1.0', projectId: 'sample', productId: 'sample', variantId: 'v1', brief: 'Test character gate',
    sources: [{ source: 'composition-entry', path: 'projects/sample/index.html', sha256: digest(html) }],
    design: { style: 'fixture', rationale: { openingReason: 'Test opening', productSpecificShots: ['test'], recentAcceptedComparison: [] } }, frameRate: 30, width: 1920, height: 1080, durationFrames: 240,
    shots: [{ id: 'scene', startFrame: 0, endFrame: 240, purpose: 'Test gate', motion: 'Walk' }], fonts: [{ family: 'Fixture', path: 'projects/sample/font.woff2', sha256: digest('test font'), version: '1' }],
    assets: { manifestPath: 'projects/sample/frozen-brand-assets.json', sha256: digest(manifest) }, narration: { status: 'PENDING_REVIEW', provider: 'none', modelId: 'none', voiceId: 'none', textHash: digest(''), pronunciationMapHash: digest('{}') } };
  const resolved = await freezeCreativePlan(f.root, f.project, plan);
  await mkdir(path.join(f.project, 'renders')); await mkdir(path.join(f.project, 'reports'));
  await writeFile(path.join(f.project, 'renders/old.mp4'), 'cached video fixture');
  await writeFile(path.join(f.project, 'reports/quality-render-old.json'), JSON.stringify({ status: 'PASS', planSha256: resolved.resolvedPlanSha256, videoSha256: digest('cached video fixture') }));
  await assert.rejects(renderQuality(f.root, f.project, 'old', true), /Character review approval required/);
  const specPath = path.join(f.project, 'video-spec.json'), spec = JSON.parse(await readFile(specPath, 'utf8')); delete spec.scenes[0].character.performance;
  await writeFile(specPath, JSON.stringify(spec));
  await assert.rejects(renderQuality(f.root, f.project, 'old', true), /cannot bypass review/);
});
