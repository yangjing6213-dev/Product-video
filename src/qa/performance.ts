// SPDX-License-Identifier: Apache-2.0
import type { Page } from 'puppeteer-core';
import type { CheckResult, VideoSpec } from '../contracts.ts';

/** Observe actual SVG joints and every rendered copy frame; this is not an acting-quality score. */
export async function browserPerformanceQa(page: Page, spec: VideoSpec): Promise<{ checks: CheckResult[]; samples: unknown[] }> {
  const checks: CheckResult[] = [], samples: unknown[] = [];
  for (const scene of spec.scenes.filter(scene => scene.character?.performance)) {
    const performance = scene.character!.performance!, start = scene.actualStartSec ?? 0;
    const durationFrames = Math.round(((scene.actualEndSec ?? start + scene.plannedDurationSec) - start) * spec.output.fps);
    const anchors = new Set<number>([0, Math.max(0, durationFrames - 1)]);
    for (const cue of performance.cues) for (const fraction of [0, .1, .2, .35, .5, .65, .8, .95, 1]) {
      anchors.add(Math.max(0, Math.min(durationFrames - .01, Number((cue.startFrame + (cue.endFrame - cue.startFrame) * fraction).toFixed(5)))));
    }
    const frames = [...anchors].sort((a, b) => a - b);
    const result = await page.evaluate(async ({ sceneId, start, fps, durationFrames, frames, actors, background }) => {
      const timeline = (window as unknown as { __timelines?: { main?: { seek(time: number, suppressEvents?: boolean): void } } }).__timelines?.main;
      const scope = document.getElementById(sceneId);
      if (!timeline || !scope) return null;
      for (const element of document.querySelectorAll<HTMLElement>('.scene')) element.style.display = '';
      const round = (value: number): number => Math.round(value * 10000) / 10000;
      const transform = (element: Element): string => {
        const computed = getComputedStyle(element).transform;
        // An unset transform and its identity matrix have exactly the same geometry.
        return computed === 'none' ? 'matrix(1, 0, 0, 1, 0, 0)' : computed;
      };
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
      };
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const region = { left: Math.max(0, rect.left), right: Math.min(innerWidth, rect.right), top: Math.max(0, rect.top), bottom: Math.min(innerHeight, rect.bottom) };
        let alpha = 1;
        if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
        for (let parent: Element | null = element; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent); alpha *= Number(css.opacity);
          if (css.display === 'none' || css.visibility !== 'visible') return false;
          if (parent !== element && /hidden|clip|scroll|auto/.test(`${css.overflowX} ${css.overflowY}`)) {
            const clip = parent.getBoundingClientRect();
            region.left = Math.max(region.left, clip.left); region.right = Math.min(region.right, clip.right);
            region.top = Math.max(region.top, clip.top); region.bottom = Math.min(region.bottom, clip.bottom);
          }
        }
        return alpha > .02 && region.right - region.left > 1 && region.bottom - region.top > 1;
      };
      const loadedParts = new Map<string, boolean>();
      await Promise.all([...scope.querySelectorAll<SVGImageElement>('[data-performance-actor] svg image')].map(async element => {
        const source = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
        const image = new Image(); image.src = source;
        try { await image.decode(); loadedParts.set(source, image.naturalWidth > 0); }
        catch { loadedParts.set(source, false); }
      }));
      const read = (frame: number) => {
        timeline.seek(start + frame / fps, false);
        const cast = actors.map(actor => {
          const element = [...scope.querySelectorAll<HTMLElement>('[data-performance-actor]')].find(element => element.dataset.performanceActor === String(actor.index));
          const svg = element?.querySelector<SVGSVGElement>('svg[data-rig-kind]');
          if (!element || !svg) return null;
          const joints = [...svg.querySelectorAll<SVGGraphicsElement>('[data-joint]')].map(joint => ({ name: joint.dataset.joint ?? '', visible: visible(joint), transform: transform(joint), ...box(joint) }));
          const grips = [...svg.querySelectorAll<SVGGraphicsElement>('[data-grip]')].map(grip => {
            const rect = grip.getBoundingClientRect();
            return { side: grip.dataset.grip ?? '', x: round(rect.x + rect.width / 2), y: round(rect.y + rect.height / 2) };
          });
          const parts = [...svg.querySelectorAll<SVGImageElement>('image')].map(part => part.getAttribute('href') ?? part.getAttribute('xlink:href') ?? '');
          return { id: element.dataset.assetId, source: element.dataset.source, kind: svg.dataset.rigKind, visible: visible(element),
            loaded: joints.length >= 2 && parts.every(source => loadedParts.get(source) === true),
            ...box(element), transform: transform(element), opacity: getComputedStyle(element).opacity, joints, grips };
        });
        const props = [...scope.querySelectorAll<HTMLElement>('[data-performance-prop]')].map(prop => ({ id: prop.dataset.performanceProp, visible: visible(prop), opacity: getComputedStyle(prop).opacity, transform: transform(prop), ...box(prop) }));
        const copy = [...scope.querySelectorAll<HTMLElement>('[data-performance-copy]')].map(copy => ({ id: copy.dataset.performanceCopy, visible: visible(copy), opacity: getComputedStyle(copy).opacity, transform: transform(copy) }));
        return { frame, actors: cast, props, copy };
      };
      const forward = frames.map(read), reverse = [...frames].reverse().map(read).reverse();
      const copyViolations: Array<{ frame: number; visibleIds: string[] }> = [];
      // Inspect every exported frame, plus action boundaries between frames.
      for (const frame of new Set([...Array.from({ length: durationFrames }, (_, index) => index), ...frames])) {
        timeline.seek(start + frame / fps, false);
        const shown = [...scope.querySelectorAll<HTMLElement>('[data-performance-copy]')].filter(visible);
        if (shown.length > 1) copyViolations.push({ frame, visibleIds: shown.map(element => element.dataset.performanceCopy ?? '') });
      }
      timeline.seek(start + durationFrames / fps / 2, false);
      const content = scope.querySelector('.scene-content'), backgrounds = [...scope.querySelectorAll<HTMLImageElement>('.scene-background')];
      const transparency = (element: Element) => {
        const css = getComputedStyle(element);
        return (css.backgroundColor === 'rgba(0, 0, 0, 0)' || css.backgroundColor === 'transparent') && css.backgroundImage === 'none';
      };
      const absentPseudo = (element: Element) => ['::before', '::after'].every(pseudo => {
        const css = getComputedStyle(element, pseudo);
        return css.display === 'none' || ['none', 'normal'].includes(css.content);
      });
      const backdropContainers = [...scope.querySelectorAll('.scene-content,[data-performance-stage],.performance-heading,[data-performance-copy],.performance-prop,.performance-actor')];
      const backgroundPass = Boolean(background && backgrounds.length === 1 && backgrounds[0] instanceof HTMLImageElement
        && backgrounds[0].complete && backgrounds[0].naturalWidth > 0 && visible(backgrounds[0]) && backgrounds[0].getAttribute('src') === background.path
        && backgrounds[0].dataset.backgroundAssetId === background.id);
      const noBackplate = Boolean(content && backdropContainers.length && backdropContainers.every(element => transparency(element) && absentPseudo(element))
        && !scope.querySelector('.character-panel,.character-board,.workflow-stage,.workflow-card,.evidence-stage'));
      return { forward, reverse, copyViolations, backgroundPass, noBackplate, actorNodes: scope.querySelectorAll('[data-performance-actor]').length,
        inspectedCopyFrames: durationFrames, background: backgrounds.map(image => ({ source: image.getAttribute('src'), loaded: image.complete && image.naturalWidth > 0 })),
        backdropContainers: backdropContainers.map(element => ({ tag: element.tagName, className: element.getAttribute('class'), transparent: transparency(element) })) };
    }, { sceneId: scene.id, start, fps: spec.output.fps, durationFrames, frames,
      actors: scene.character!.actors.map((actor, index) => ({ index, assetId: actor.assetId })),
      background: spec.assets.find(asset => asset.id === scene.backgroundAssetId) ?? null });
    const real = Boolean(result && result.actorNodes === scene.character!.actors.length && scene.character!.actors.every((actor, index) => {
      const asset = spec.assets.find(asset => asset.id === actor.assetId);
      return asset && result.forward.every(sample => {
        const measured = sample.actors[index];
        return measured && measured.id === actor.assetId && measured.source === asset.path && measured.kind === asset.characterRig?.kind && measured.loaded && measured.width > 0 && measured.height > 0;
      }) && result.forward.some(sample => sample.actors[index]?.visible && sample.actors[index]!.joints.filter(joint => joint.visible).length >= 2);
    }));
    const moving = performance.cues.map(cue => {
      const states = result?.forward.filter(sample => sample.frame >= cue.startFrame && sample.frame <= cue.endFrame).map(sample => sample.actors[cue.actor]).filter(actor => actor?.visible) ?? [];
      const joints = states[0]?.joints.filter(joint => states.every(actor => actor?.joints.some(item => item.name === joint.name && item.visible)) && new Set(states.map(actor => actor?.joints.find(item => item.name === joint.name)?.transform)).size >= 3).map(joint => joint.name) ?? [];
      return { actor: cue.actor, verb: cue.verb, startFrame: cue.startFrame, endFrame: cue.endFrame, movingJoints: joints };
    });
    const continuous = real && moving.length > 0 && moving.every(cue => cue.movingJoints.length >= 2);
    const contacts = performance.cues.filter(cue => ['gather', 'handoff', 'place', 'connect', 'point'].includes(cue.verb)).flatMap(cue => (result?.forward ?? []).filter(sample => sample.frame >= cue.startFrame && sample.frame <= cue.endFrame).map(sample => {
      const prop = sample.props.find(prop => prop.id === cue.propId), actor = sample.actors[cue.actor];
      return { actor: cue.actor, verb: cue.verb, propId: cue.propId, frame: sample.frame, distances: prop && actor ? actor.grips.map(grip => ({ side: grip.side, pixels: Math.round(Math.hypot(grip.x - prop.x - prop.width / 2, grip.y - prop.y - prop.height / 2) * 100) / 100 })) : [] };
    }));
    const add = (id: string, pass: boolean, message: string) => checks.push({ id: `motion.${scene.id}.${id}`, status: pass ? 'PASS' : 'FAIL', message });
    add('real-subject', real, 'Visible inline SVG actors use the declared asset IDs, source paths and rig kinds; production asset-byte review remains separate.');
    add('continuous-joints', continuous, 'Every declared action shows at least three observed intermediate transforms in two visible joints; this is a finite motion check, not an acting-quality score.');
    add('reverse-seek', Boolean(real && result && JSON.stringify(result.forward) === JSON.stringify(result.reverse)), 'Reverse seeking restores each sampled actor, joint, object and copy state.');
    add('single-scene-background', Boolean(result?.backgroundPass), 'Exactly one declared scene image is actually loaded; photograph relevance and rights require their separate review.');
    add('no-card-backplate', Boolean(result?.noBackplate), 'No rendered content pseudo-panel, card stage or filled HTML backdrop sits between the scene image and performance.');
    add('exclusive-copy', Boolean(result && result.copyViolations.length === 0), 'At most one floating bilingual copy group is visible at each exported frame and sampled action boundary.');
    samples.push({ sceneId: scene.id, primitive: 'character-performance', method: 'SVG computed transforms and geometry, every exported copy frame, forward and reverse seek',
      ...result, moving, contacts, contactInterpretation: 'Measured grip-to-object-centre distances only; no automatic natural-contact or aesthetic PASS.' });
  }
  return { checks, samples };
}
