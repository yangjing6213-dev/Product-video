// SPDX-License-Identifier: Apache-2.0
import type { Page } from 'puppeteer-core';
import type { CheckResult, VideoSpec } from '../contracts.ts';

/** Observe real asset elements across the authored action; labels and animation counts cannot satisfy it. */
export async function browserMotionQa(page: Page, spec: VideoSpec): Promise<{ checks: CheckResult[]; samples: unknown[] }> {
  const checks: CheckResult[] = [], samples: unknown[] = [];
  if (!spec.generatorPolicy) return { checks, samples };
  for (const scene of spec.scenes) {
    const action = scene.action;
    if (!action) { checks.push({ id: `motion.${scene.id}.action`, status: 'FAIL', message: 'Structured subject action missing' }); continue; }
    const assetIds = action.primitive === 'layer-assemble'
      ? (spec.assets.find(asset => asset.id === action.subject.assetId)?.layers ?? []).filter(layer => action.subject.layerIds?.includes(layer.id)).map(layer => layer.assetId)
      : action.relatedAssetIds ?? [action.subject.assetId];
    const read = async (frame: number) => page.evaluate(({ sceneId, ids, time }) => {
      const win = window as Window & { __timelines?: Record<string, { seek(time: number): void }> };
      if (!win.__timelines?.main) return null;
      for (const item of document.querySelectorAll<HTMLElement>('.scene')) item.style.display = '';
      win.__timelines.main.seek(time);
      const scope = document.getElementById(sceneId);
      if (!scope) return null;
      return ids.map(id => {
        const element = [...scope.querySelectorAll<HTMLElement>('[data-asset-id]')].find(item => item.dataset.assetId === id);
        if (!element || !(element instanceof HTMLImageElement || element instanceof HTMLVideoElement)) return null;
        const style = getComputedStyle(element), box = element.getBoundingClientRect();
        let opacity = 1, visible = true;
        const region = { left: Math.max(0, box.left), top: Math.max(0, box.top), right: Math.min(innerWidth, box.right), bottom: Math.min(innerHeight, box.bottom) };
        for (let current: HTMLElement | null = element; current; current = current.parentElement) {
          const currentStyle = getComputedStyle(current);
          opacity *= Number(currentStyle.opacity);
          visible &&= currentStyle.display !== 'none' && currentStyle.visibility !== 'hidden' && currentStyle.visibility !== 'collapse';
          if (current !== element && /hidden|clip|scroll|auto/.test(`${currentStyle.overflowX} ${currentStyle.overflowY}`)) {
            const clip = current.getBoundingClientRect();
            region.left = Math.max(region.left, clip.left); region.right = Math.min(region.right, clip.right);
            region.top = Math.max(region.top, clip.top); region.bottom = Math.min(region.bottom, clip.bottom);
          }
        }
        visible &&= opacity > 0.02 && region.right > region.left + 1 && region.bottom > region.top + 1;
        return { id, src: element.getAttribute('src'), loaded: element instanceof HTMLImageElement ? element.complete && element.naturalWidth > 0 : element.readyState >= 1,
          visible,
          transform: style.transform, clipPath: style.clipPath, opacity: style.opacity, visibility: style.visibility,
          x: Math.round(box.x * 100) / 100, y: Math.round(box.y * 100) / 100, width: Math.round(box.width * 100) / 100, height: Math.round(box.height * 100) / 100 };
      });
    }, { sceneId: scene.id, ids: assetIds, time: (scene.actualStartSec ?? 0) + frame / spec.output.fps });
    const hold = action.primitive === 'reading-hold';
    const holdStart = Math.max(action.endFrame, Math.ceil(scene.transition.durationSec * spec.output.fps)) + 0.01;
    const holdEnd = action.endFrame + action.holdFrames - 0.01;
    const firstFrame = hold ? Math.min(holdStart, holdEnd) : action.startFrame + 0.01;
    const before = await read(firstFrame), middle = await read(hold ? (firstFrame + holdEnd) / 2 : (action.startFrame + action.endFrame) / 2), after = await read(hold ? holdEnd : action.endFrame + Math.min(action.holdFrames, 1));
    const reverse = await read(firstFrame);
    const real = Boolean(before?.length && [before, middle, after, reverse].every(rows => rows?.every(row => row?.loaded && row.width > 0 && row.height > 0 && spec.assets.some(asset => asset.id === row.id && asset.path === row.src)))
      && assetIds.every(id => hold ? [middle, after].every(rows => rows?.some(row => row?.id === id && row.visible))
        : [before, middle, after].some(rows => rows?.some(row => row?.id === id && row.visible))));
    // A scene entrance changes ancestor visibility without moving a held subject.
    const subjectState = (rows: typeof before) => rows?.map(row => row && { id: row.id, opacity: row.opacity, transform: row.transform, clipPath: row.clipPath, x: row.x, y: row.y, width: row.width, height: row.height });
    const changed = JSON.stringify(subjectState(before)) !== JSON.stringify(subjectState(after));
    const deterministic = JSON.stringify(before) === JSON.stringify(reverse);
    samples.push({ sceneId: scene.id, primitive: action.primitive, before, middle, after, reverse });
    checks.push({ id: `motion.${scene.id}.real-subject`, status: real ? 'PASS' : 'FAIL', message: 'Action targets loaded declared image/video assets that become visible inside the viewport and their clipping ancestors; this finite check does not prove aesthetic quality or arbitrary occlusion.' });
    checks.push({ id: `motion.${scene.id}.observed-state`, status: real && (action.primitive === 'reading-hold' ? !changed : changed) ? 'PASS' : 'FAIL', message: action.primitive === 'reading-hold' ? 'Declared reading hold retains stable subject geometry; reading purpose still needs review.' : 'The declared subject changes visibly across the action; this technical observation is not a quality score.' });
    checks.push({ id: `motion.${scene.id}.reverse-seek`, status: real && deterministic ? 'PASS' : 'FAIL', message: 'Reverse seeking restores the exact measured asset state.' });
  }
  return { checks, samples };
}
