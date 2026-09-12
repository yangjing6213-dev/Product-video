// SPDX-License-Identifier: Apache-2.0
import { isProjectRelativePath, type Asset, type Scene, type VideoSpec } from '../contracts.ts';
import {
  compileSceneAction,
  validateSceneAction,
  type MotionAsset,
  type SceneAction,
} from './motion.ts';
import { workflowText, type SceneWorkflow, type WorkflowCard } from './workflow.ts';
import { authorRegionStyle, editorialCss } from './editorial.ts';

export interface NarrationCue {
  id?: string;
  sceneId: string;
  text: string;
  start: number;
  end: number;
}

export interface ComposeVideoOptions {
  gsapPath: string;
  fonts: Array<{ family: string; path: string; weight?: number }>;
  narration?: { path: string; cues: NarrationCue[]; durationSec?: number };
}

type ComposableAsset = Asset & MotionAsset;
type ComposableScene = Scene & { action?: SceneAction; workflow?: SceneWorkflow };
type AuthorContacts = { name: string; items: Array<{ label: string; value: string; url?: string }> };
type ComposableVideoSpec = VideoSpec & {
  assets: ComposableAsset[];
  scenes: ComposableScene[];
  authorContacts?: AuthorContacts;
};

interface SceneTiming {
  scene: ComposableScene;
  start: number;
  end: number;
}

const html = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const cssString = (value: string): string => JSON.stringify(value).replaceAll('</', '<\\/');
const finite = (value: number): string => Number(value.toFixed(4)).toString();
const preciseTime = (value: number): string => {
  if (!Number.isFinite(value)) throw new Error('Timeline values must be finite');
  return Object.is(value, -0) ? '0' : String(value);
};
const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function localPath(value: string, label: string): string {
  if (!isProjectRelativePath(value)) throw new Error(`${label} must be a local project-relative path`);
  return value.replaceAll('\\', '/');
}

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16);
}

function luminance(hex: string): number {
  const normalized = hex.slice(0, 7);
  return 0.2126 * channel(normalized, 1) + 0.7152 * channel(normalized, 3) + 0.0722 * channel(normalized, 5);
}

function palette(spec: ComposableVideoSpec): { background: string; foreground: string; muted: string; accent: string; highlight: string } {
  if (spec.brand.colors.length < 3 || spec.brand.colors.length > 5 || spec.brand.colors.some(color => !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color))) {
    throw new Error('Composition requires three to five declared RGB brand colors');
  }
  const colors = [...spec.brand.colors].sort((a, b) => luminance(a) - luminance(b));
  const background = spec.brand.canvas === 'dark' ? colors[0]! : colors.at(-1)!;
  const foreground = spec.brand.canvas === 'dark' ? colors.at(-1)! : colors[0]!;
  return {
    background,
    foreground,
    muted: colors[Math.floor((colors.length - 1) / 2)]!,
    accent: spec.brand.colors[2]!,
    highlight: spec.brand.colors[3] ?? spec.brand.colors[2]!,
  };
}

function timings(spec: ComposableVideoSpec): SceneTiming[] {
  let cursor = 0;
  return spec.scenes.map(scene => {
    const start = scene.actualStartSec ?? cursor;
    const end = scene.actualEndSec ?? start + scene.plannedDurationSec;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start < cursor) throw new Error(`Invalid or overlapping scene timing: ${scene.id}`);
    cursor = end;
    return { scene, start, end };
  });
}

function validateContacts(contacts: AuthorContacts | undefined): AuthorContacts | undefined {
  if (!contacts) return undefined;
  if (!contacts.name.trim() || !contacts.items.length || contacts.items.some(item => !item.label.trim() || !item.value.trim())) throw new Error('Author contacts require a name and readable labeled values');
  return contacts;
}

