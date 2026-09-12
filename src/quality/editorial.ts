// SPDX-License-Identifier: Apache-2.0
import type { VideoSpec } from '../contracts.ts';

export function authorRegionStyle(region: [number, number, number, number], width?: number, height?: number): { aspectRatio: number; image: string } {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Author regions require original image dimensions');
  const [left, top, right, bottom] = region;
  if (!region.every(Number.isFinite) || left < 0 || top < 0 || right > width || bottom > height || right <= left || bottom <= top) throw new Error('Author region must stay inside the unmodified original');
  const w=right-left, h=bottom-top;
  return {aspectRatio:w/h,image:`width:${width/w*100}%;height:${height/h*100}%;left:${-left/w*100}%;top:${-top/h*100}%`};
}

/** Versioned, deterministic layout; frozen specifications without this style retain their original renderer. */
export function editorialCss(spec: VideoSpec, colors: { background: string; foreground: string; accent: string }): string {
  if (spec.brand.visualStyle !== 'editorial-v1' && spec.brand.visualStyle !== 'editorial-v2') return '';
  const bg = colors.background.slice(0, 7), fg = colors.foreground.slice(0, 7), accent = colors.accent.slice(0, 7);
  const family = JSON.stringify(spec.brand.fontFamilies[0]).replaceAll('</', '<\\/');
  const base = `
.editorial-v1{--body-face:${family};--surface-edge:${bg}22;--soft-ink:${bg}B8}
.editorial-v1 h2{font-family:var(--body-face),sans-serif;font-weight:700;font-style:normal;letter-spacing:-.035em}
.editorial-v1 .scene-background{opacity:.8;filter:brightness(.65) saturate(.68)}
.editorial-v1 .scene:after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(120deg,${bg}E8,${bg}45 58%,${bg}AD)}
.editorial-v1 .author-poster-scene:after{display:none}
.editorial-v1 .brand-header{justify-content:space-between;min-height:44px;align-items:center}
.editorial-v1 .brand-header .logo{width:174px;max-height:48px}
.editorial-v1 .product-name{font-size:32px;font-weight:400;letter-spacing:.02em}
.editorial-v1 .workflow-scene .scene-content{gap:24px}
.editorial-v1 .workflow-stage{gap:24px}
.editorial-v1 .workflow-intro{text-align:left;position:relative;padding-left:0}
.editorial-v1 .workflow-intro h2{font-size:82px;line-height:1.4}
.editorial-v1 .workflow-intro .example-label,.editorial-v1 .workflow-intro .example-note{display:inline-block;font-size:42px;line-height:1.45;margin:8px 24px 0 0;color:var(--fg);opacity:.75;font-weight:400}
.editorial-v1 .workflow-intro .screen-copy{font-size:42px;line-height:1.4;margin-top:12px}
.editorial-v1 .workflow-flow{padding:22px 20px 18px;border:1px solid ${fg}16;border-radius:28px;background:linear-gradient(135deg,${bg}D9,${bg}80);box-shadow:inset 0 1px 0 ${fg}16,0 28px 64px ${bg}66}
.editorial-v1 .workflow-cards{gap:28px;align-items:stretch}
.editorial-v1 .horizontal-3 .workflow-cards{grid-template-columns:minmax(0,.92fr) minmax(0,1.16fr) minmax(0,1.06fr)}
.editorial-v1 .workflow-card{opacity:0;visibility:hidden;border:1px solid var(--surface-edge);border-radius:18px;padding:0;gap:0;background:var(--fg);box-shadow:0 8px 18px ${bg}66,inset 0 1px 0 ${fg};isolation:isolate}
.editorial-v1 .horizontal-3 .workflow-card,.editorial-v1 .feature-row-4 .workflow-card{grid-template-rows:minmax(210px,1fr) auto;padding:0;gap:0}
.editorial-v1 .workflow-card:before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:var(--accent);opacity:0;z-index:3}
.editorial-v1 .workflow-card:after{width:7px;height:7px;top:auto;bottom:21px;right:18px}
.editorial-v1 .workflow-card[data-state="focus"]{border-color:${accent}77;box-shadow:0 22px 38px ${bg}99,0 0 0 1px ${accent}44}
.editorial-v1 .workflow-card[data-state="focus"]:before{opacity:1}
.editorial-v1 .workflow-card[data-state="complete"]{border-color:var(--surface-edge)}
.editorial-v1 .workflow-preview{border:0;padding:0;background:var(--bg);align-content:center}
.editorial-v1 .workflow-preview .evidence-frame{height:100%;max-height:100%;width:100%;min-width:0;overflow:hidden}
.editorial-v1 .workflow-preview .evidence-media{width:100%;height:100%;max-height:100%;object-fit:contain}
.editorial-v1 .workflow-preview .layered-evidence{height:auto!important;max-height:none;flex:none}
.editorial-v1 .workflow-preview .layered-evidence .evidence-base{height:100%;object-fit:fill}
.editorial-v1 .workflow-card-copy{padding:14px 20px 16px;opacity:.75;gap:8px}
.editorial-v1 .horizontal-3 .workflow-card-copy,.editorial-v1 .feature-row-4 .workflow-card-copy{display:flex;grid-template-rows:none;justify-content:flex-start;gap:8px}
.editorial-v1 .workflow-card-title{font-size:34px;font-weight:700;line-height:1.45;letter-spacing:-.02em}
.editorial-v1 .workflow-card-sentence{font-size:42px;line-height:1.45;text-wrap:pretty;color:var(--soft-ink)}
.editorial-v1 .workflow-fields{border-top:1px solid ${bg}16;padding-top:8px;gap:4px;margin-top:2px}
.editorial-v1 .workflow-fields li{column-gap:6px}
.editorial-v1 .workflow-fields span,.editorial-v1 .workflow-fields strong{font-size:32px;line-height:1.4}
.editorial-v1 .workflow-fields span{color:var(--soft-ink)}
.editorial-v1 .workflow-fields strong{font-weight:400}
.editorial-v1 .workflow-card[data-state="focus"] .workflow-card-title{color:var(--accent)}
.editorial-v1 .workflow-card[data-state="complete"] .workflow-card-title{color:var(--bg)}
.editorial-v1 .workflow-connectors{inset:22px 20px 18px;width:calc(100% - 40px);height:calc(100% - 40px)}
.editorial-v1 .workflow-connector-track{stroke:var(--fg);opacity:.18;stroke-width:2}
.editorial-v1 .workflow-connector-progress{stroke-width:3;filter:drop-shadow(0 0 4px ${accent}88)}
.editorial-v1 .vertical-3 .workflow-cards{grid-template-rows:minmax(0,.95fr) minmax(0,1fr) minmax(0,1.06fr)}
.editorial-v1 .vertical-3 .workflow-card{padding:0;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:stretch}
.editorial-v1 .vertical-3 .workflow-preview{padding:0;border:0;align-self:stretch}
.editorial-v1 .vertical-3 .workflow-card-copy{justify-content:center;padding:26px}
.editorial-v1.portrait .workflow-card-title{font-size:38px}
.editorial-v1.portrait .workflow-card-sentence{font-size:42px;min-height:0}
.editorial-v1.portrait .workflow-fields span,.editorial-v1.portrait .workflow-fields strong{font-size:32px}
.editorial-v1 .feature-row-4 .workflow-card-sentence{font-size:42px}
.editorial-v1 .feature-row-4 .workflow-card-copy{padding:16px 20px}
.editorial-v1 .feature-row-4 .workflow-card-title{font-size:32px}
.editorial-v1 .feature-row-4 .workflow-fields span,.editorial-v1 .feature-row-4 .workflow-fields strong{font-size:32px}
.editorial-v1 .centered-result .scene-content{gap:24px;grid-template-rows:auto auto minmax(0,1fr)}
.editorial-v1 .centered-result .copy-column{align-items:stretch;text-align:left;gap:18px}
.editorial-v1 .centered-result .copy-column h2{width:100%;font-size:78px;line-height:1.45}
.editorial-v1 .centered-result .signoff{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:20px;width:100%;padding:18px 24px;border:1px solid ${accent}66;border-radius:16px;background:linear-gradient(120deg,${accent}30,${bg}CC);box-shadow:inset 0 1px 0 ${fg}20}
.editorial-v1 .primary-cta{font-size:42px;line-height:1.45;font-weight:700}
.editorial-v1 .display-domain{font-size:42px;line-height:1.4;border-bottom:3px solid var(--highlight);padding:0 0 7px;font-weight:700}
.editorial-v1 .centered-result .evidence-stage{width:100%;padding:0;border:0;border-radius:24px;overflow:visible;background:none;box-shadow:none}
.editorial-v1 .centered-result .media-stack{height:100%;overflow:visible}
.editorial-v1 .centered-result .evidence-frame{width:auto;height:100%;max-height:100%;max-width:100%;border-radius:20px;overflow:hidden;box-shadow:0 22px 48px ${bg}99}
.editorial-v1 .centered-result .evidence-media{width:auto;height:100%;max-width:100%;max-height:100%;object-fit:contain}
.editorial-v1 .centered-result .layered-evidence{width:auto;height:100%!important;max-width:100%;max-height:100%;flex:none}
.editorial-v1 .centered-result .layered-evidence .evidence-base{height:100%;object-fit:fill}
.editorial-v1.portrait .centered-result .signoff{grid-template-columns:1fr;padding:24px}
.editorial-v1.portrait .primary-cta{font-size:42px}
.editorial-v1.portrait .display-domain{font-size:42px;justify-self:start}
.editorial-v1.portrait .centered-result .copy-column h2{font-size:78px}
.editorial-v1.portrait .centered-result .evidence-stage{align-self:center;height:auto;min-height:0}
.editorial-v1.portrait .centered-result .media-stack{height:auto}
.editorial-v1.portrait .centered-result .evidence-frame,.editorial-v1.portrait .centered-result .layered-evidence{width:100%;height:auto!important}
.editorial-v1.portrait .centered-result .evidence-media{width:100%;height:auto}
.editorial-v1 .author-poster-background{filter:blur(18px) brightness(.85);transform:scale(1.04)}
.editorial-v1 .author-reframed .author-poster-background{filter:blur(20px) brightness(.55)}
.editorial-v1 .author-region{position:absolute;margin:0;overflow:hidden;z-index:2}
.editorial-v1 .author-region img{position:absolute;max-width:none;max-height:none}
.editorial-v1.landscape .author-portrait-region{left:0;bottom:0;height:100%;width:auto}
.editorial-v1.landscape .author-information-region{right:4%;top:50%;width:49%;height:auto;transform:translateY(-50%);border-radius:24px;box-shadow:0 20px 80px ${bg}66}
.editorial-v1.portrait .author-portrait-region{left:0;top:0;width:100%;height:auto}
.editorial-v1.portrait .author-information-region{left:5%;bottom:5%;width:90%;height:auto;border-radius:24px;box-shadow:0 20px 80px ${bg}66}
`;
  if (spec.brand.visualStyle === 'editorial-v1') return base;
  // The original ENHE PNG has 208px of optical inset at 682px high; retain its bytes.
  const logoPosition = spec.brand.logoAssetId === 'enhe-logo' ? '-14.64px' : 'left';
  return base.replaceAll('.editorial-v1', '.editorial-v2') + `
.editorial-v2 .brand-header .logo{height:48px;object-position:${logoPosition} center}
.editorial-v2 .caption{font-size:30.8px;line-height:1.45}
.editorial-v2 .workflow-card-copy{padding:14px 20px;gap:6px;opacity:1}
.editorial-v2 .horizontal-3 .workflow-card-copy{gap:6px}
.editorial-v2 .workflow-card-title{font-size:44px;line-height:1.4;letter-spacing:0;font-weight:700}
.editorial-v2 .workflow-card-sentence{font-size:42px;line-height:1.4;letter-spacing:0;text-wrap:pretty;color:var(--bg)}
.editorial-v2 .workflow-fields{padding-top:6px;margin-top:0;gap:0}
.editorial-v2 .workflow-fields li{column-gap:12px;align-items:baseline}
.editorial-v2 .workflow-fields span{font-size:32px;line-height:1.35;color:var(--soft-ink)}
.editorial-v2 .workflow-fields strong{font-size:32px;line-height:1.35;font-weight:400;color:var(--bg)}
.editorial-v2.portrait .workflow-card-copy{padding:14px 20px;gap:6px}
.editorial-v2.portrait .workflow-card-title{font-size:44px}
.editorial-v2 .feature-row-4 .workflow-card-copy{padding:14px 20px;gap:6px}
.editorial-v2 .feature-row-4 .workflow-card-title{font-size:40px}
.editorial-v2 .workflow-card:before{height:3px;right:auto;width:44px;left:24px;top:12px}
`;
}
