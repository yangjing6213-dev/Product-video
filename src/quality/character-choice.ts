// SPDX-License-Identifier: Apache-2.0
import {normalizedRelativePath} from '../assets/library.ts';
export interface CharacterChoiceOptions {
 projectId:string;
 previews:{enhe:{path:string;sha256:string};stickman:{path:string;sha256:string}};
}
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
/** A local choice request, not a forged ACCEPTED decision. Custom images never leave the browser. */
export function renderCharacterChoicePage(options:CharacterChoiceOptions):string{
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(options.projectId))throw Error('Invalid character choice project');
 for(const p of Object.values(options.previews)){normalizedRelativePath(p.path);if(!/\.(mp4|webm)$/.test(p.path)||!/^[a-f0-9]{64}$/.test(p.sha256))throw Error('Choice preview needs a local video and its real hash');}
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src blob: data:; media-src 'self'; connect-src 'none'">
<title>选择演出角色</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#172133;font:17px/1.6 system-ui,sans-serif}main{max-width:1160px;padding:40px 24px;margin:auto}h1{font-size:32px;margin:0 0 8px}h2{font-size:22px;margin:0 0 12px}.lead{color:#526175;max-width:820px}.choices{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:28px 0}section{padding:24px;border:1px solid #cad3df;border-radius:16px;background:white}section:has(input:checked){outline:3px solid #2361cc}video{width:100%;background:#10151a;display:block;margin:18px 0;border-radius:8px}.custom{grid-column:1/-1}input[type=radio],input[type=checkbox]{width:20px;height:20px;vertical-align:middle;margin-right:10px}label{cursor:pointer}button{font:inherit;padding:13px 22px;background:#174fc3;color:white;border:0;border-radius:9px;cursor:pointer}button:disabled{background:#9caabc;cursor:not-allowed}select,input[type=file]{font:inherit;max-width:100%}#upload-preview{max-width:360px;max-height:280px;display:none;margin:15px 0;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0/20px 20px}#status{min-height:32px;font-weight:600}small{color:#526175}footer{border-top:1px solid #ced8e4;padding-top:24px}@media(max-width:760px){.choices{grid-template-columns:1fr}.custom{grid-column:auto}}
</style><main><h1>选择演出角色</h1><p class="lead">先看角色怎样找资料、取起和交接，再选择这次视频的演员。此处只确认角色和动作方向；配音、文案及作者片尾沿用已确认版本。</p>
<p>任务：${escape(options.projectId)} · 当前状态：待用户审核</p><div class="choices">
<section><h2><label><input type="radio" name="cast" value="enhe">TUOTUO 与 XINBI</label></h2><p>新可动衍生版；原图获认可不等于本版已通过。</p><video controls playsinline preload="metadata" src="${escape(options.previews.enhe.path)}"></video><small>透明轮廓 · 连续关节 · 单实景背景</small></section>
<section><h2><label><input type="radio" name="cast" value="stickman">火柴人</label></h2><p>同一段剧情与轨迹，便于比较角色的表达。</p><video controls playsinline preload="metadata" src="${escape(options.previews.stickman.path)}"></video><small>深色场景使用白线，提高可读性；颜色需随实景调整。</small></section>
<section class="custom"><h2><label><input type="radio" name="cast" value="custom">自定义 IP 图片</label></h2><p>在本机选图，预览透明度。整张图片尚不能完成关节表演，下一步需准备可动部件及动作样片，再审核。</p><label>选择 PNG、WebP 或 JPEG：<input id="upload" type="file" accept="image/png,image/webp,image/jpeg"></label><img id="upload-preview" alt="自定义角色原图预览"><p id="alpha"></p><label><input id="rights" type="checkbox">我有权将这张图片用于本项目视频</label></section></div>
<label><input id="watched" type="checkbox">我已查看所选角色及动作样片（自定义图片为确认继续准备）</label><p><button id="save" disabled>保存本次选择</button></p><p id="status" role="status" aria-live="polite">请选择角色。没有默认确认项。</p><footer><small>文件只在本机预览，不上传。保存的是选择请求；正式生产还会核对素材、动作预览及审核记录。自定义单张图片不会被标记为已通过动作 QA。</small></footer></main>
<script>
const config=${JSON.stringify(options).replaceAll('<','\\u003c')};let upload=null,url=null;
const $=id=>document.getElementById(id),mode=()=>document.querySelector('input[name=cast]:checked')?.value;
function update(){const m=mode();$('save').disabled=!(m&&$('watched').checked&&(m!=='custom'||upload&&$('rights').checked));$('status').textContent=m==='custom'?'自定义角色：待准备可动部件及动作审核。':m?'请查看样片后保存选择。':'请选择角色。没有默认确认项。';}
document.querySelectorAll('input').forEach(el=>el.addEventListener('change',update));
document.querySelectorAll('input[name=cast]').forEach(el=>el.addEventListener('change',()=>{$('watched').checked=false;update();}));
$('upload').addEventListener('change',async()=>{upload=null;$('watched').checked=false;update();const file=$('upload').files[0];if(!file)return;
try{if(!['image/png','image/webp','image/jpeg'].includes(file.type)||file.size>20*1024*1024)throw Error('请选择20MB以内的PNG、WebP或JPEG。');
const data=await file.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(file);const img=$('upload-preview');img.src=url;await img.decode();if(img.naturalWidth*img.naturalHeight>20000000)throw Error('图片分辨率过大，请提供2000万像素以内的预览副本。');
const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let transparent=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]===0)transparent++;
img.style.display='block';const fraction=transparent/(canvas.width*canvas.height);$('alpha').textContent='原图 '+canvas.width+' × '+canvas.height+'；完全透明像素 '+(fraction*100).toFixed(1)+'%。'+(fraction<=.05?' 需要先处理外部底色。':' 仍需检查边缘和可动部件。');upload={name:file.name,sha256:hash,transparentFraction:fraction,status:'PREPARATION_REQUIRED'};update();
}catch(error){$('alpha').textContent=error.message;upload=null;update();}});
$('save').addEventListener('click',()=>{if($('save').disabled)return;const m=mode(),request={schemaVersion:'1.0',projectId:config.projectId,mode:m,requestType:m==='custom'?'PREPARE_CUSTOM':'REVIEWED_DIRECTION',preview:m==='custom'?null:config.previews[m],custom:upload&&m==='custom'?upload:null,userRequestedAt:new Date().toISOString(),productionApproval:false};const blob=new Blob([JSON.stringify(request,null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='character-choice-request.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);$('status').textContent='已保存选择请求。请将文件路径或选择结果发回当前任务；正式生产审核尚未自动通过。';});
</script></html>`;
}