function renderAsset(asset: ComposableAsset, scene: ComposableScene, timing: SceneTiming, track: number, assets: Map<string, ComposableAsset>): string {
  const start = preciseTime(timing.start);
  const duration = preciseTime(timing.end - timing.start);
  const alt = html(`${scene.goal}：真实素材 ${asset.id}`);
  const path = html(localPath(asset.path, `Asset ${asset.id}`));
  if (asset.type === 'screen-recording') {
    return `<video id="${html(`${scene.id}-${asset.id}`)}" class="clip media-crop evidence-media" data-asset-id="${html(asset.id)}" src="${path}" data-start="${start}" data-duration="${duration}" data-track-index="${track}" muted></video>`;
  }
  if (!asset.layers?.length) {
    const logoClass = asset.type === 'logo' ? ' logo' : '';
    return `<figure class="media-crop evidence-frame"><img id="${html(`${scene.id}-${asset.id}`)}" class="clip evidence-media${logoClass}" data-asset-id="${html(asset.id)}" src="${path}" alt="${alt}" data-start="${start}" data-duration="${duration}" data-track-index="${track}"></figure>`;
  }
  if (!asset.width || !asset.height) throw new Error(`Layered asset requires real dimensions: ${asset.id}`);
  const width = asset.width;
  const height = asset.height;
  const layers = asset.layers.map((layer, index) => {
    const child = assets.get(layer.assetId);
    if (!child) throw new Error(`Layer references a missing real asset: ${layer.assetId}`);
    const [left, top, right, bottom] = layer.bounds;
    const style = `left:${finite(left / width * 100)}%;top:${finite(top / height * 100)}%;width:${finite((right - left) / width * 100)}%;height:${finite((bottom - top) / height * 100)}%`;
    const logoClass = layer.role === 'logo' ? ' logo' : '';
    return `<img id="${html(`${scene.id}-${asset.id}-${layer.id}`)}" class="clip evidence-layer${logoClass}" data-layer-id="${html(layer.id)}" data-layer-role="${html(layer.role)}" data-asset-id="${html(child.id)}" src="${html(localPath(child.path, `Layer ${layer.id}`))}" alt="${html(`${layer.role}真实分层`)}" style="${style}" data-start="${start}" data-duration="${duration}" data-track-index="${track + index + 1}">`;
  }).join('');
  return `<figure class="media-crop evidence-frame layered-evidence" style="aspect-ratio:${asset.width}/${asset.height}"><img id="${html(`${scene.id}-${asset.id}`)}" class="clip evidence-media evidence-base" data-layer-id="base" data-layer-role="base" data-asset-id="${html(asset.id)}" src="${path}" alt="${alt}" data-start="${start}" data-duration="${duration}" data-track-index="${track}">${layers}</figure>`;
}

function renderContacts(contacts: AuthorContacts | undefined): string {
  if (!contacts) return '';
  const items = contacts.items.map(item => `<li class="safe-area"><span data-text-role="label">${html(item.label)}：</span><strong>${html(item.value)}</strong></li>`).join('');
  return `<aside class="contact-block safe-area" data-text-role="body" aria-label="作者联系方式"><p class="contact-name safe-area">${html(contacts.name)}</p><ul>${items}</ul></aside>`;
}

function connectorPath(layout: SceneWorkflow['layout'], index: number, count: number): string {
  if (layout === 'vertical-3') {
    const from = (index + .5) * 100 / count;
    const to = (index + 1.5) * 100 / count;
    return `M 50 ${finite(from)} L 50 ${finite(to)}`;
  }
  const from = (index + .5) * 100 / count;
  const to = (index + 1.5) * 100 / count;
  return `M ${finite(from)} 50 L ${finite(to)} 50`;
}

function renderWorkflowCard(
  card: WorkflowCard,
  index: number,
  scene: ComposableScene,
  timing: SceneTiming,
  assets: Map<string, ComposableAsset>,
  track: number,
): string {
  const asset = assets.get(card.previewAssetId);
  if (!asset) throw new Error(`Workflow card references a missing real preview: ${card.previewAssetId}`);
  const fields = card.fields.map(field => `<li><span data-text-role="label">${html(field.label)}：</span><strong data-text-role="label">${html(field.value)}</strong></li>`).join('');
  return `<article class="workflow-card safe-area" data-workflow-card-id="${html(card.id)}" data-workflow-index="${index}" data-state="ordinary"><div class="workflow-preview">${renderAsset(asset, scene, timing, track, assets)}</div><div class="workflow-card-copy"><p class="workflow-card-title" data-text-role="label">${html(card.title)}</p><p class="workflow-card-sentence" data-text-role="body">${html(card.sentence)}</p><ul class="workflow-fields">${fields}</ul></div></article>`;
}

function renderWorkflowStage(
  workflow: SceneWorkflow,
  intro: string,
  scene: ComposableScene,
  timing: SceneTiming,
  assets: Map<string, ComposableAsset>,
  sceneIndex: number,
): string {
  const paths = workflow.cards.slice(1).map((_, index) => {
    const path = connectorPath(workflow.layout, index, workflow.cards.length);
    return `<path class="workflow-connector-track" d="${path}" pathLength="1"></path><path class="workflow-connector-progress" data-workflow-connector-index="${index}" d="${path}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"></path>`;
  }).join('');
  const cards = workflow.cards.map((card, index) => renderWorkflowCard(card, index, scene, timing, assets, 10 + sceneIndex * 30 + index * 6)).join('');
  return `<div class="workflow-stage ${workflow.layout}" data-workflow-layout="${workflow.layout}">${intro ? `<div class="workflow-intro">${intro}</div>` : ''}<div class="workflow-flow"><svg class="workflow-connectors" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${paths}</svg><div class="workflow-cards">${cards}</div></div></div>`;
}

