// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import puppeteer from 'puppeteer-core';
import { environment } from '../../src/pipeline/tools.ts';
import { compileWorkflowProgress, type SceneWorkflow, type WorkflowLayout } from '../../src/quality/workflow.ts';

test('editorial-v2 reveals real CSS clip regions continuously and restores intermediate frames after reverse seeking', async () => {
  const env = await environment();
  const browser = await puppeteer.launch({ executablePath: env.HYPERFRAMES_BROWSER_PATH, headless: true });
  try {
    for (const layout of ['horizontal-3', 'vertical-3', 'feature-row-4'] as WorkflowLayout[]) {
      const workflow: SceneWorkflow = {
        layout,
        cards: Array.from({ length: layout === 'feature-row-4' ? 4 : 3 }, (_, index) => ({
          id: `card-${index}`, previewAssetId: `preview-${index}`, title: 'Approved title', sentence: 'Approved sentence',
          fields: [{ label: 'Source', value: 'Synthetic test fixture' }], focusFrame: 30 + index * 60, completeFrame: 60 + index * 60,
        })),
      };
      const page = await browser.newPage();
      // Synthetic image and text exercise the production compiler without private brand assets.
      const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>')}`;
      await page.setContent(`<section id="workflow">${workflow.cards.map(card => `<article data-workflow-card-id="${card.id}" style="opacity:0;visibility:hidden"><img data-asset-id="${card.previewAssetId}" src="${image}"><div class="workflow-card-copy">Approved text</div></article>`).join('')}<svg>${workflow.cards.slice(1).map((_, index) => `<path data-workflow-connector-index="${index}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" d="M0 0L100 0"/>`).join('')}</svg></section>`);
      await page.addScriptTag({ path: path.resolve('node_modules/gsap/dist/gsap.min.js') });
      await page.evaluate(code => {
        const win = window as unknown as Window & { gsap: { timeline(options: { paused: boolean }): unknown }; auditTimeline?: unknown };
        win.auditTimeline = win.gsap.timeline({ paused: true });
        new Function('tl', code)(win.auditTimeline);
      }, compileWorkflowProgress(workflow, { sceneId: 'workflow', sceneStartFrame: 0, fps: 30, visualStyle: 'editorial-v2' }));
      const sample = (seconds: number) => page.evaluate(time => {
        const win = window as unknown as Window & { auditTimeline: { seek(time: number): void } };
        win.auditTimeline.seek(time);
        return {
          states: [...document.querySelectorAll<HTMLElement>('[data-workflow-card-id]')].map(element => element.dataset.state),
          clips: [...document.querySelectorAll<HTMLElement>('[data-asset-id]')].map(element => getComputedStyle(element).clipPath),
          connectors: [...document.querySelectorAll('[data-workflow-connector-index]')].map(element => Number(element.getAttribute('stroke-dashoffset'))),
        };
      }, seconds);
      const start = await sample(3), early = await sample(3.08), middle = await sample(3.16), end = await sample(3.4);
      const inset = (value: string) => Number(value.match(/[\d.]+%/g)?.[layout === 'vertical-3' ? 2 : 1]?.replace('%', '') ?? 0);
      assert.ok(inset(early.clips[1]!) < inset(start.clips[1]!) && inset(early.clips[1]!) > 0, `${layout}: reveal must move before the final frame`);
      assert.ok(inset(middle.clips[1]!) < inset(early.clips[1]!) && inset(middle.clips[1]!) > 0, `${layout}: reveal must progress continuously`);
      assert.equal(inset(end.clips[1]!), 0);
      assert.ok(middle.connectors[0]! > 0 && middle.connectors[0]! < 1);
      assert.deepEqual(middle.states.slice(0, 3), ['complete', 'focus', 'ordinary']);
      await sample(9);
      assert.deepEqual(await sample(3.16), middle, `${layout}: returning from the complete state must restore the same intermediate clip and connector`);
      assert.deepEqual(await sample(3), start, `${layout}: returning to the focus boundary must restore its initial mask`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
