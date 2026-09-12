// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { before } from 'node:test';
import puppeteer from 'puppeteer-core';
import type { VideoSpec } from '../../src/contracts.ts';
import { environment } from '../../src/pipeline/tools.ts';
import { composeVideo } from '../../src/quality/composition.ts';
import { workflowText, type SceneWorkflow, type WorkflowLayout } from '../../src/quality/workflow.ts';
import { validVideoSpec } from '../fixtures/input.ts';
import { requireFixtureFont, TEST_CJK_FONT, writeBrowserAssets } from '../fixtures/browser-assets.ts';

before(requireFixtureFont);

const repo = path.resolve(import.meta.dirname, '../..');
const outputRoot = process.env.EPVS_BROWSER_TEST_REPORTS
  ? path.join(process.env.EPVS_BROWSER_TEST_REPORTS, 'workflow-browser')
  : path.join(repo, 'reports/presenter-flow-upgrade-20260911/components');

const layouts: Array<{ layout: WorkflowLayout; width: 1920 | 1080 }> = [
  { layout: 'horizontal-3', width: 1920 },
  { layout: 'vertical-3', width: 1080 },
  { layout: 'feature-row-4', width: 1920 },
];

function workflow(layout: WorkflowLayout): SceneWorkflow {
  const ids = layout === 'feature-row-4'
    ? ['cover-preview', 'social-preview', 'logo-preview', 'title-preview']
    : ['cover-preview', 'social-preview', 'logo-preview'];
  return {
    layout,
    cards: ids.map((previewAssetId, index) => ({
      id: `step-${index + 1}`,
      previewAssetId,
      title: `步骤${index + 1}`,
      sentence: `第${index + 1}张真实素材进入流程`,
      fields: [{ label: '来源', value: `本地素材${index + 1}` }],
      focusFrame: layout === 'feature-row-4' ? 20 + index * 60 : 20 + index * 70,
      completeFrame: layout === 'feature-row-4' ? 60 + index * 60 : 70 + index * 70,
    })),
  };
}

function specFor(layout: WorkflowLayout, width: 1920 | 1080): VideoSpec {
  const spec = structuredClone(validVideoSpec);
  const stage = workflow(layout);
  const portrait = width === 1080;
  spec.projectId = `workflow-${layout}`;
  spec.product = { ...spec.product, name: 'Workflow Fixture', example: undefined };
  spec.brand = {
    ...spec.brand,
    presentation: 'workflow',
    logoAssetId: 'brand-logo',
    colors: ['#071827', '#F4F6F7', '#2F7DFF', '#F2C84B'],
    fontFamilies: [TEST_CJK_FONT],
  };
  spec.output = { ...spec.output, width, height: portrait ? 1920 : 1080, targetDurationSec: 12 };
  spec.assets = [
    { id: 'brand-logo', type: 'logo', path: 'assets/logo.svg', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null },
    { id: 'background', type: 'image', path: 'assets/background.svg', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null },
    { id: 'cover-preview', type: 'image', path: 'assets/cover.svg', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null },
    { id: 'social-preview', type: 'screenshot', path: 'assets/social.svg', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null },
    { id: 'logo-preview', type: 'logo', path: 'assets/logo.svg', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null },
    { id: 'title-preview', type: 'image', path: 'assets/title.svg', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null },
  ];
  spec.scenes = [{
    ...spec.scenes[0]!, id: 'workflow', goal: 'Exercise the reusable workflow stage',
    plannedDurationSec: 12, actualStartSec: 0, actualEndSec: 12, heroFrameSec: 4,
    backgroundAssetId: 'background', workflow: stage,
    onScreenText: ['真实产品流程舞台', '真实素材、字段与连接路径同步推进', ...workflowText(stage)],
    assetRefs: ['background', ...stage.cards.map(card => card.previewAssetId)],
    action: {
      intent: 'Advance real product evidence through the workflow cards', primitive: 'workflow-progress',
      subject: { assetId: stage.cards[0]!.previewAssetId }, relatedAssetIds: stage.cards.map(card => card.previewAssetId),
      beforeState: 'All cards are ordinary', afterState: 'All cards are complete',
      startFrame: 10, endFrame: 270, holdFrames: 90,
    },
  }];
  return spec;
}

async function prepare(layout: WorkflowLayout, width: 1920 | 1080) {
  const directory = path.join(outputRoot, layout);
  const assets = path.join(directory, 'assets');
  await mkdir(assets, { recursive: true });
  await Promise.all([
    writeBrowserAssets(assets),
    copyFile(path.join(repo, 'node_modules/gsap/dist/gsap.min.js'), path.join(assets, 'gsap.min.js')),
  ]);
  const spec = specFor(layout, width);
  const html = composeVideo(spec, {
    gsapPath: 'assets/gsap.min.js',
    fonts: [],
  });
  await writeFile(path.join(directory, 'index.html'), html);
  await writeFile(path.join(directory, 'video-spec.json'), `${JSON.stringify(spec, null, 2)}\n`);
  return { directory, spec, workflow: spec.scenes[0]!.workflow! };
}