function renderScene(
  timing: SceneTiming,
  sceneIndex: number,
  timingsList: SceneTiming[],
  spec: ComposableVideoSpec,
  assets: Map<string, ComposableAsset>,
  contacts: AuthorContacts | undefined,
): string {
  const { scene, start, end } = timing;
  if (!safeId.test(scene.id)) throw new Error(`Unsafe scene ID: ${scene.id}`);
  if (scene.authorPosterAssetId) {
    const poster = assets.get(scene.authorPosterAssetId)!;
    const path = html(localPath(poster.path, 'Author poster'));
    const duration = preciseTime(end - start);
    if (spec.brand.visualStyle && poster.authorRegions) {
      const regions = Object.entries(poster.authorRegions).map(([role, region]) => {
        const style = authorRegionStyle(region, poster.width, poster.height);
        // The full source deliberately extends past this validated region; text and region bounds remain audited.
        return `<figure class="author-region author-${role}-region" data-author-region="${role}" style="aspect-ratio:${style.aspectRatio}"><img id="${html(`${scene.id}-${role}`)}" data-layout-allow-overflow src="${path}" style="${style.image}" alt="${role === 'portrait' ? '原图人物与工作场景' : '原图完整作者说明及联系方式'}"></figure>`;
      }).join('');
      return `<section id="${html(`${scene.id}-clip`)}" class="clip scene-clip" data-start="${preciseTime(start)}" data-duration="${duration}" data-track-index="${sceneIndex * 20}"><div id="${html(scene.id)}" class="scene author-poster-scene author-reframed" data-author-poster-asset-id="${html(poster.id)}" data-scene-goal="${html(scene.goal)}"><img id="${html(`${scene.id}-poster`)}" class="clip author-poster-background" data-layout-allow-overflow data-asset-id="${html(poster.id)}" src="${path}" alt="" aria-hidden="true" data-start="${preciseTime(start)}" data-duration="${duration}" data-track-index="${1 + sceneIndex * 20}">${regions}</div></section>`;
    }
    return `<section id="${html(`${scene.id}-clip`)}" class="clip scene-clip" data-start="${preciseTime(start)}" data-duration="${duration}" data-track-index="${sceneIndex * 20}"><div id="${html(scene.id)}" class="scene author-poster-scene" data-author-poster-asset-id="${html(poster.id)}" data-scene-goal="${html(scene.goal)}"><img id="${html(`${scene.id}-poster-background`)}" class="clip author-poster-background" data-layout-allow-overflow data-background-asset-id="${html(poster.id)}" src="${path}" alt="" aria-hidden="true" data-start="${preciseTime(start)}" data-duration="${duration}" data-track-index="${1 + sceneIndex * 20}"><img id="${html(`${scene.id}-poster`)}" class="clip author-poster-image" data-asset-id="${html(poster.id)}" src="${path}" alt="作者完整海报" data-start="${preciseTime(start)}" data-duration="${duration}" data-track-index="${10 + sceneIndex * 20}"></div></section>`;
  }
  const logo = assets.get(spec.brand.logoAssetId);
  if (!logo || logo.type !== 'logo') throw new Error('Every composition scene requires the declared real brand logo');
  const background = scene.backgroundAssetId ? assets.get(scene.backgroundAssetId) : undefined;
  if (scene.backgroundAssetId && (!background || !scene.assetRefs.includes(scene.backgroundAssetId) || !['image', 'screenshot'].includes(background.type))) {
    throw new Error(`Scene background must reference a real declared image in assetRefs: ${scene.backgroundAssetId}`);
  }
  const backgroundHtml = background
    ? `<img id="${html(`${scene.id}-background`)}" class="clip scene-background" data-background-asset-id="${html(background.id)}" data-asset-id="${html(background.id)}" src="${html(localPath(background.path, 'Scene background'))}" alt="" aria-hidden="true" data-start="${preciseTime(start)}" data-duration="${preciseTime(end - start)}" data-track-index="${2 + sceneIndex * 20}">`
    : '';
  const layerChildren = new Set(scene.assetRefs.flatMap(id => assets.get(id)?.layers?.map(layer => layer.assetId) ?? []));
  const evidenceRefs = scene.assetRefs.filter(id => id !== spec.brand.logoAssetId && id !== scene.backgroundAssetId && !layerChildren.has(id));
  const semanticOrder = scene.action?.primitive === 'before-after' ? scene.action.relatedAssetIds ?? [] : [];
  const orderedEvidenceRefs = semanticOrder.length
    ? [...evidenceRefs.filter(id => !semanticOrder.includes(id)), ...semanticOrder.filter(id => evidenceRefs.includes(id))]
    : evidenceRefs;
  const evidence = orderedEvidenceRefs
    .map((id, evidenceIndex) => {
      const asset = assets.get(id);
      if (!asset) throw new Error(`Scene references a missing real asset: ${id}`);
      if (asset.type === 'audio' || asset.type === 'font') return '';
      return renderAsset(asset, scene, timing, 10 + sceneIndex * 20 + evidenceIndex * 6, assets);
    }).join('');
  if (!evidence) throw new Error(`Scene ${scene.id} requires at least one real visual asset`);
  const isFinal = sceneIndex === timingsList.length - 1;
  const hasPosterEnding = Boolean(timingsList.at(-1)?.scene.authorPosterAssetId);
  const isSignoff = sceneIndex === timingsList.length - (hasPosterEnding ? 2 : 1);
  const exampleLabelText = spec.product.example ? `演示项目：${spec.product.example.name}` : undefined;
  const example = sceneIndex === 0 && spec.product.example
    ? `${scene.onScreenText.includes(exampleLabelText!) ? '' : `<p class="example-label" data-text-role="label">${html(exampleLabelText!)}</p>`}${scene.onScreenText.includes(spec.product.example.explanation) ? '' : `<p class="example-note" data-text-role="body">${html(spec.product.example.explanation)}</p>`}`
    : '';
  const signoffCopy = isSignoff && spec.generatorPolicy
    ? new Set([spec.generatorPolicy.marketing.screenAction, spec.generatorPolicy.marketing.displayDomain])
    : new Set<string>();
  const workflowCopy = new Set(scene.workflow ? workflowText(scene.workflow) : []);
  const visibleScreenCopy = scene.onScreenText.filter((line, index) => !signoffCopy.has(line) && !workflowCopy.has(line) && !(index > 0 && line === spec.product.name));
  const screenCopy = visibleScreenCopy.map((line, index) => {
    if (index === 0) return `<h2>${html(line)}</h2>`;
    if (line === exampleLabelText) return `<p class="example-label" data-text-role="label">${html(line)}</p>`;
    if (line === spec.product.example?.explanation) return `<p class="example-note" data-text-role="body">${html(line)}</p>`;
    return `<p class="screen-copy" data-text-role="body">${html(line)}</p>`;
  }).join('');
  const signoff = isSignoff && spec.generatorPolicy
    ? `<div class="signoff"><p class="primary-cta">${html(spec.generatorPolicy.marketing.screenAction)}</p><p class="display-domain" data-text-role="body">${html(spec.generatorPolicy.marketing.displayDomain)}</p>${renderContacts(isFinal ? contacts : undefined)}</div>`
    : '';
  const sceneClasses = ['scene'];
  if (isSignoff && hasPosterEnding) sceneClasses.push('poster-signoff');
  if (isFinal && contacts) sceneClasses.push('has-contacts');
  if (scene.workflow) sceneClasses.push('workflow-scene');
  else if (spec.brand.presentation === 'workflow') sceneClasses.push('centered-result');
  const sceneClass = sceneClasses.join(' ');
  const body = scene.workflow
    ? renderWorkflowStage(scene.workflow, `${screenCopy}${example}`, scene, timing, assets, sceneIndex)
    : `<div class="copy-column">${screenCopy}${example}${signoff}</div><div class="evidence-stage"><div class="media-stack">${evidence}</div></div>`;
  const brandText = spec.brand.visualStyle
    ? (sceneIndex === 0 ? `<p class="product-name" data-text-role="label">${html(spec.product.name)}</p>` : '')
    : `<div><p class="brand-name" data-text-role="label">${html(spec.generatorPolicy?.marketing.brand ?? spec.product.name)}</p><p class="product-name" data-text-role="label">${html(spec.product.name)}</p></div>`;
  return `<section id="${html(`${scene.id}-clip`)}" class="clip scene-clip" data-start="${preciseTime(start)}" data-duration="${preciseTime(end - start)}" data-track-index="${sceneIndex * 20}"><div id="${html(scene.id)}" class="${sceneClass}" data-scene-goal="${html(scene.goal)}">${backgroundHtml}
<div class="scene-content">
<header class="brand-header safe-area"><img id="${html(`${scene.id}-brand-logo`)}" class="clip logo safe-area" data-asset-id="${html(logo.id)}" src="${html(localPath(logo.path, 'Brand logo'))}" alt="${html(spec.generatorPolicy?.marketing.brand ?? spec.product.name)}" data-start="${preciseTime(start)}" data-duration="${preciseTime(end - start)}" data-track-index="${1 + sceneIndex * 20}">${brandText}</header>
${body}
</div></div></section>`;
}

