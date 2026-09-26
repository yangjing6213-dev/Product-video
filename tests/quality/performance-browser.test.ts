// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, type TestContext } from 'node:test';
import puppeteer from 'puppeteer-core';
import { environment } from '../../src/pipeline/tools.ts';
import { composeVideo } from '../../src/quality/composition.ts';
import { renderPuppetSvg } from '../../src/quality/performance.ts';
import { browserMotionQa } from '../../src/qa/motion.ts';
import { characterFixture } from '../fixtures/character.ts';
import { FIXTURE_FONTS, requireFixtureFont, TEST_CJK_FONT, writeBrowserAssets } from '../fixtures/browser-assets.ts';

async function fixture(t: TestContext) {
  await requireFixtureFont();
  const base = path.resolve('.cache/performance-browser-tests'); await mkdir(base, { recursive: true });
  const project = await mkdtemp(path.join(base, '角色动作 中文 空格 '));
  t.after(async () => { assert.equal(path.dirname(project), base); assert.ok(path.basename(project).startsWith('角色动作 中文 空格 ')); await rm(project, { recursive: true }); });
  await writeBrowserAssets(path.join(project, 'assets'));
  await copyFile(path.resolve('node_modules/gsap/dist/gsap.min.js'), path.join(project, 'assets/gsap.min.js'));
  const spec = characterFixture(); spec.projectId = 'performance-browser';
  spec.brand.colors = ['#FFFFFF', '#000000', '#555555']; spec.brand.fontFamilies = [TEST_CJK_FONT];
  spec.brandLibrary = { selections: [], omissionReason: 'Original built-in stick figures are not private brand assets.' };
  spec.audio.narrationMode = 'none'; spec.product.example = undefined;
  spec.assets = [
    { id: spec.brand.logoAssetId, type: 'logo', path: 'assets/logo.svg', sourceUrl: '', license: 'owned', required: true, fallbackAssetId: null },
    { id: 'workspace', type: 'image', path: 'assets/background.svg', sourceUrl: 'synthetic test scene; no photographic-quality claim', license: 'owned', required: true, fallbackAssetId: null },
    ...['one', 'two'].map((name, i) => ({ id: `actor-${name}`, type: 'image' as const, path: `assets/角色 ${i + 1}.svg`, sourceUrl: 'original built-in test figure', license: 'owned' as const, required: true, fallbackAssetId: null, width: 240, height: 420, characterRig: { kind: 'stickman' as const } })),
  ];
  for (const asset of spec.assets.filter(asset => asset.characterRig)) await writeFile(path.join(project, asset.path), renderPuppetSvg('stickman'));
  const scene = spec.scenes[0]!; scene.voiceover = ''; scene.caption = ''; scene.backgroundAssetId = 'workspace';
  scene.assetRefs = ['workspace', 'actor-one', 'actor-two'];
  scene.character!.actors = [{ assetId: 'actor-one', side: 'left' }, { assetId: 'actor-two', side: 'right' }];
  scene.character!.performance = {
    version: 'performance-v1', sourceField: 'product.primaryProblem', fact: spec.product.primaryProblem,
    objective: 'Gather the project brief', obstacle: 'Inputs are separated', outcome: 'One reviewed project',
    roles: [{ actor: 0, role: 'Project owner' }, { actor: 1, role: 'Collaborator' }],
    props: [{ id: 'brief', kind: 'document', textIndices: [1], x: 360, y: 100 }, { id: 'review', kind: 'archive', textIndices: [2], x: 760, y: 120 }, { id: 'website', kind: 'link', textIndices: [3, 4], x: 1050, y: 120 }],
    cues: [
      { actor: 0, verb: 'walk', propId: 'brief', fromX: 90, toX: 300, startFrame: 0, endFrame: 60, meaning: 'Move toward the missing project brief' },
      { actor: 0, verb: 'gather', propId: 'review', fromX: 300, toX: 600, startFrame: 65, endFrame: 135, meaning: 'Bring the scattered materials together' },
      { actor: 1, verb: 'point', propId: 'website', fromX: 1250, toX: 1250, startFrame: 140, endFrame: 225, meaning: 'Direct the viewer to the next step' },
    ],
  };
  scene.action!.subject.assetId = 'actor-one'; scene.action!.startFrame = 0; scene.action!.endFrame = 225; scene.action!.holdFrames = 15;
  await writeFile(path.join(project, 'index.html'), composeVideo(spec, { gsapPath: 'assets/gsap.min.js', fonts: FIXTURE_FONTS }));
  const env = await environment(), browser = await puppeteer.launch({ executablePath: env.HYPERFRAMES_BROWSER_PATH, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080 });
  const url = pathToFileURL(path.join(project, 'index.html')).href; await page.goto(url);
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
  return { browser, page, spec, url };
}

