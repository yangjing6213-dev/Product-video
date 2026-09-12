// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { environment } from '../../src/pipeline/tools.ts';

export const TEST_CJK_FONT = process.env.EPVS_TEST_CJK_FONT
  ?? (process.platform === 'win32' ? 'Microsoft YaHei' : process.platform === 'darwin' ? 'PingFang SC' : 'Noto Sans CJK SC');

export async function requireFixtureFont(): Promise<void> {
  const env = await environment();
  assert.ok(env.HYPERFRAMES_BROWSER_PATH, 'Set HYPERFRAMES_BROWSER_PATH to an installed Chrome executable for the browser tests.');
  const browser = await puppeteer.launch({ executablePath: env.HYPERFRAMES_BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<span id="font-probe">中文排版测试</span>');
    await page.evaluate(family => {
      document.getElementById('font-probe')!.style.fontFamily = JSON.stringify(family);
    }, TEST_CJK_FONT);
    await page.evaluate(() => document.fonts.ready);
    const cdp = await page.createCDPSession();
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#font-probe' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert.ok(fonts.some(font => font.glyphCount > 0 && font.familyName.toLowerCase() === TEST_CJK_FONT.toLowerCase()),
      `Chinese test font "${TEST_CJK_FONT}" is unavailable. Install a licensed system CJK font (for example Noto Sans CJK SC), then set EPVS_TEST_CJK_FONT to its family name. Tests do not skip or accept fallback fonts.`);
  } finally { await browser.close(); }
}

// Original test-only documents: visible content and differing image ratios without private brands or files.
export async function writeBrowserAssets(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const document = (heading: string, detail: string, width = 1600, height = 900) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#F4F6F7"/><rect x="48" y="48" width="${width - 96}" height="12" fill="#2F7DFF"/><text x="64" y="150" font-family="sans-serif" font-size="64" font-weight="700" fill="#071827">${heading}</text><text x="64" y="235" font-family="sans-serif" font-size="32" fill="#071827">${detail}</text><text x="64" y="${height - 65}" font-family="sans-serif" font-size="28" fill="#071827">Local project / Review 01 / Source retained</text></svg>`;
  const assets = {
    'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140" viewBox="0 0 480 140"><text x="12" y="100" font-family="sans-serif" font-weight="700" font-size="80" fill="#F4F6F7">FIELDNOTE</text></svg>',
    // Preserve the wide evidence ratio exercised by the existing subtitle-boundary regression.
    'subject.svg': document('Project brief', 'Purpose: share research notes. Status: ready for review.', 2048, 682),
    'cover.svg': document('Fieldnote', 'A shared place for research notes and project decisions.'),
    'social.svg': document('Research, ready to share', 'One project. Consistent title, type and source.', 1200, 630),
    'title.svg': document('Fieldnote / Research journal', 'Cover title approved', 1200, 340),
    'background.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#071827"/><rect x="900" y="100" width="620" height="640" fill="#193E53"/><path d="M1200 100V740M900 420H1520" stroke="#79A6B7" stroke-width="8"/><rect x="180" y="700" width="1300" height="70" fill="#254B5D"/><text x="200" y="830" font-family="sans-serif" font-size="30" fill="#F4F6F7">Independent local workspace / Synthetic test scene</text></svg>',
  };
  await Promise.all(Object.entries(assets).map(([name, svg]) => writeFile(path.join(directory, name), svg)));
}