function renderCss(spec: ComposableVideoSpec, colors: ReturnType<typeof palette>, options: ComposeVideoOptions): string {
  const fontFaces = options.fonts.map((font, index) => {
    if (!font.family.trim()) throw new Error('Font family is required');
    const weight = font.weight ?? 400;
    if (!Number.isSafeInteger(weight) || weight < 100 || weight > 900) throw new Error('Font weight must be 100..900');
    return `@font-face{font-family:${cssString(font.family)};src:url(${cssString(localPath(font.path, `Font ${index}`))});font-weight:${weight};font-display:block}`;
  }).join('');
  const family = cssString(options.fonts[0]?.family ?? spec.brand.fontFamilies[0]!);
  const titleFamily = cssString(spec.brand.fontFamilies[1] ?? options.fonts[1]?.family ?? options.fonts[0]?.family ?? spec.brand.fontFamilies[0]!);
  const safeTop = Math.ceil(spec.output.height * spec.captions.safeAreaPercent / 100);
  const safeSide = Math.ceil(spec.output.width * spec.captions.safeAreaPercent / 100);
  const contentBottom = safeTop + 96;
  const shadow = `${colors.background.slice(0, 7)}88`;
  const posterCss = '.author-poster-image,.author-poster-background{position:absolute;inset:0;width:100%;height:100%;object-position:center}.author-poster-background{object-fit:cover;filter:blur(32px) brightness(.55);transform:scale(1.06)}.author-poster-image{object-fit:contain}'
    + (spec.scenes.at(-1)?.authorPosterAssetId ? '.poster-signoff .evidence-stage,.poster-signoff .media-stack,.poster-signoff .evidence-frame{height:100%;min-height:0;overflow:hidden}.poster-signoff .evidence-media{width:100%;height:100%;object-fit:contain}' : '');
  return `${fontFaces}${posterCss}*{box-sizing:border-box}html,body{margin:0;width:${spec.output.width}px;height:${spec.output.height}px;overflow:hidden}body{font-family:${family},sans-serif;font-synthesis:none;color:${colors.foreground};background:${colors.background}}h1,h2,h3{font-family:${titleFamily},sans-serif;font-synthesis:none}.composition{position:relative;width:100%;height:100%;overflow:hidden;background:${colors.background};--bg:${colors.background};--fg:${colors.foreground};--muted:${colors.muted};--accent:${colors.accent};--highlight:${colors.highlight}}.scene-clip,.scene{position:absolute;inset:0;overflow:hidden}.scene{opacity:0;background:var(--bg)}.scene-background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.32;filter:brightness(.56) saturate(.72);pointer-events:none}.scene-content{position:relative;z-index:2;width:100%;height:100%;padding:${safeTop}px ${safeSide}px ${contentBottom}px;display:grid;box-sizing:border-box}.landscape .scene-content{grid-template-columns:minmax(0,.78fr) minmax(0,1.22fr);grid-template-rows:auto minmax(0,1fr);gap:36px 6%}.portrait .scene-content{grid-template-columns:1fr;grid-template-rows:auto minmax(0,.82fr) minmax(0,1.18fr);gap:3.4%;padding-bottom:${contentBottom + 64}px}.brand-header{grid-column:1/-1;display:flex;align-items:center;gap:28px;min-width:0}.brand-header .logo{width:clamp(150px,12vw,220px);max-height:96px;object-fit:contain}.brand-name,.product-name,.example-label{margin:0;font-size:34px;line-height:1.35}.brand-name{color:var(--muted)}.product-name{font-weight:700;color:var(--fg)}.copy-column{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:22px}.copy-column h2{margin:0;font-size:84px;line-height:1.24;letter-spacing:-.025em;text-wrap:balance}.screen-copy,.example-note{margin:0;font-size:44px;line-height:1.45;text-wrap:balance}.example-label{margin-top:10px;color:var(--accent);font-weight:700}.example-note{font-size:42px;color:var(--muted)}.evidence-stage{position:relative;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;border:0;border-bottom:2px solid var(--muted);padding:26px;overflow:hidden;background:var(--bg);box-shadow:0 24px 64px ${shadow}}.media-stack{position:relative;z-index:1;width:100%;height:100%;display:grid;place-items:center}.media-stack>*{grid-area:1/1}.evidence-frame{position:relative;margin:0;max-width:100%;max-height:100%;display:flex;align-items:center;justify-content:center}.evidence-media{display:block;max-width:100%;max-height:100%;object-fit:contain}.layered-evidence{width:100%;overflow:hidden}.layered-evidence .evidence-base{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}.evidence-layer{position:absolute;object-fit:fill;will-change:transform,opacity}.signoff{display:flex;flex-direction:column;gap:10px;border-top:2px solid var(--accent);padding-top:14px}.primary-cta{margin:0;font-size:52px;line-height:1.35;font-weight:700}.display-domain{margin:0;font-size:42px;line-height:1.4}.contact-block{font-size:42px;line-height:1.35;color:var(--fg)}.contact-name{margin:4px 0;font-weight:700}.contact-block ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:max-content minmax(0,1fr);column-gap:14px;row-gap:4px}.contact-block li{grid-column:1/-1;display:grid;grid-template-columns:subgrid;align-items:baseline;min-width:0}.contact-block li span{font-size:32px;color:var(--muted)}.contact-block li strong{font-weight:400;overflow-wrap:anywhere}.caption{position:absolute;left:${safeSide}px;right:${safeSide}px;bottom:calc(${spec.captions.safeAreaPercent}% + 12px);z-index:40;margin:0;padding:0;text-align:center;font-size:44px;line-height:1.45;color:var(--fg);white-space:pre-wrap;background:none;background-image:none;box-shadow:none;text-shadow:0 1px 2px var(--bg);opacity:0;pointer-events:none}.landscape .has-contacts .scene-content{grid-template-columns:minmax(0,1.25fr) minmax(0,.75fr)}.landscape .has-contacts .copy-column{justify-content:flex-start;gap:10px}.landscape .has-contacts .copy-column h2{font-size:78px;line-height:1.24}.landscape .has-contacts .contact-block ul{row-gap:2px}.landscape .has-contacts .evidence-stage{align-self:center;height:auto}.landscape .has-contacts .media-stack{height:auto}.landscape .has-contacts .evidence-frame{width:100%}.landscape .has-contacts .evidence-media{width:100%;height:auto}.portrait .copy-column{justify-content:flex-start}.portrait .copy-column h2{font-size:88px}.portrait .evidence-stage{padding:24px}.portrait .has-contacts .scene-content{grid-template-rows:auto auto minmax(0,1fr)}.portrait .contact-block ul{row-gap:4px}.portrait .brand-header .logo{width:180px}.workflow-scene .scene-content{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr);gap:18px}.workflow-stage{grid-column:1/-1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:12px}.workflow-intro{text-align:center}.workflow-intro h2{margin:0;font-size:78px;line-height:1.2;text-wrap:balance}.workflow-intro .screen-copy{font-size:42px}.workflow-flow{position:relative;flex:1;min-height:0}.workflow-connectors{position:absolute;inset:0;width:100%;height:100%;z-index:0;overflow:visible;pointer-events:none;fill:none}.workflow-connector-track,.workflow-connector-progress{fill:none;vector-effect:non-scaling-stroke;stroke-width:5;stroke-linecap:round}.workflow-connector-track{stroke:var(--muted);opacity:.55}.workflow-connector-progress{stroke:var(--accent)}.workflow-cards{position:relative;z-index:1;width:100%;height:100%;display:grid;gap:30px}.horizontal-3 .workflow-cards{grid-template-columns:repeat(3,minmax(0,1fr))}.vertical-3 .workflow-cards{grid-template-rows:repeat(3,minmax(0,1fr))}.feature-row-4 .workflow-cards{grid-template-columns:repeat(4,minmax(0,1fr));align-items:end}.feature-row-4 .workflow-card{height:100%}.horizontal-3 .workflow-card,.feature-row-4 .workflow-card{padding:14px;gap:10px;grid-template-rows:180px minmax(0,1fr)}.horizontal-3 .workflow-card-copy,.feature-row-4 .workflow-card-copy{display:grid;grid-template-rows:52px minmax(0,1fr) auto;gap:6px}.workflow-card{position:relative;min-width:0;min-height:0;overflow:hidden;padding:18px;border:1px solid var(--accent);border-radius:18px;background:var(--fg);color:var(--bg);display:grid;grid-template-rows:minmax(0,1fr) auto;gap:14px;transform-origin:center;box-shadow:0 12px 32px ${shadow}}.workflow-card:after{content:"";position:absolute;right:16px;top:16px;width:14px;height:14px;border-radius:50%;background:var(--highlight);opacity:0}.workflow-card[data-state="focus"]{box-shadow:0 20px 56px ${colors.accent}55}.workflow-card[data-state="complete"]{border-color:var(--accent)}.workflow-card[data-state="focus"] .workflow-preview{border-color:var(--highlight)}.workflow-card[data-state="complete"] .workflow-card-title{color:var(--accent)}.workflow-card[data-state="complete"]:after{opacity:1}.workflow-preview{position:relative;min-height:0;overflow:hidden;display:grid;place-items:center;border-bottom:1px solid var(--accent);padding:12px;background:var(--bg)}.workflow-preview .evidence-frame,.workflow-preview .evidence-media{width:100%;height:100%;min-width:0;min-height:0}.workflow-preview .evidence-frame{overflow:hidden}.workflow-preview .evidence-media{object-fit:contain}.workflow-card-copy{min-width:0;display:flex;flex-direction:column;gap:8px;opacity:.72}.workflow-card[data-state="focus"] .workflow-card-copy,.workflow-card[data-state="complete"] .workflow-card-copy{opacity:1}.workflow-card-title,.workflow-card-sentence{margin:0}.workflow-card-title{font-family:${family},sans-serif;font-size:38px;line-height:1.35;font-weight:700;color:var(--bg)}.workflow-card-sentence{font-size:42px;line-height:1.4;text-wrap:balance}.workflow-fields{list-style:none;margin:0;padding:0;display:grid;gap:4px}.workflow-fields li{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:10px;align-items:baseline;min-width:0}.workflow-fields span,.workflow-fields strong{font-size:32px;line-height:1.35}.workflow-fields span{color:var(--muted)}.workflow-fields strong{font-weight:400;overflow-wrap:anywhere}.vertical-3 .workflow-card{grid-template-columns:minmax(180px,.42fr) minmax(0,.58fr);grid-template-rows:1fr;align-items:center}.vertical-3 .workflow-preview{height:100%;border-bottom:0;border-right:1px solid var(--accent);padding:12px}.portrait .workflow-scene .scene-content{grid-template-rows:auto minmax(0,1fr);padding-bottom:${contentBottom + 64}px}.portrait .workflow-stage{gap:16px}.portrait .workflow-cards{gap:22px}.portrait .workflow-card-sentence{font-size:42px}.presentation-workflow .centered-result .scene-content{grid-template-columns:1fr;grid-template-rows:auto auto minmax(0,1fr);gap:22px}.presentation-workflow .centered-result .copy-column{grid-column:1;align-items:center;text-align:center;justify-content:flex-start;gap:12px}.presentation-workflow .centered-result .copy-column h2,.presentation-workflow .centered-result .signoff{width:min(100%,1000px);text-align:left}.presentation-workflow .centered-result .evidence-stage{grid-column:1;width:min(100%,1500px);justify-self:center}.presentation-workflow .centered-result.has-contacts .scene-content{grid-template-columns:1fr;grid-template-rows:auto auto minmax(0,1fr)}.presentation-workflow .centered-result.has-contacts .copy-column{min-height:0}.presentation-workflow .centered-result.has-contacts .evidence-stage{align-self:stretch;height:100%;min-height:0;overflow:hidden}.presentation-workflow .centered-result.has-contacts .media-stack,.presentation-workflow .centered-result.has-contacts .evidence-frame{height:100%;min-height:0;overflow:hidden}.presentation-workflow .centered-result.has-contacts .evidence-media{width:100%;height:100%;object-fit:contain}.presentation-workflow .centered-result .contact-block{text-align:left;max-width:1000px;width:100%}.landscape.presentation-workflow .centered-result.has-contacts .scene-content{position:relative;grid-template-rows:auto minmax(0,1fr)}.landscape.presentation-workflow .centered-result.has-contacts .evidence-stage{position:absolute;right:${safeSide}px;bottom:${contentBottom}px;width:320px;height:180px;padding:12px}`;
}

