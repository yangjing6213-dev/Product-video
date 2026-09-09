import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { validateSpec } from '../src/contracts.ts';
import { validateNarrationCues, validatePhraseTranscript, validateTranscriptTiming } from '../src/qa/narration.ts';
import { digest } from '../src/pipeline/stage-state.ts';
import { probeMedia } from '../src/pipeline/media.ts';

// Codex-authored benchmark composition builder. Narrative/design remain authored artifacts.
// The production CLI never invokes this creative layout helper automatically.
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('Supply benchmark project identifiers');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
for (const id of ids) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid benchmark id');
  const project = path.resolve('projects', id);
  await readFile(path.join(project, 'DESIGN.md'), 'utf8');
  await readFile(path.join(project, 'STORYBOARD.md'), 'utf8');
  const spec = validateSpec(JSON.parse(await readFile(path.join(project, 'video-spec.json'), 'utf8')));
  const narrated = spec.audio.narrationMode !== 'none';
  let narrationCues = [], transcript = [], audioPath = '', audioDuration = 0;
  if (narrated) {
    audioPath = spec.assets.find(asset => asset.id === spec.audio.externalAudioAssetId)?.path;
    if (!audioPath) throw new Error('Narrated benchmark requires a declared local audio asset');
    const audioFile = path.join(project, audioPath);
    const probe = await probeMedia(audioFile, project, 'ffprobe-narration');
    audioDuration = Number(probe.format?.duration);
    const evidence = validateNarrationCues(JSON.parse(await readFile(path.join(project,'reports/narration-cues.json'),'utf8')),spec,digest(await readFile(audioFile)),audioDuration);
    transcript = validateTranscriptTiming(JSON.parse(await readFile(path.join(project,'transcript.json'),'utf8')),audioDuration);
    validatePhraseTranscript(transcript,evidence);
    narrationCues = evidence.cues;
  }
  const light = spec.brand.canvas === 'light';
  const colors = spec.brand.colors;
  const bg = colors[0], fg = colors[1], accent = colors[2], muted = colors[3] ?? fg, panel = colors[4] ?? bg;
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await copyFile('node_modules/gsap/dist/gsap.min.js', path.join(project, 'assets/gsap.min.js'));
  const logo = spec.assets.find(a => a.id === spec.brand.logoAssetId);
  const scenes = spec.scenes.map((scene, index) => {
    const beforeAfter = scene.recipe === 'before-after.v1' && scene.assetRefs.length >= 2;
    const images = scene.assetRefs.map(ref => spec.assets.find(a => a.id === ref)).filter(a => a && (beforeAfter ? ['logo','image','screenshot'] : ['image','screenshot']).includes(a.type));
    const title = scene.onScreenText[0] ?? scene.goal;
    const body = scene.onScreenText.slice(1).filter(text => text !== spec.product.cta.url && text !== spec.product.cta.url.replace(/^https?:\/\//,''));
    const final = index === spec.scenes.length - 1;
    const layout = index === 0 || final ? 'split' : images.length ? 'showcase' : 'statement';
    const duration = scene.plannedDurationSec + (final ? 0 : .5);
    const comparison = beforeAfter && images.length >= 2 ? `<div class="visual-wrap entrance-media"><div class="comparison">${images.slice(0,2).map((a,i) => `<div class="comparison-item"><p>${i ? '之后 · 品牌主视觉' : '之前 · 输入 Logo'}</p><div class="media-crop"><img class="${i ? 'evidence' : 'source-logo'}" src="${escape(a.path)}" alt="${escape(a.id)}" /></div></div>`).join('')}</div><p class="asset-label">真实输入与授权示例 · 保持品牌几何</p></div>` : '';
    const focused = images[0]?.id === 'capture-task-paths' ? `<div class="visual-wrap entrance-media"><div class="focus-window" role="img" aria-label="官网四类任务入口" style="background-image:url('${escape(images[0].path)}')"></div><p class="asset-label">官网真实任务入口 · 局部聚焦</p></div>` : '';
    const wordmark = final && logo?.path.endsWith('.svg') ? `<div class="visual-wrap entrance-media"><div class="brand-end"><strong class="end-wordmark">${escape(spec.product.name)}</strong></div></div>` : '';
    const visual = final && logo ? `<div class="visual-wrap entrance-media"><div class="brand-end"><img class="end-logo" src="${escape(logo.path)}" alt="${escape(spec.product.name)}" /></div></div>` : images.length ? `<div class="visual-wrap entrance-media"><div class="media-crop"><img class="evidence" src="${escape(images[0].path)}" alt="${escape(images[0].id)}" /></div><p class="asset-label">${escape(index === 0 ? '真实产品 · 本地演示' : '真实项目素材')}</p></div>` : `<div class="idea-panel entrance-media"><span class="large-number">0${index+1}</span><div class="idea-rule"></div><p>${escape(body[0] ?? spec.product.oneLiner)}</p></div>`;
    return `<section id="${scene.id}" class="clip scene ${layout} scene-${index}" data-start="${scene.actualStartSec}" data-duration="${duration}" data-track-index="${index + 1}" style="z-index:${index + 1}">
      <div class="scene-content">
        <header class="brand-row"><div class="brand entrance-brand">${logo ? `<img class="logo" src="${escape(logo.path)}" alt="${escape(spec.product.name)}" />` : ''}<span>${escape(spec.product.name)}</span></div><span class="counter entrance-counter">0${index+1} / 0${spec.scenes.length}</span></header>
        <main class="body-grid"><div class="copy"><p class="eyebrow entrance-eyebrow">${escape(['看见结果','解决一个问题','聚焦核心能力','看看实际过程','让结果可复用','开始你的下一步'][index])}</p><h1 class="entrance-title">${escape(title)}</h1><div class="detail entrance-detail">${body.map(text => `<p>${escape(text)}</p>`).join('')}${final ? `<p class="cta-url">${escape(spec.product.cta.url.replace(/^https?:\/\//,''))}</p>` : ''}</div><div class="accent-rule entrance-rule"></div></div>${visual}</main>
        <footer class="caption-row">${narrated ? '<div class="caption-stack"></div>' : `<p class="caption entrance-caption">${escape(scene.caption ?? scene.voiceover ?? '')}</p>`}<span class="mode-label entrance-mode">${narrated ? '中文旁白 · 同步字幕' : '无旁白 · 字幕版'}</span></footer>
      </div>
    </section>`.replace(visual, comparison || focused || wordmark || visual);
  }).join('\n');
  const animations = spec.scenes.map((scene, index) => {
    const s = scene.actualStartSec;
    const hasEvidence = index !== spec.scenes.length - 1 && !scene.assetRefs.includes('capture-task-paths') && scene.assetRefs.some(ref => spec.assets.some(a => a.id === ref && ['image', 'screenshot'].includes(a.type)));
    return `${index ? `tl.from('#${scene.id}', {clipPath:'inset(0 100% 0 0)',duration:0.5,ease:'power2.inOut'},${s});` : ''}
tl.from('#${scene.id} .entrance-brand',{x:-18,opacity:0,duration:0.45,ease:'power2.out'},${s+.10});
tl.from('#${scene.id} .entrance-counter',{opacity:0,duration:0.35,ease:'sine.out'},${s+.15});
tl.from('#${scene.id} .entrance-eyebrow',{x:-24,opacity:0,duration:0.45,ease:'power3.out'},${s+.18});
tl.from('#${scene.id} .entrance-title',{y:38,opacity:0,duration:0.65,ease:'expo.out'},${s+.23});
tl.from('#${scene.id} .entrance-detail',{y:16,opacity:0,duration:0.55,ease:'power2.out'},${s+.36});
tl.from('#${scene.id} .entrance-rule',{scaleX:0,transformOrigin:'left',duration:0.65,ease:'power3.out'},${s+.40});
tl.from('#${scene.id} .entrance-media',{x:${index%2 ? -32:32},opacity:0,duration:0.75,ease:'power4.out'},${s+.30});
${narrated ? '' : `tl.from('#${scene.id} .entrance-caption',{y:12,opacity:0,duration:0.45,ease:'sine.out'},${s+.48});`}
tl.from('#${scene.id} .entrance-mode',{opacity:0,duration:0.40,ease:'power1.out'},${s+.55});
${hasEvidence ? index%2 ? `tl.to('#${scene.id} .evidence',{x:-8,duration:${scene.plannedDurationSec-1},ease:'sine.inOut'},${s+1});` : `tl.to('#${scene.id} .evidence',{scale:1.025,duration:${scene.plannedDurationSec-1},ease:'sine.inOut'},${s+1});` : ''}`;
  }).join('\n');
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920,height=1080"><title>${escape(spec.product.name)} · 产品推广</title><script src="assets/gsap.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}html,body{width:1920px;height:1080px;overflow:hidden;background:${bg};color:${fg};font-family:"Microsoft YaHei","Segoe UI",sans-serif}#root{position:relative;width:1920px;height:1080px;background:${bg}}.scene{position:absolute;inset:0;background:${bg};width:100%;height:100%}.scene-content{width:100%;height:100%;padding:82px 140px 84px;display:flex;flex-direction:column;gap:25px}.brand-row{height:68px;flex:none;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${muted};padding-bottom:16px}.brand{display:flex;align-items:center;gap:20px;max-width:1350px;font-size:26px;font-weight:700}.logo{width:72px;height:48px;object-fit:contain}.counter{font-family:"Segoe UI",sans-serif;font-size:22px;color:${muted};font-variant-numeric:tabular-nums}.body-grid{flex:1;min-height:0;display:grid;grid-template-columns:0.92fr 1.08fr;gap:56px;align-items:center}.copy{display:flex;flex-direction:column;gap:24px;min-width:0}.eyebrow{font-size:24px;color:${accent};font-weight:700;letter-spacing:3px}h1{font-size:70px;line-height:1.20;font-weight:900;letter-spacing:-2px;overflow-wrap:anywhere;max-width:100%}.detail{font-size:30px;line-height:1.55;color:${muted};display:flex;flex-direction:column;gap:12px}.accent-rule{width:120px;height:5px;background:${accent};margin-top:10px}.visual-wrap{display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0}.media-crop{overflow:hidden;border:1px solid ${muted};border-radius:16px;background:${panel};display:flex;align-items:center;justify-content:center;padding:0;max-height:565px;min-height:300px}.evidence{width:100%;height:auto;max-height:560px;object-fit:contain;display:block}.asset-label{color:${muted};font-size:20px;line-height:1.3}.caption-row{flex:none;min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:32px;border-top:1px solid ${muted};padding-top:20px}.caption{font-size:28px;line-height:1.45;max-width:1360px;color:${fg}}.mode-label{font-size:18px;white-space:nowrap;color:${muted}}.cta-url{font-size:25px;color:${accent};overflow-wrap:anywhere;max-width:670px}.idea-panel{background:${panel};padding:44px;border:1px solid ${muted};border-radius:18px;display:flex;flex-direction:column;gap:26px}.large-number{color:${accent};font-size:130px;line-height:1;font-weight:300}.idea-rule{height:2px;width:140px;background:${accent}}.idea-panel p{font-size:34px;line-height:1.5}.showcase .body-grid{grid-template-columns:0.66fr 1.34fr;gap:38px}.showcase h1{font-size:62px}.showcase .detail{font-size:26px}.showcase .media-crop{max-height:640px}.showcase .evidence{max-height:615px}.statement h1{font-size:76px}${light ? '.media-crop{border-radius:4px}.idea-panel{border-radius:4px}.scene-content{gap:28px}' : ''}
@font-face{font-family:'Microsoft YaHei';src:local('Microsoft YaHei');font-weight:100 900}@font-face{font-family:'Segoe UI';src:local('Segoe UI');font-weight:100 900}h1{line-height:1.5}.large-number{line-height:1.3}.media-crop{padding:18px}.brand-end{display:flex;justify-content:center;align-items:center;min-height:440px;border-top:2px solid ${accent};border-bottom:2px solid ${accent}}.end-logo{width:400px;height:270px;object-fit:contain}${light ? `.eyebrow,.cta-url{color:${fg}}` : ''}
.comparison{display:grid;grid-template-columns:1fr 1fr;gap:22px}.comparison-item{display:flex;flex-direction:column;gap:18px;min-width:0}.comparison-item>p{font-size:26px;color:${fg}}.comparison .media-crop{height:455px;min-height:0;padding:20px}.comparison .evidence{max-height:410px}.source-logo{width:90%;height:210px;object-fit:contain}
.brand-end{background:${panel};padding:40px}.end-wordmark{font-size:64px;line-height:1.45;font-weight:700;overflow-wrap:anywhere;text-align:center}.focus-window{width:100%;height:540px;border:1px solid ${muted};border-radius:16px;background-size:153.8% auto;background-position:50% 64%;background-repeat:no-repeat}
${narrated ? '.caption-stack{flex:1;min-width:0;display:grid}.narration-caption{grid-area:1/1;opacity:0;max-width:100%}' : ''}
</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="${spec.output.targetDurationSec}" data-width="1920" data-height="1080" data-fps="30" data-track-index="0">${scenes}${narrated ? `<audio id="narration" class="clip" src="${escape(audioPath)}" data-start="0" data-duration="${audioDuration}" data-track-index="20" data-volume="1"></audio>` : ''}</div><script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
${animations}
${narrated ? `var NARRATION_CUES = ${JSON.stringify(narrationCues).replaceAll('<','\\u003c')};
var TRANSCRIPT = ${JSON.stringify(transcript).replaceAll('<','\\u003c')};
NARRATION_CUES.forEach((cue,index)=>{
  const caption=document.createElement('p');
  caption.className='caption narration-caption';
  caption.id='narration-caption-'+index;
  caption.dataset.captionStart=String(cue.start);
  caption.dataset.captionEnd=String(cue.end);
  caption.textContent=cue.text;
  document.querySelector('#'+cue.sceneId+' .caption-stack').append(caption);
  tl.set(caption,{opacity:1},cue.start);
  tl.set(caption,{opacity:0},cue.end);
});` : ''}
window.__timelines.main=tl;
</script></body></html>\n`;
  await writeFile(path.join(project, 'index.html'), html);
  await writeFile(path.join(project, 'hyperframes.json'), JSON.stringify({ $schema:'https://hyperframes.heygen.com/schema/hyperframes.json',paths:{blocks:'compositions',components:'compositions/components',assets:'assets'},media:{autoProxy:false}},null,2)+'\n');
  console.log(project);
}
