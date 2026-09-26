// SPDX-License-Identifier: Apache-2.0
export function renderCoverPlayer(title: string, video: string, poster: string): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#10161f;color:#f5f7fa;font:16px/1.6 system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:32px 20px}h1{font-size:clamp(22px,3vw,32px);margin:0 0 6px}p{color:#bfc9d7;margin:0 0 22px}video{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#10161f;border-radius:12px}a{color:#b5d9ff}button{margin-top:16px;padding:12px 24px;border:1px solid #73baff;border-radius:8px;background:#142e48;color:#fff;font:inherit;cursor:pointer}footer{display:flex;flex-wrap:wrap;gap:12px 24px;margin-top:20px}video:focus-visible,a:focus-visible,button:focus-visible{outline:3px solid #73baff;outline-offset:4px}@media(max-width:600px){main{padding:20px 12px}}</style></head>
<body><main><h1>${escape(title)}</h1><p>点击播放，看看如何把产品介绍变成视频。 / Press play to see how it works.</p>
<video controls playsinline preload="none" poster="${escape(poster)}" src="${escape(video)}" aria-label="${escape(title)}">当前浏览器无法播放视频，请使用下方下载链接。</video>
<button id="start" type="button" hidden>播放视频 / Play video</button><p id="play-error" role="alert" hidden>暂时无法播放，请重试或下载视频。 / Please retry or download the video.</p>
<footer><a href="${escape(video)}" download>下载视频 / Download video</a><a href="${escape(poster)}" download>下载封面 / Download cover</a></footer></main>
<script>const video=document.querySelector('video'),start=document.querySelector('#start'),error=document.querySelector('#play-error');
video.controls=false;start.hidden=false;
async function play(){error.hidden=true;video.controls=true;try{await video.play();start.hidden=true;}catch{video.controls=false;error.hidden=false;start.hidden=false;}}
start.addEventListener('click',play);video.addEventListener('click',()=>{if(!video.controls)void play();});
video.addEventListener('play',()=>{video.controls=true;start.hidden=true;});</script></body></html>`;
}