/** Build a deterministic HyperFrames composition from structured scene actions and real assets. */
export function composeVideo(input: VideoSpec, options: ComposeVideoOptions): string {
  const spec = input as ComposableVideoSpec;
  if (!spec.scenes.length) throw new Error('Composition requires at least one scene');
  localPath(options.gsapPath, 'GSAP');
  const colors = palette(spec);
  const sceneTimings = timings(spec);
  const totalDuration = Math.max(spec.output.targetDurationSec, sceneTimings.at(-1)!.end);
  const totalFrames = Math.round(totalDuration * spec.output.fps);
  const contacts = validateContacts(spec.authorContacts);
  const assetMap = new Map(spec.assets.map(asset => [asset.id, asset]));
  if (assetMap.size !== spec.assets.length) throw new Error('Composition asset IDs must be unique');

  const cues = (options.narration?.cues ?? []).map((cue, index) => ({ ...cue, id: cue.id ?? `cue-${index}`, index }));
  const cueIds = new Set<string>();
  for (const cue of cues) {
    if (!safeId.test(cue.id) || cueIds.has(cue.id) || !cue.text.trim() || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start) throw new Error('Narration cues require unique IDs, text and finite timing');
    const scene = sceneTimings.find(item => item.scene.id === cue.sceneId);
    if (!scene || cue.start < scene.start || cue.end > scene.end) throw new Error(`Narration cue must stay inside its scene: ${cue.id}`);
    cueIds.add(cue.id);
  }
  if (options.narration) localPath(options.narration.path, 'Narration');

  const actionSource = sceneTimings.map(timing => {
    if (timing.scene.authorPosterAssetId !== undefined) {
      const scene = timing.scene;
      const poster = assetMap.get(scene.authorPosterAssetId!);
      if (timing !== sceneTimings.at(-1)) throw new Error('Author poster must be the final scene');
      if (spec.generatorPolicy && sceneTimings.at(-2)?.scene.workflow) throw new Error('Author poster requires a separate product CTA scene after the workflow');
      if (scene.voiceover.trim() || scene.caption?.trim()) throw new Error('Author poster requires a silent reading hold with empty voiceover and caption');
      if (cues.some(cue => cue.sceneId === scene.id)) throw new Error('Author poster cannot contain narration cues; finish narration before the poster');
      if (!poster || !safeId.test(poster.id) || !scene.assetRefs.includes(poster.id) || !['image', 'screenshot'].includes(poster.type)) throw new Error('Author poster must reference a real declared image in assetRefs');
      if (scene.workflow || scene.action?.primitive !== 'reading-hold' || scene.action.subject.assetId !== poster.id) throw new Error('Author poster requires a reading-hold action on the whole poster without a workflow');
    }
    if (!timing.scene.action) throw new Error(`Scene ${timing.scene.id} requires one structured subject action`);
    const sceneCueIds = cues.filter(cue => cue.sceneId === timing.scene.id).map(cue => cue.id);
    const action = validateSceneAction(timing.scene.action, {
      sceneId: timing.scene.id,
      sceneDurationFrames: Math.round((timing.end - timing.start) * spec.output.fps),
      sceneAssetRefs: timing.scene.assetRefs,
      cueIds: sceneCueIds,
      assets: spec.assets,
      backgroundAssetId: timing.scene.backgroundAssetId,
      workflow: timing.scene.workflow,
    });
    return compileSceneAction(action, { sceneId: timing.scene.id, sceneStartFrame: Math.round(timing.start * spec.output.fps), fps: spec.output.fps, workflow: timing.scene.workflow, visualStyle: spec.brand.visualStyle });
  }).join('\n');

  const sceneHtml = sceneTimings.map((timing, index) => renderScene(timing, index, sceneTimings, spec, assetMap, contacts)).join('\n');
  // Captions follow the audio clock independently of the scenes' crossfade opacity.
  const captionHtml = cues.map(cue => `<p id="narration-caption-${cue.index}" class="caption narration-caption" data-text-role="body" data-scene-id="${html(cue.sceneId)}" data-caption-start="${preciseTime(cue.start)}" data-caption-end="${preciseTime(cue.end)}"${cue.start === 0 ? ' style="opacity:1"' : ''}>${html(cue.text)}</p>`).join('');
  const initial = [`tl.set(${cssString('.scene')},{autoAlpha:0},0);`, `tl.set(${cssString(`#${sceneTimings[0]!.scene.id}`)},{autoAlpha:1},0);`];
  for (let index = 1; index < sceneTimings.length; index++) {
    const previous = sceneTimings[index - 1]!;
    const current = sceneTimings[index]!;
    const duration = Math.min(current.scene.transition.durationSec, (current.end - current.start) / 3);
    initial.push(`tl.to(${cssString(`#${previous.scene.id}`)},{autoAlpha:0,duration:${finite(duration)},ease:"sine.inOut"},${finite(current.start)});`);
    initial.push(`tl.fromTo(${cssString(`#${current.scene.id}`)},{autoAlpha:0},{autoAlpha:1,duration:${finite(duration)},ease:"sine.inOut",immediateRender:false},${finite(current.start)});`);
  }
  const captionSource = cues.flatMap(cue => [
    `tl.set(${cssString(`#narration-caption-${cue.index}`)},{autoAlpha:1},${preciseTime(cue.start)});`,
    `tl.set(${cssString(`#narration-caption-${cue.index}`)},{autoAlpha:0},${preciseTime(cue.end)});`,
  ]).join('\n');
  const narrationAudio = options.narration
    ? `<audio id="narration" class="clip" src="${html(localPath(options.narration.path, 'Narration'))}" data-start="0" data-duration="${preciseTime(options.narration.durationSec ?? totalDuration)}" data-track-index="1000" data-volume="1"></audio>`
    : '';
  const musicAsset = spec.audio.musicAssetId ? assetMap.get(spec.audio.musicAssetId) : undefined;
  if (spec.audio.musicAssetId && (!musicAsset || musicAsset.type !== 'audio')) throw new Error('Music must reference a declared local audio asset');
  const musicAudio = musicAsset
    ? `<audio id="music" class="clip" src="${html(localPath(musicAsset.path, 'Music'))}" data-start="0" data-duration="${preciseTime(totalDuration)}" data-track-index="1001" data-volume="1"></audio>`
    : '';
  const orientation = spec.output.height > spec.output.width ? 'portrait' : 'landscape';
  const presentation = (spec.brand.presentation === 'workflow' ? ' presentation-workflow' : '') + (spec.brand.visualStyle ? ` ${spec.brand.visualStyle}` : '');
  const narrationCues = JSON.stringify(cues.map(({ sceneId, text, start, end }) => ({ sceneId, text, start, end }))).replaceAll('<', '\\u003c');
  return `<!DOCTYPE html><html lang="${html(spec.output.locale)}"><head><meta charset="utf-8"><title>${html(spec.product.name)} · 产品介绍</title><style>${renderCss(spec, colors, options)}${editorialCss(spec, colors)}</style></head><body><div id="composition" class="composition ${orientation}${presentation}" data-composition-id="main" data-start="0" data-duration="${preciseTime(totalDuration)}" data-width="${spec.output.width}" data-height="${spec.output.height}">${sceneHtml}${captionHtml}${narrationAudio}${musicAudio}</div><script src="${html(localPath(options.gsapPath, 'GSAP'))}"></script><script>const NARRATION_CUES=${narrationCues};window.NARRATION_CUES=NARRATION_CUES;const tl=gsap.timeline({paused:true});${initial.join('')}${actionSource}${captionSource}tl.set("#composition",{visibility:"visible"},${preciseTime(totalFrames / spec.output.fps)});window.__timelines={main:tl};</script></body></html>\n`;
}