test('all three workflow layouts keep real cards in bounds and reverse card, preview and connector state together', async () => {
  const fixtures = await Promise.all(layouts.map(({ layout, width }) => prepare(layout, width)));
  const env = await environment();
  const browser = await puppeteer.launch({ executablePath: env.HYPERFRAMES_BROWSER_PATH, headless: true, userDataDir: path.join(outputRoot, '.browser') });
  try {
    for (const fixture of fixtures) {
      const page = await browser.newPage();
      await page.setViewport({ width: fixture.spec.output.width, height: fixture.spec.output.height, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(path.join(fixture.directory, 'index.html')).href, { waitUntil: 'networkidle0' });
      await page.evaluate(() => document.fonts.ready);

      const sample = async (seconds: number) => page.evaluate((time) => {
        const win = window as unknown as Window & { __timelines: { main: { seek(value: number): void } } };
        win.__timelines.main.seek(time);
        const cards = [...document.querySelectorAll<HTMLElement>('[data-workflow-card-id]')];
        const rect = (element: Element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
        };
        return {
          states: cards.map(card => card.dataset.state),
          cardOpacities: cards.map(card => Number.parseFloat(getComputedStyle(card).opacity)),
          cardBackgrounds: cards.map(card => getComputedStyle(card).backgroundColor),
          cardBorders: cards.map(card => ({ width: getComputedStyle(card).borderTopWidth, color: getComputedStyle(card).borderTopColor })),
          cardTransforms: cards.map(card => getComputedStyle(card).transform),
          copyOpacities: cards.map(card => Number.parseFloat(getComputedStyle(card.querySelector('.workflow-card-copy')!).opacity)),
          previewOpacities: cards.map(card => Number.parseFloat(getComputedStyle(card.querySelector('[data-asset-id]')!).opacity)),
          previewBackgrounds: cards.map(card => getComputedStyle(card.querySelector('.workflow-preview')!).backgroundColor),
          previewBorders: cards.map(card => getComputedStyle(card.querySelector('.workflow-preview')!).borderBottomColor),
          previewSlots: cards.map(card => rect(card.querySelector('.workflow-preview')!)),
          titleSlots: cards.map(card => rect(card.querySelector('.workflow-card-title')!)),
          sentenceSlots: cards.map(card => rect(card.querySelector('.workflow-card-sentence')!)),
          previewContainment: cards.map(card => {
            const parent = rect(card.querySelector('.workflow-preview')!);
            const child = rect(card.querySelector('.workflow-preview .evidence-frame')!);
            return { parent, child };
          }),
          titleStyles: cards.map(card => {
            const style = getComputedStyle(card.querySelector('.workflow-card-title')!);
            return { color: style.color, family: style.fontFamily, weight: Number.parseInt(style.fontWeight, 10) };
          }),
          bodyFamily: getComputedStyle(document.body).fontFamily,
          workflowTextFits: [...document.querySelectorAll<HTMLElement>('.workflow-card-title,.workflow-card-sentence')]
            .every(element => element.scrollWidth <= element.clientWidth + 2 && element.scrollHeight <= element.clientHeight + 2),
          introTitleSize: Number.parseFloat(getComputedStyle(document.querySelector('.workflow-intro h2')!).fontSize),
          connectorFill: getComputedStyle(document.querySelector('.workflow-connectors')!).fill,
          cards: cards.map(rect),
          previews: cards.map(card => ({ id: card.querySelector<HTMLElement>('[data-asset-id]')?.dataset.assetId, box: rect(card.querySelector('[data-asset-id]')!) })),
          connectorOffsets: [...document.querySelectorAll<SVGPathElement>('[data-workflow-connector-index]')].map(path => Number.parseFloat(getComputedStyle(path).strokeDashoffset)),
          connectorStyles: [...document.querySelectorAll<SVGPathElement>('[data-workflow-connector-index]')].map(path => path.getAttribute('style')),
          stage: rect(document.querySelector('.workflow-stage')!),
          backgroundCount: document.querySelectorAll('[data-background-asset-id="background"]').length,
          backgroundInsideCard: document.querySelectorAll('[data-workflow-card-id] [data-asset-id="background"]').length,
        };
      }, seconds);

      const second = fixture.workflow.cards[1]!;
      const focus = await sample((second.focusFrame + second.completeFrame) / 60);
      assert.equal(focus.states[0], 'complete');
      assert.equal(focus.states[1], 'focus');
      assert.ok(focus.states.slice(2).every(state => state === 'ordinary'));
      assert.ok(focus.connectorOffsets[0]! > 0 && focus.connectorOffsets[0]! < 1, `${fixture.workflow.layout}: connector does not advance with focus (${focus.connectorOffsets.join(',')}; ${focus.connectorStyles.join(',')})`);
      assert.equal(focus.backgroundCount, 1);
      assert.equal(focus.backgroundInsideCard, 0);
      assert.ok(focus.cardOpacities.every(opacity => opacity === 1), `${fixture.workflow.layout}: connector can bleed through a translucent card`);
      assert.ok(focus.cardBackgrounds.every(color => color === 'rgb(244, 246, 247)'), `${fixture.workflow.layout}: cards must use the declared light foreground surface`);
      assert.ok(focus.previewBackgrounds.every(color => color === 'rgb(7, 24, 39)'), `${fixture.workflow.layout}: real previews must sit on the declared dark display layer`);
      assert.ok(focus.cardBorders.every(border => border.width === '1px'), `${fixture.workflow.layout}: ordinary card outline is too heavy`);
      assert.equal(focus.titleStyles[2]!.family, focus.bodyFamily, `${fixture.workflow.layout}: card titles must use the standard body face`);
      assert.ok(focus.titleStyles.every(style => style.weight >= 700), `${fixture.workflow.layout}: card titles must be bold`);
      assert.ok(focus.copyOpacities[1]! > focus.copyOpacities[2]!, `${fixture.workflow.layout}: focus must emphasize local card copy`);
      assert.ok(focus.previewOpacities[1]! > focus.previewOpacities[2]!, `${fixture.workflow.layout}: focus must emphasize the real preview`);
      assert.notEqual(focus.previewBorders[1], focus.previewBorders[2], `${fixture.workflow.layout}: focus needs a local preview highlight`);
      assert.notEqual(focus.titleStyles[0]!.color, focus.titleStyles[2]!.color, `${fixture.workflow.layout}: completed title needs a visible text emphasis`);
      assert.notEqual(focus.cardTransforms[1], focus.cardTransforms[2], `${fixture.workflow.layout}: focus card must lift from the ordinary plane`);
      assert.equal(focus.workflowTextFits, true, `${fixture.workflow.layout}: card text overflows its measured line box`);
      assert.ok(focus.introTitleSize >= 78, `${fixture.workflow.layout}: workflow title is too small for the compact player`);
      assert.equal(focus.connectorFill, 'none', `${fixture.workflow.layout}: connector SVG inherits an undeclared default fill`);
      assert.ok(focus.previewContainment.every(({ parent, child }) => child.left >= parent.left - 2 && child.top >= parent.top - 2 && child.right <= parent.right + 2 && child.bottom <= parent.bottom + 2), `${fixture.workflow.layout}: real preview exceeds its clipping stage`);
      assert.ok(focus.cards.every(card => card.left >= 0 && card.top >= 0 && card.right <= fixture.spec.output.width && card.bottom <= fixture.spec.output.height));
      assert.ok(focus.previews.every(preview => preview.id && preview.box.width > 1 && preview.box.height > 1));

      const complete = await sample(9);
      assert.ok(complete.states.every(state => state === 'complete'));
      assert.ok(complete.connectorOffsets.every(offset => Math.abs(offset) < .01));
      if (fixture.workflow.layout !== 'vertical-3') {
        const previewHeights = complete.previewSlots.map(slot => slot.height);
        const titleTops = complete.titleSlots.map(slot => slot.top);
        const sentenceTops = complete.sentenceSlots.map(slot => slot.top);
        assert.ok(Math.max(...previewHeights) - Math.min(...previewHeights) <= 1, `${fixture.workflow.layout}: preview slots are not equal height`);
        assert.ok(Math.min(...previewHeights) >= 170, `${fixture.workflow.layout}: preview slots are too small to show real evidence`);
        assert.ok(Math.max(...titleTops) - Math.min(...titleTops) <= 1, `${fixture.workflow.layout}: card title baselines are not aligned`);
        assert.ok(Math.max(...sentenceTops) - Math.min(...sentenceTops) <= 1, `${fixture.workflow.layout}: card sentence slots are not aligned`);
      }

      const first = fixture.workflow.cards[0]!;
      const reversed = await sample((first.focusFrame + first.completeFrame) / 60);
      assert.equal(reversed.states[0], 'focus');
      assert.ok(reversed.states.slice(1).every(state => state === 'ordinary'));
      assert.ok(reversed.connectorOffsets.every(offset => Math.abs(offset - 1) < .01));

      if (fixture.workflow.layout === 'vertical-3') {
        assert.ok(focus.cards[0]!.top < focus.cards[1]!.top && focus.cards[1]!.top < focus.cards[2]!.top);
      } else {
        const firstCenter = focus.cards[0]!.top + focus.cards[0]!.height / 2;
        assert.ok(focus.cards.every(card => Math.abs(card.top + card.height / 2 - firstCenter) < 1));
      }
      await page.screenshot({ path: path.join(fixture.directory, 'focus-state.png') });
      await writeFile(path.join(fixture.directory, 'measurements.json'), `${JSON.stringify({ focus, complete, reversed }, null, 2)}\n`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
