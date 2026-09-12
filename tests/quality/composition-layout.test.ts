// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { before } from 'node:test';
import puppeteer from 'puppeteer-core';
import type { VideoSpec } from '../../src/contracts.ts';
import { environment } from '../../src/pipeline/tools.ts';
import { composeVideo } from '../../src/quality/composition.ts';
import { browserQa } from '../../src/qa/browser.ts';
import { ACTIVE_GENERATOR_POLICY } from '../../src/quality/policy.ts';
import { validVideoSpec } from '../fixtures/input.ts';
import { requireFixtureFont, TEST_CJK_FONT, writeBrowserAssets } from '../fixtures/browser-assets.ts';

before(requireFixtureFont);

const repo = path.resolve(import.meta.dirname, '../..');
const outputRoot = process.env.EPVS_BROWSER_TEST_REPORTS
  ? path.join(process.env.EPVS_BROWSER_TEST_REPORTS, 'composition-layout')
  : path.join(repo, 'reports/generator-quality-003/layout-repair-20260911');

function silentWav(seconds = 12, sampleRate = 48_000): Buffer {
  const dataBytes = seconds * sampleRate * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

function layoutSpec(width: 1920 | 1080, workflowPresentation = false): VideoSpec {
  const spec = structuredClone(validVideoSpec) as VideoSpec & {
    authorContacts: { name: string; items: Array<{ label: string; value: string }> };
  };
  const portrait = width === 1080;
  spec.projectId = `layout-${portrait ? 'portrait' : 'landscape'}`;
  spec.product = { ...spec.product, name: 'Layout Example', oneLiner: '验证排版，不增加产品文案', form: 'Codex Skill', prerequisites: ['本地使用'], example: undefined };
  spec.generatorPolicy = structuredClone(ACTIVE_GENERATOR_POLICY);
  spec.authorContacts = {
    name: 'Example Author',
    items: [
      { label: 'GitHub', value: 'example-project-account' },
      { label: 'X / Twitter', value: '@example_product_account' },
      { label: '网站', value: 'www.example-product.test' },
      { label: '微信', value: 'Example-Contact' },
      { label: '邮箱', value: 'author-contact@example.test' },
    ],
  };
  spec.output = { ...spec.output, width, height: portrait ? 1920 : 1080, targetDurationSec: 12 };
  spec.captions = { ...spec.captions, safeAreaPercent: 6, maxLines: 2 };
  spec.brand = { ...spec.brand, presentation: workflowPresentation ? 'workflow' : undefined, logoAssetId: 'brand-logo', colors: ['#071827', '#79A6B7', '#2CCCA8', '#F4F6F7'], fontFamilies: [TEST_CJK_FONT] };
  spec.assets = [
    { id: 'brand-logo', type: 'logo', path: 'assets/logo.svg', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null },
    { id: 'subject', type: 'image', path: 'assets/subject.svg', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null },
  ];
  const common = {
    recipe: 'feature.v1', compositionFile: 'index.html', transition: { type: 'crossfade' as const, durationSec: .35 },
    fallback: { onMissingAsset: 'use-brand-card' as const, onUnsupportedEffect: 'use-css-reveal' as const },
    assetRefs: ['subject'], voiceover: '', caption: '', motionDirection: 'stable',
  };
  spec.scenes = [
    {
      ...common, id: 'proof', goal: 'Show the real subject', plannedDurationSec: 6, actualStartSec: 0, actualEndSec: 6,
      onScreenText: ['文章最想讲清楚的一点', '同一个项目，一套品牌图片'], heroFrameSec: 2.7,
      action: { intent: 'Move the real subject into place', primitive: 'object-handoff', subject: { assetId: 'subject' }, beforeState: 'Incoming', afterState: 'Placed', startFrame: 10, endFrame: 60, holdFrames: 100 },
    },
    {
      ...common, id: 'ending', goal: 'Read the ending', plannedDurationSec: 6, actualStartSec: 6, actualEndSec: 12,
      onScreenText: [portrait ? '把解释图放回文章' : '同一个项目，一套品牌图片', ACTIVE_GENERATOR_POLICY.marketing.screenAction, ACTIVE_GENERATOR_POLICY.marketing.displayDomain], heroFrameSec: 9,
      action: { intent: 'Read stable evidence and contacts', primitive: 'reading-hold', subject: { assetId: 'subject' }, beforeState: 'Readable', afterState: 'Still readable', startFrame: 0, endFrame: 1, holdFrames: 170 },
    },
  ];
  return spec;
}

async function prepareFixture(width: 1920 | 1080, workflowPresentation = false, boundaryCaptions = false): Promise<{ directory: string; spec: VideoSpec }> {
  const directory = path.join(outputRoot, `${workflowPresentation ? 'workflow-' : ''}${width === 1920 ? 'landscape' : 'portrait'}${boundaryCaptions ? '-caption-boundary' : ''}`);
  const assets = path.join(directory, 'assets');
  await mkdir(assets, { recursive: true });
  await Promise.all([
    writeBrowserAssets(assets),
    copyFile(path.join(repo, 'node_modules/gsap/dist/gsap.min.js'), path.join(assets, 'gsap.min.js')),
  ]);
  const spec = layoutSpec(width, workflowPresentation);
  if (boundaryCaptions) {
    spec.audio.narrationMode = 'external-audio'; spec.audio.externalAudioAssetId = 'narration';
    spec.assets.push({ id: 'narration', type: 'audio', path: 'assets/silence.wav', sourceUrl: 'synthetic-test-fixture', license: 'owned', required: true, fallbackAssetId: null });
  }
  const html = composeVideo(spec, {
    gsapPath: 'assets/gsap.min.js',
    fonts: [],
    narration: { path: 'assets/silence.wav', cues: boundaryCaptions ? [
      { id: 'proof-caption', sceneId: 'proof', text: '先检查真实素材。', start: 0, end: 6 },
      { id: 'ending-caption', sceneId: 'ending', text: '在 Codex 中使用 Skill ', start: 6, end: 11 },
    ] : [
      { id: 'proof-caption', sceneId: 'proof', text: '这款文章配图助手，帮你找出文章最想讲清楚的一点。', start: 1, end: 5 },
      { id: 'ending-caption', sceneId: 'ending', text: '完整稿字幕也要保持两行以内，并且不能碰到正文与联系方式。', start: 7, end: 11 },
    ] },
  });
  await writeFile(path.join(assets, 'silence.wav'), silentWav());
  await writeFile(path.join(directory, 'index.html'), html);
  await writeFile(path.join(directory, 'video-spec.json'), `${JSON.stringify(spec, null, 2)}\n`);
  return { directory, spec };
}

test('normal composition captions keep exact Latin spaces and remain visible at crossfade starts in both seek directions', async () => {
  for (const width of [1920, 1080] as const) {
    const fixture = await prepareFixture(width, true, true);
    const checks = await browserQa(fixture.directory, fixture.spec);
    const captionChecks = checks.filter(check => check.id.startsWith('browser.narration.') || check.id.endsWith('.caption-background'));
    assert.ok(captionChecks.length > 10);
    assert.deepEqual(captionChecks.filter(check => check.status !== 'PASS'), []);
    if (width === 1920) {
      const file = path.join(fixture.directory, 'index.html'), original = await readFile(file, 'utf8');
      await writeFile(file, original.replace('</head>', '<style>#narration-caption-1{background:#000000;font-family:"Courier New";font-size:18px}.media-crop{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important}</style></head>'));
      const invalid = await browserQa(fixture.directory, fixture.spec);
      for (const id of ['browser.narration.cue-1.ui-overlap', 'browser.ending.caption-background', 'browser.ending.minimum-type', 'browser.ending.font']) {
        assert.equal(invalid.find(check => check.id === id)?.status, 'FAIL', id);
      }
      await writeFile(file, original);
    }
  }
});

test('a product signoff before a silent poster keeps its evidence above the subtitle area', async () => {
  for (const width of [1920, 1080] as const) {
    const { directory, spec } = await prepareFixture(width, true, true);
    spec.assets.push({ id: 'poster', type: 'image', path: 'assets/poster.svg', sourceUrl: 'fixture', license: 'owned', required: true, fallbackAssetId: null, width: 1500, height: 1000 });
    await writeFile(path.join(directory, 'assets/poster.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1000"><rect width="1500" height="1000" fill="white"/></svg>');
    spec.scenes.push({ ...structuredClone(spec.scenes.at(-1)!), id: 'poster-ending', authorPosterAssetId: 'poster', assetRefs: ['poster'], voiceover: '', caption: '', actualStartSec: 12, actualEndSec: 20, plannedDurationSec: 8, heroFrameSec: 16,
      action: { intent: 'Read the complete poster', primitive: 'reading-hold', subject: { assetId: 'poster' }, beforeState: 'Readable', afterState: 'Readable', startFrame: 0, endFrame: 1, holdFrames: 239 } });
    spec.output.targetDurationSec = 20;
    await writeFile(path.join(directory, 'index.html'), composeVideo(spec, { gsapPath: 'assets/gsap.min.js', fonts: [], narration: { path: 'assets/silence.wav', durationSec: 12, cues: [ { id: 'ending-caption', sceneId: 'ending', text: '在 Codex 中使用 Skill', start: 6, end: 11 } ] } }));
    const checks = await browserQa(directory, spec);
    for (const id of ['browser.ending.caption-ui-overlap', 'browser.narration.cue-0.ui-overlap']) assert.equal(checks.find(c => c.id === id)?.status, 'PASS', `${width}: ${id}`);
  }
});

test('generated landscape and portrait endings align contacts and keep copy, evidence and two-line captions separate', async () => {
  await mkdir(outputRoot, { recursive: true });
  const fixtures = await Promise.all([prepareFixture(1920), prepareFixture(1080), prepareFixture(1920, true), prepareFixture(1080, true)]);
  const env = await environment();
  const browser = await puppeteer.launch({ executablePath: env.HYPERFRAMES_BROWSER_PATH, headless: true, userDataDir: path.join(outputRoot, '.browser') });
  try {
    for (const fixture of fixtures) {
      const page = await browser.newPage();
      await page.setViewport({ width: fixture.spec.output.width, height: fixture.spec.output.height, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(path.join(fixture.directory, 'index.html')).href, { waitUntil: 'networkidle0' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => {
        const win = window as unknown as Window & { __timelines: { main: { seek(time: number): void } } };
        win.__timelines.main.seek(9);
      });
      const measured = await page.evaluate(() => {
        const box = (selector: string) => {
          const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        const baseline = (element: HTMLElement) => {
          const marker = document.createElement('i');
          Object.assign(marker.style, { display: 'inline-block', width: '0', height: '0', margin: '0', padding: '0' });
          element.prepend(marker);
          const value = marker.getBoundingClientRect().top;
          marker.remove();
          return value;
        };
        const rows = [...document.querySelectorAll<HTMLElement>('#ending .contact-block li')];
        const caption = document.querySelector<HTMLElement>('.caption[data-scene-id="ending"]')!;
        const proofCaption = document.querySelector<HTMLElement>('.caption[data-scene-id="proof"]')!;
        const heading = document.querySelector<HTMLElement>('#proof .copy-column h2')!;
        const range = document.createRange();
        range.selectNodeContents(caption);
        const lineTops = [...range.getClientRects()].filter(rect => rect.width > 1).map(rect => Math.round(rect.top));
        range.selectNodeContents(proofCaption);
        const proofCaptionLineTops = [...range.getClientRects()].filter(rect => rect.width > 1).map(rect => Math.round(rect.top));
        const headingLines = new Map<number, number>();
        const headingText = heading.firstChild!;
        for (let index = 0; index < (headingText.textContent?.length ?? 0); index++) {
          range.setStart(headingText, index); range.setEnd(headingText, index + 1);
          const rect = range.getBoundingClientRect();
          const top = Math.round(rect.top);
          headingLines.set(top, (headingLines.get(top) ?? 0) + 1);
        }
        return {
          rows: rows.map(row => {
            const label = row.querySelector<HTMLElement>('span')!;
            const value = row.querySelector<HTMLElement>('strong')!;
            return { labelX: label.getBoundingClientRect().x, valueX: value.getBoundingClientRect().x, labelBaseline: baseline(label), valueBaseline: baseline(value) };
          }),
          title: box('#ending .copy-column h2'), signoff: box('#ending .signoff'), contacts: box('#ending .contact-block'),
          copy: box('#ending .copy-column'), evidence: box('#ending .evidence-stage'), caption: box('.caption[data-scene-id="ending"]'), captionLines: new Set(lineTops).size,
          proofEvidence: box('#proof .evidence-stage'), proofCaption: box('.caption[data-scene-id="proof"]'), proofCaptionLines: new Set(proofCaptionLineTops).size,
          proofHeadingLineCharacters: [...headingLines.values()],
        };
      });
      await page.screenshot({ path: path.join(fixture.directory, 'frame-9.png') });
      await writeFile(path.join(fixture.directory, 'layout-measurements.json'), `${JSON.stringify(measured, null, 2)}\n`);

      const valueStarts = measured.rows.map(row => row.valueX);
      const intersects = (a: typeof measured.copy, b: typeof measured.copy) => a.left < b.right - .5 && a.right > b.left + .5 && a.top < b.bottom - .5 && a.bottom > b.top + .5;
      assert.ok(Math.max(...valueStarts) - Math.min(...valueStarts) <= .5, `${fixture.spec.projectId}: contact values are not one column`);
      assert.ok(measured.rows.every(row => Math.abs(row.labelBaseline - row.valueBaseline) <= 1), `${fixture.spec.projectId}: mixed-script baselines differ`);
      assert.ok(Math.abs(measured.title.left - measured.signoff.left) <= .5, `${fixture.spec.projectId}: title and signoff columns differ`);
      assert.ok(!intersects(measured.title, measured.evidence), `${fixture.spec.projectId}: title intersects evidence`);
      assert.ok(!intersects(measured.signoff, measured.evidence), `${fixture.spec.projectId}: signoff intersects evidence`);
      assert.ok(!intersects(measured.contacts, measured.caption), `${fixture.spec.projectId}: contacts intersect caption`);
      assert.ok(!intersects(measured.evidence, measured.caption), `${fixture.spec.projectId}: evidence intersects caption`);
      assert.ok(measured.captionLines <= 2, `${fixture.spec.projectId}: caption exceeds two lines`);
      assert.ok(measured.evidence.width > 1 && measured.evidence.height > 1, `${fixture.spec.projectId}: evidence has no remaining stage`);
      if (fixture.spec.output.width === 1920 && fixture.spec.brand.presentation === 'workflow') {
        assert.ok(measured.evidence.width >= 280 && measured.evidence.height >= 150, `${fixture.spec.projectId}: workflow ending evidence is only a postage-stamp strip`);
      }
      assert.ok(!intersects(measured.proofEvidence, measured.proofCaption), `${fixture.spec.projectId}: non-ending evidence intersects caption`);
      assert.ok(measured.proofCaptionLines <= 2, `${fixture.spec.projectId}: non-ending caption exceeds two lines`);
      if (fixture.spec.output.width === 1920 && fixture.spec.brand.presentation !== 'workflow') assert.equal(measured.proofHeadingLineCharacters.length, 2, 'legacy landscape representative title should use two lines');
      assert.ok(measured.proofHeadingLineCharacters.every(count => count >= 2), `${fixture.spec.projectId}: representative title leaves an orphan character`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('whole author posters fill both canvases with an uncropped image and remain caption-free on forward and reverse seeks', async () => {
  const env = await environment();
  const browser = await puppeteer.launch({ executablePath: env.HYPERFRAMES_BROWSER_PATH, headless: true });
  try {
    for (const width of [1920, 1080] as const) {
      const spec = layoutSpec(width, true);
      const directory = path.join(outputRoot, `author-poster-${width}`);
      await mkdir(path.join(directory, 'assets'), { recursive: true });
      await copyFile(path.join(repo, 'node_modules/gsap/dist/gsap.min.js'), path.join(directory, 'assets/gsap.min.js'));
      await writeBrowserAssets(path.join(directory, 'assets'));
      await writeFile(path.join(directory, 'assets/poster.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1000" viewBox="0 0 1500 1000"><rect width="1500" height="1000" fill="#79A6B7"/><rect x="10" y="10" width="1480" height="980" fill="none" stroke="#F4F6F7" stroke-width="20"/><text x="750" y="500" text-anchor="middle" font-size="100">WHOLE AUTHOR POSTER</text><text x="30" y="940" font-size="60">Contact at the image edge</text></svg>');
      await writeFile(path.join(directory, 'assets/silence.wav'), silentWav());
      spec.assets[1] = { ...spec.assets[1]!, path: 'assets/poster.svg', width: 1500, height: 1000 };
      spec.scenes[1]!.authorPosterAssetId = 'subject';
      const output = composeVideo(spec, { gsapPath: 'assets/gsap.min.js', fonts: [], narration: { path: 'assets/silence.wav', cues: [{ sceneId: 'proof', text: 'Caption ends before the poster.', start: 0, end: 6 }] } });
      await writeFile(path.join(directory, 'index.html'), output);
      const page = await browser.newPage();
      await page.setViewport({ width, height: spec.output.height, deviceScaleFactor: 1 });
      const failures: string[] = [];
      page.on('pageerror', error => failures.push(String(error)));
      page.on('requestfailed', request => {
        // Chrome may cancel a file media read after buffering it; media readiness is asserted below.
        if (request.resourceType() !== 'media' || request.failure()?.errorText !== 'net::ERR_ABORTED') failures.push(request.url());
      });
      await page.goto(pathToFileURL(path.join(directory, 'index.html')).href, { waitUntil: 'networkidle0' });
      assert.deepEqual(await page.evaluate(() => {
        const audio = document.querySelector('audio')!;
        return { ready: audio.readyState >= 2, error: audio.error?.message ?? null, duration: audio.duration };
      }), { ready: true, error: null, duration: 12 });
      const states = [];
      for (const time of [5, 6, 6.5, 9, 11.9, 9, 5, 9]) {
        const state = await page.evaluate(time => {
          const win = window as unknown as Window & { __timelines: { main: { seek(time: number): void } } };
          win.__timelines.main.seek(time);
          const scene = document.getElementById('ending')!;
          const image = scene.querySelector<HTMLImageElement>('.author-poster-image');
          const background = scene.querySelector<HTMLImageElement>('.author-poster-background');
          const measure = (element: HTMLImageElement | null) => {
            if (!element) return null;
            const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, fit: style.objectFit, filter: style.filter, transform: style.transform, source: element.currentSrc, loaded: element.complete && element.naturalWidth === 1500 && element.naturalHeight === 1000 };
          };
          return {
            time, opacity: Number(getComputedStyle(scene).opacity), image: measure(image), background: measure(background), text: scene.innerText,
            captionCount: [...document.querySelectorAll('.caption')].filter(element => Number(getComputedStyle(element).opacity) > 0 && getComputedStyle(element).visibility !== 'hidden').length,
          };
        }, time);
        states.push(state);
        assert.ok(state.image && state.background, 'poster must render the whole source image and its background');
        assert.ok(state.image.loaded && state.background.loaded);
        assert.equal(state.image.source, state.background.source);
        assert.equal(state.image.fit, 'contain');
        assert.equal(state.image.transform, 'none');
        assert.deepEqual([state.image.left, state.image.top, state.image.width, state.image.height], [0, 0, width, spec.output.height]);
        assert.equal(state.background.fit, 'cover');
        assert.match(state.background.filter, /blur\(/);
        assert.ok(state.background.left <= 0 && state.background.top <= 0 && state.background.width >= width && state.background.height >= spec.output.height);
        assert.equal(state.text, '', 'poster cannot reintroduce old contact, logo or heading copy');
        assert.equal(state.captionCount, time < 6 ? 1 : 0);
        assert.equal(state.opacity, time <= 6 ? 0 : 1);
      }
      assert.deepEqual(states[3], states[5]);
      assert.deepEqual(states[3], states[7]);
      assert.deepEqual(states[0], states[6]);
      assert.deepEqual(failures, []);
      await page.screenshot({ path: path.join(directory, 'frame-9.png') });
      await writeFile(path.join(directory, 'layout-measurements.json'), `${JSON.stringify(states, null, 2)}\n`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
