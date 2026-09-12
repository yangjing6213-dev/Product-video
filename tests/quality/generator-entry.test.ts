// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { initialize, inputFor } from '../../src/pipeline/project.ts';
import { composeProject, freezeGeneratorProject, assertGeneratorSnapshot, productInputFromSpec, validateGeneratorActions } from '../../src/pipeline/generator.ts';
import { copyDraftFromVideoSpec, freezeCopyDraft, recordCopyDecision } from '../../src/quality/copy.ts';
import { validProductInput, validVideoSpec } from '../fixtures/input.ts';
import type { VideoSpec } from '../../src/contracts.ts';

async function fixture() {
  const base = path.resolve('.cache/generator-quality-003/tests'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, '正常入口 中文 '));
  await mkdir(path.join(root, 'assets/brand/enhe/ip'), { recursive: true });
  await writeFile(path.join(root, 'assets/brand/enhe/ip/catalog.json'), JSON.stringify({ schemaVersion: '1.0', libraryVersion: 'fixture-v1', assets: [] }));
  const input = structuredClone(validProductInput);
  input.projectId = 'generic-entry'; input.output.targetDurationSec = 12;
  input.audio.narrationMode = 'none'; input.audio.externalAudioAssetId = null;
  input.brandLibrary = { selections: [], omissionReason: 'No brand characters in this fixture.' };
  input.authorContacts = { name: 'Fixture Author', items: [
    { label: 'GitHub', value: 'example' }, { label: 'X / Twitter', value: '@example' },
    { label: '网站', value: 'example.com' }, { label: '微信', value: 'example-wechat' }, { label: '邮箱', value: 'test@example.com' },
  ] };
  input.assets = [
    { id: input.brand.logoAssetId, type: 'logo', path: 'logo.svg', sourceUrl: '', license: 'owned', required: true, fallbackAssetId: null },
    { id: 'subject', type: 'image', path: 'subject.svg', sourceUrl: '', license: 'owned', required: true, fallbackAssetId: null },
    { id: 'fixture-font', type: 'font', path: 'font.woff2', fontFamily: input.brand.fontFamilies[0]!, sourceUrl: '', license: 'owned', required: true, fallbackAssetId: null },
  ];
  for (const file of ['logo.svg', 'subject.svg']) await writeFile(path.join(root, file), '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="white"/></svg>');
  await writeFile(path.join(root, 'font.woff2'), 'fixture bytes; this test does not claim font rendering');
  const file = path.join(root, 'brief.json'); await writeFile(file, JSON.stringify(input));
  const project = await initialize(file, root), canonical = await inputFor(project);
  assert.equal(canonical.brand.visualStyle, 'editorial-v2', 'normal init freezes the new visual default');
  const spec: VideoSpec = { ...structuredClone(validVideoSpec), ...canonical, scenes: [
    { ...structuredClone(validVideoSpec.scenes[0]!), id: 'proof', goal: 'Explain this actual product result', actualStartSec: 0, actualEndSec: 6, plannedDurationSec: 6, voiceover: '', caption: 'A real result', onScreenText: [canonical.product.name, 'A real result'], assetRefs: ['subject'], heroFrameSec: 3,
      action: { intent: 'Hand the result to the viewer', primitive: 'object-handoff', subject: { assetId: 'subject' }, beforeState: 'Incoming result', afterState: 'Readable result', startFrame: 0, endFrame: 60, holdFrames: 90 } },
    { ...structuredClone(validVideoSpec.scenes[0]!), id: 'ending', goal: 'Read the primary destination and secondary contacts', actualStartSec: 6, actualEndSec: 12, plannedDurationSec: 6, voiceover: '', caption: '恩禾官网', onScreenText: [canonical.product.cta.label, 'www.enhe-tech.com.cn'], assetRefs: ['subject'], heroFrameSec: 10,
      action: { intent: 'Read the ending', primitive: 'reading-hold', subject: { assetId: 'subject' }, beforeState: 'Readable result', afterState: 'Readable result', startFrame: 0, endFrame: 1, holdFrames: 170 } },
  ] };
  spec.narrative.cta = canonical.product.cta.label;
  await writeFile(path.join(project, 'video-spec.json'), JSON.stringify(spec));
  for (const doc of ['DESIGN.md', 'SCRIPT.md', 'STORYBOARD.md']) await writeFile(path.join(project, doc), `Fixture evidence\n${canonical.brand.colors.join(' ')}`);
  return { root, project, spec, canonical };
}

test('normal common compose binds contacts and optional input fields and requires real copy approval', async () => {
  const f = await fixture();
  assert.deepEqual(productInputFromSpec(f.spec), f.canonical);
  await assert.rejects(composeProject(f.project), /Copy approval required/);
  const copy = await freezeCopyDraft(f.root, f.project, copyDraftFromVideoSpec(f.spec, 'fixture-v1'));
  await recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: copy.copySha256, userInstruction: 'Synthetic test approval fixture; not a real user or real video acceptance.' });
  const file = await composeProject(f.project), html = await readFile(file, 'utf8');
  assert.match(html, /data-asset-id="subject"/);
  for (const item of f.canonical.authorContacts!.items) assert.ok(html.includes(item.value));
  await writeFile(path.join(f.project, 'assets/music-license.txt'), 'Fixture license preserved with the media');
  await mkdir(path.join(f.project, 'reports'), { recursive: true });
  await writeFile(path.join(f.project, 'reports/music-source.json'), '{"source":"fixture"}');
  await freezeGeneratorProject(f.project);
  const plan = JSON.parse(await readFile(path.join(f.project, 'resolved-creative-plan.json'), 'utf8'));
  assert.ok(plan.sources.some((source: { source: string }) => source.source === 'runtime:assets/music-license.txt'));
  assert.ok(plan.sources.some((source: { source: string }) => source.source === 'runtime:reports/music-source.json'));
  assert.equal(await composeProject(f.project), file, 'Frozen resume reads the exact composition instead of rebuilding it');
  await assertGeneratorSnapshot(f.project);
  await writeFile(path.join(f.project, 'assets/subject.svg'), 'changed fixture asset');
  await assert.rejects(assertGeneratorSnapshot(f.project), /Runtime asset changed/);
  await assert.rejects(composeProject(f.project), /Runtime asset changed/);
});

test('label-only or entirely static plans cannot qualify as a product subject-action film', async () => {
  const f = await fixture();
  f.spec.scenes[0]!.action!.subject.assetId = 'decorative-label';
  assert.throws(() => validateGeneratorActions(f.spec), /real declared asset/);
  f.spec.scenes[0]!.action!.subject.assetId = 'subject';
  f.spec.scenes[0]!.action!.primitive = 'reading-hold';
  assert.throws(() => validateGeneratorActions(f.spec), /does not demonstrate/);
});
