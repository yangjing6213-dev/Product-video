// SPDX-License-Identifier: Apache-2.0
import type { Asset, ProductInput, Scene, VideoSpec } from '../contracts.ts';
import { renderPerformance, compilePerformance, type Performance } from './performance.ts';

export type CharacterPoses = { idle: [number, number, number, number]; explain: [number, number, number, number] };
export interface CharacterStage {
  performance?: Performance;
  layout: 'gather' | 'sequence' | 'timeline' | 'result';
  actors: Array<{ assetId: string; side: 'left' | 'right' }>;
  panels: Array<{ id: string; textIndices: number[]; assetId?: string }>;
  beats: Array<{ frame: number; actor: number; pose: keyof CharacterPoses; panelId: string }>;
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const escape = (s: string): string => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const n = (v: number): string => String(Number(v.toFixed(5)));

/** Production also verifies these selected bytes against the job's approved frozen manifest. */
export function validateCharacterSelection(input: ProductInput): Asset[] {
  if (input.brand.presentation !== 'character') return [];
  const actors=input.assets.filter(asset=>asset.characterPoses || asset.characterRig);
  const brandActors=actors.filter(asset=>!asset.characterRig || ['tuotuo','xinbi'].includes(asset.characterRig.kind));
  if (!actors.length || (brandActors.length && !input.brandLibrary?.selections.length)) throw new Error('Character mode requires actors from the pinned approved brand library');
  for (const actor of brandActors) {
    const selected=input.brandLibrary!.selections.find(item=>item.assetId===actor.id);
    if (!selected || !/^[0-9a-f]{64}$/.test(selected.sha256) || !selected.contentVersion) throw new Error(`Character actor is not selected with a pinned version: ${actor.id}`);
  }
  return brandActors;
}

export function validateCharacterCopy(spec: VideoSpec): void {
  if (spec.brand.presentation !== 'character') return;
  for (const scene of spec.scenes.filter(scene=>!scene.authorPosterAssetId)) validateBilingualScene(scene);
  const ending=spec.scenes.filter(scene=>!scene.authorPosterAssetId).at(-1);
  const marketing=spec.generatorPolicy?.marketing;
  if (marketing && (!ending?.onScreenText.includes(marketing.screenAction) || !ending.onScreenText.includes(marketing.displayDomain))) throw new Error('Character ending requires the exact visible CTA and website in reviewed bilingual copy');
}

export function validateCharacterStage(stage: CharacterStage, durationFrames: number, refs: readonly string[], assets: readonly Asset[], screenCount?: number): void {
  if (!stage || !['gather','sequence','timeline','result'].includes(stage.layout)) throw new Error('Character stage requires a supported layout');
  if (!stage.actors?.length || stage.actors.length > 2 || new Set(stage.actors.map(a=>a.side)).size !== stage.actors.length) throw new Error('Character stage requires one or two uniquely positioned actors');
  const available = (id: string): Asset => {
    const asset=assets.find(a=>a.id===id);
    if (!ID.test(id) || !refs.includes(id) || !asset || !['image','screenshot'].includes(asset.type) || !['owned','authorized'].includes(asset.license)) throw new Error('Character stage requires a declared authorized image asset');
    return asset;
  };
  for (const actor of stage.actors) {
    const asset=available(actor.assetId);
    if(stage.performance && asset.characterRig) continue;
    if (!['left','right'].includes(actor.side) || !asset.width || !asset.height || !asset.characterPoses) throw new Error('Character actor requires real atlas dimensions and pose bounds');
    for (const pose of ['idle','explain'] as const) {
      const box=asset.characterPoses[pose];
      if (!box || box.length!==4 || !box.every(Number.isFinite)) throw new Error('Character pose requires four finite crop bounds');
      const [l,t,r,b]=box;
      if (l<0||t<0||r<=l||b<=t||r>asset.width||b>asset.height) throw new Error('Character pose crop exceeds the original atlas');
    }
  }
  if (!stage.panels?.length || stage.panels.length>4 || new Set(stage.panels.map(p=>p.id)).size!==stage.panels.length) throw new Error('Character panels require one to four unique IDs');
  const used=new Set<number>();
  for (const panel of stage.panels) {
    if (!ID.test(panel.id) || !panel.textIndices?.length || panel.textIndices.length>4) throw new Error('Character panel requires a safe ID and meaningful text');
    for (const index of panel.textIndices) {
      if (!Number.isSafeInteger(index)||index<1||(screenCount!==undefined&&index>=screenCount)) throw new Error('Character panel text index is outside the reviewed text');
      used.add(index);
    }
    if (panel.assetId) available(panel.assetId);
  }
  if (screenCount!==undefined && used.size!==screenCount-1) throw new Error('Every character screen line must be displayed in its reviewed bilingual pair');
  let previous=-1;
  if (!stage.beats?.length) throw new Error('Character stage needs at least one semantic beat');
  for (const beat of stage.beats) {
    if (!Number.isSafeInteger(beat.frame)||beat.frame<=previous||beat.frame<0||beat.frame+18>durationFrames || !Number.isSafeInteger(beat.actor)||!stage.actors[beat.actor] || !['idle','explain'].includes(beat.pose) || !stage.panels.some(p=>p.id===beat.panelId)) throw new Error('Character beat timing, actor or target is invalid');
    previous=beat.frame;
  }
}

export function validateBilingualScene(scene: Scene): void {
  const copy=scene.bilingual;
  if (!copy || copy.onScreenText.length!==scene.onScreenText.length || copy.onScreenText.some(t=>typeof t!=='string'||!t.trim()) || typeof copy.subtitle!=='string' || (scene.voiceover.trim() && !copy.subtitle.trim())) throw new Error('Character scenes require complete reviewed English screen pairs and subtitle translation');
  if (scene.authorPosterAssetId || scene.workflow) throw new Error('Character stage cannot replace the frozen author poster or combine with workflow cards');
}

function pair(scene: Scene,index: number,heading=false,role=''): string {
  const zh=escape(scene.onScreenText[index]!),en=escape(scene.bilingual!.onScreenText[index]!);
  return `<div class="character-text-pair" data-bilingual-pair="${index}">${heading?`<h2 lang="zh-CN">${zh}</h2>`:`<p lang="zh-CN"${role?` class="${role}"`:''}>${zh}</p>`}${zh===en?'':`<p lang="en" class="character-english">${en}</p>`}</div>`;
}

/** Pose views crop the original atlas through CSS. No source raster is modified. */
export function renderCharacterStage(scene: Scene, assets: ReadonlyMap<string, Asset>, marketing?: {screenAction:string;displayDomain:string}): string {
  if(scene.character?.performance) return renderPerformance(scene,assets);
  const stage=scene.character!;
  const actors=stage.actors.map((actor,index)=>{
    const asset=assets.get(actor.assetId)!;
    const bounds=Object.values(asset.characterPoses!);
    const frameWidth=Math.max(...bounds.map(([l,,r])=>r-l)),frameHeight=Math.max(...bounds.map(([,t,,b])=>b-t));
    const views=(['idle','explain'] as const).map(pose=>{
      const [l,t,r,b]=asset.characterPoses![pose],w=r-l,h=b-t;
      const style=`width:${n(asset.width!/w*100)}%;height:${n(asset.height!/h*100)}%;left:${n(-l/w*100)}%;top:${n(-t/h*100)}%`;
      const crop=`width:${n(w/frameWidth*100)}%;height:${n(h/frameHeight*100)}%;left:${n((frameWidth-w)/2/frameWidth*100)}%;top:${n((frameHeight-h)/frameHeight*100)}%`;
      return `<div class="character-pose" data-character-pose="${pose}" style="--character-aspect:${n(frameWidth/frameHeight)};opacity:${pose==='idle'?1:0}"><div class="character-crop" style="${crop}"><img data-layout-allow-overflow src="${escape(asset.path)}" alt="" style="${style}"></div></div>`;
    }).join('');
    return `<figure class="character-actor character-${actor.side}" data-character-actor="${index}" data-character-color="${asset.characterColor ?? 'monochrome'}" data-asset-id="${escape(asset.id)}" aria-label="${escape(actor.assetId)}">${views}</figure>`;
  }).join('');
  const panels=stage.panels.map((panel,index)=>{
    const asset=panel.assetId?assets.get(panel.assetId):undefined;
    const media=asset?`<figure class="character-product-preview"><img src="${escape(asset.path)}" data-asset-id="${escape(asset.id)}" alt="${escape(scene.onScreenText[panel.textIndices[0]!]!)}"></figure>`:'';
    return `<article class="character-panel" data-character-panel="${escape(panel.id)}"><span class="character-step" data-text-role="label" aria-hidden="true">${String(index+1).padStart(2,'0')}</span>${media}${panel.textIndices.map(i=>pair(scene,i,false,scene.onScreenText[i]===marketing?.screenAction?'primary-cta':scene.onScreenText[i]===marketing?.displayDomain?'display-domain':'')).join('')}</article>`;
  }).join('');
  return `<div class="character-heading">${pair(scene,0,true)}</div><div class="character-stage character-layout-${stage.layout}" data-character-stage>${actors}<div class="character-board"><div class="character-path" aria-hidden="true"><span></span></div><div class="character-panels">${panels}</div></div></div>`;
}

export function compileCharacterStage(stage: CharacterStage, sceneId: string, startFrame: number, fps: number, timeline='tl'): string {
  if(stage.performance) return compilePerformance(stage.performance,sceneId,startFrame,fps,timeline);
  const at=(frame:number)=>n((startFrame+frame)/fps);
  const s=(suffix:string)=>JSON.stringify(`#${sceneId} ${suffix}`);
  const lines=[`${timeline}.from(${s('.character-heading')},{y:12,opacity:0,duration:.45,ease:"power2.out"},${at(6)});`,`${timeline}.from(${s('.character-actor')},{y:18,opacity:0,duration:.55,ease:"sine.out"},${at(9)});`,`${timeline}.from(${s('.character-panel')},{y:20,opacity:0,stagger:.08,duration:.5,ease:"power3.out"},${at(12)});`];
  stage.beats.forEach((beat,index)=>{
    const actor=`[data-character-actor="${beat.actor}"]`,panel=`[data-character-panel="${beat.panelId}"]`;
    for (const pose of ['idle','explain'] as const) lines.push(`${timeline}.to(${s(`${actor} [data-character-pose="${pose}"]`)},{opacity:${beat.pose===pose?1:0},duration:${n(1/fps)},ease:"none"},${at(beat.frame)});`);
    lines.push(`${timeline}.to(${s(panel)},{y:-10,borderColor:"#111111",backgroundColor:"#FFFFFF",duration:.45,ease:"power2.out"},${at(beat.frame)});`);
    lines.push(`${timeline}.to(${s('.character-path span')},{scaleX:${n((stage.panels.findIndex(p=>p.id===beat.panelId)+1)/stage.panels.length)},duration:.6,ease:"power2.inOut"},${at(beat.frame)});`);
    if(index>0){const previous=stage.beats[index-1]!;if(previous.panelId!==beat.panelId)lines.push(`${timeline}.to(${s(`[data-character-panel="${previous.panelId}"]`)},{y:0,backgroundColor:"#FFFFFF",duration:.45,ease:"sine.inOut"},${at(beat.frame)});`);}
  });
  return lines.join('\n');
}

export const characterCss = `
.sketch-v1 .scene-clip:first-child .scene{opacity:1;visibility:visible}
.sketch-v1 .character-scene .scene-background{opacity:1;filter:brightness(.48) saturate(.7)}
.sketch-v1 .character-scene:has(.scene-background) .scene-content:before{content:"";position:absolute;inset:42px 82px 168px;z-index:-1;background:rgba(255,255,255,.94);border:1px solid #FFFFFF;border-radius:20px}
.sketch-v1:has(.scene-background) .caption{color:#FFFFFF;text-shadow:0 1px 2px #000000}
.sketch-v1 .character-scene .scene-content{display:flex;flex-direction:column;gap:18px;padding:72px 120px 190px}
.sketch-v1 .character-scene .brand-header{flex:0 0 64px;justify-content:flex-start}
.sketch-v1 .character-scene .brand-header .logo{width:175px;height:56px;max-height:56px;filter:brightness(0);object-fit:contain;object-position:left center}
.sketch-v1 .character-scene .brand-header .logo[data-asset-id="enhe-logo"]{object-position:-17.08px center}
.sketch-v1 .character-scene .brand-header .product-name{display:none}
.character-heading{flex:0 0 auto;max-width:100%;min-width:0}
.character-text-pair{min-width:0;display:flex;flex-direction:column;gap:5px}
.character-text-pair h2{margin:0;font-size:64px;line-height:1.5;font-weight:700;font-style:normal;letter-spacing:-.02em}
.character-text-pair p{margin:0;font-size:36px;line-height:1.5;overflow-wrap:anywhere}
.character-text-pair .character-english{font-size:25px;line-height:1.5;color:#111111}
.character-heading .character-english{font-size:29px}
.character-stage{flex:1;min-height:0;display:grid;grid-template-columns:minmax(200px,300px) minmax(0,1fr) minmax(200px,300px);gap:24px;align-items:end}
.character-actor{position:relative;grid-row:1;height:100%;max-height:430px;margin:0;display:grid;align-items:end;min-width:0;isolation:isolate;container-type:size}
.character-left{grid-column:1}.character-right{grid-column:3}
.character-pose{grid-area:1/1;width:min(100cqw,calc(100cqh * var(--character-aspect)));aspect-ratio:var(--character-aspect);position:relative;justify-self:center;align-self:end}
.character-crop{position:absolute;overflow:hidden}
.character-pose img{position:absolute;max-width:none;object-fit:fill;filter:grayscale(1)}
.character-actor[data-character-color="original"] img{filter:none}
.character-board{grid-row:1;grid-column:2;align-self:center;min-width:0;display:flex;flex-direction:column;gap:26px}
.character-path{height:4px;background:none;border-top:1px dashed #111111;overflow:hidden}
.character-path span{display:block;width:100%;height:100%;background:#111111;transform:scaleX(0);transform-origin:left center}
.character-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px;align-items:stretch}
.character-panel{position:relative;min-width:0;border:2px solid #111111;border-radius:13px;background:#FFFFFF;padding:22px 20px;display:flex;flex-direction:column;gap:16px;box-shadow:none}
.character-step{font-size:24px;font-weight:700;color:#111111;font-variant-numeric:tabular-nums}
.character-product-preview{height:150px;margin:0;min-height:0;display:grid;place-items:center;overflow:hidden}
.character-product-preview img{width:100%;height:100%;object-fit:contain}
.character-layout-gather .character-panel:nth-child(odd){rotate:-2deg}
.character-layout-timeline .character-panels{grid-template-columns:1fr}
.character-layout-timeline .character-panel{display:grid;grid-template-columns:40px repeat(auto-fit,minmax(150px,1fr));align-items:center;padding:14px 18px;gap:14px}
.character-layout-result .character-panels{grid-template-columns:1fr}
.sketch-v1 .caption{font-size:30.8px;bottom:112px;line-height:1.35;text-shadow:none}
.sketch-v1 .english-caption{font-size:25px;bottom:70px;line-height:1.3;color:#111111;max-height:none}
.sketch-v1 .caption,.sketch-v1 .english-caption{left:120px;right:120px;background:none;box-shadow:none}
.portrait.sketch-v1 .character-scene .scene-content{padding:72px 60px 245px}
.portrait .character-stage{grid-template-columns:1fr 1fr;grid-template-rows:minmax(0,1fr) 310px;gap:28px}
.portrait .character-board{grid-column:1/-1;grid-row:1;width:100%}
.portrait .character-actor{grid-row:2;height:310px;width:270px;justify-self:center}
.portrait .character-left{grid-column:1}.portrait .character-right{grid-column:2}
.portrait .character-panels{grid-template-columns:1fr 1fr}
.portrait.sketch-v1 .caption{bottom:145px}.portrait.sketch-v1 .english-caption{bottom:55px;left:60px;right:60px}
`;