test('actual composed SVG performance in a Chinese spaced path has continuous joints, one scene layer and deterministic seeks', async t => {
  const f = await fixture(t);
  const result = await browserMotionQa(f.page, f.spec);
  const measured = result.samples[0] as any;
  for (const [index, sample] of measured.forward.entries()) assert.deepEqual(measured.reverse[index], sample, `Reverse sample at frame ${sample.frame}`);
  assert.deepEqual(result.checks.filter(check => check.status === 'FAIL'), []);
  for (const suffix of ['real-subject', 'continuous-joints', 'reverse-seek', 'single-scene-background', 'no-card-backplate', 'exclusive-copy']) assert.ok(result.checks.some(check => check.id.endsWith(suffix) && check.status === 'PASS'));
  const first = result.samples[0] as any; assert.equal(first.inspectedCopyFrames, 240);
  assert.ok(first.moving.every((cue: any) => cue.movingJoints.length >= 2));
  assert.match(first.contactInterpretation, /no automatic/);
  const fresh = await f.browser.newPage(); await fresh.setViewport({ width: 1920, height: 1080 }); await fresh.goto(f.url);
  await fresh.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
  const repeated = await browserMotionQa(fresh, f.spec);
  assert.deepEqual((repeated.samples[0] as any).forward, first.forward, 'Fresh timeline agrees with the previously sought page');
  await fresh.close();
  const legacyPolicyRemoved = structuredClone(f.spec); delete legacyPolicyRemoved.generatorPolicy;
  assert.equal((await browserMotionQa(f.page, legacyPolicyRemoved)).checks.filter(check => check.id.endsWith('continuous-joints')).length, 1, 'Removing generatorPolicy cannot disable performance QA');
});

test('real performance QA rejects static joints, overlapping copy, extra backgrounds and card backplates', async t => {
  const f = await fixture(t);
  const cases = [
    { css: '[data-performance-actor] [data-joint]{transform:matrix(1,0,0,1,0,0)!important}', suffix: 'continuous-joints' },
    { css: '[data-performance-copy]{opacity:1!important;visibility:visible!important}', suffix: 'exclusive-copy' },
    { css: '#explain .scene-content::before{content:""!important;display:block!important;position:absolute;inset:0;background:white}', suffix: 'no-card-backplate' },
    { css: '[data-performance-stage]::before{content:""!important;display:block!important;position:absolute;inset:0;background:white}', suffix: 'no-card-backplate' },
    { css: '[data-performance-stage]{background:rgba(255,255,255,.95)!important}', suffix: 'no-card-backplate' },
    { css: '[data-performance-actor]{visibility:hidden!important}', suffix: 'real-subject' },
    { css: '[data-joint]{opacity:0!important}', suffix: 'real-subject' },
  ];
  for (const item of cases) {
    const style = await f.page.addStyleTag({ content: item.css });
    try { assert.ok((await browserMotionQa(f.page, f.spec)).checks.some(check => check.id.endsWith(item.suffix) && check.status === 'FAIL'), `${item.suffix} must detect real DOM/CSS failure`); }
    finally { await style.evaluate(element => element.remove()); }
  }
  await f.page.evaluate(() => { const scene = document.getElementById('explain')!; const background = scene.querySelector('.scene-background')!.cloneNode(true) as Element; background.id = 'extra-background'; scene.append(background); });
  assert.ok((await browserMotionQa(f.page, f.spec)).checks.some(check => check.id.endsWith('single-scene-background') && check.status === 'FAIL'));
  await f.page.evaluate(() => { document.getElementById('extra-background')!.remove(); const card = document.createElement('div'); card.className = 'character-panel'; document.getElementById('explain')!.append(card); });
  assert.ok((await browserMotionQa(f.page, f.spec)).checks.some(check => check.id.endsWith('no-card-backplate') && check.status === 'FAIL'));
});

test('performance QA checks visible SVG kind and source identity rather than accepting any moving markup', async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => { document.querySelector<HTMLElement>('[data-performance-actor]')!.dataset.source = 'assets/unreviewed.svg'; });
  assert.ok((await browserMotionQa(f.page, f.spec)).checks.some(check => check.id.endsWith('real-subject') && check.status === 'FAIL'));
  await f.page.evaluate(() => { const actor = document.querySelector<HTMLElement>('[data-performance-actor]')!; actor.dataset.source = 'assets/角色 1.svg'; actor.querySelector<SVGSVGElement>('svg')!.dataset.rigKind = 'tuotuo'; });
  assert.ok((await browserMotionQa(f.page, f.spec)).checks.some(check => check.id.endsWith('real-subject') && check.status === 'FAIL'));
});
