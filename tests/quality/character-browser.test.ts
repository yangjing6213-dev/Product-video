// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { environment } from '../../src/pipeline/tools.ts';
import { compileCharacterStage, characterCss } from '../../src/quality/character.ts';
import { composeVideo } from '../../src/quality/composition.ts';
import { browserMotionQa } from '../../src/qa/motion.ts';
import { characterFixture } from '../fixtures/character.ts';
import { requireFixtureFont, writeBrowserAssets, FIXTURE_FONTS, TEST_CJK_FONT } from '../fixtures/browser-assets.ts';

test('exact character beat boundaries match forward, reverse and fresh GSAP seeks',async()=>{
 const env=await environment(),browser=await puppeteer.launch({executablePath:env.HYPERFRAMES_BROWSER_PATH,headless:true});
 try{const page=await browser.newPage();
 const scene=characterFixture().scenes[0]!,stage=scene.character!;
 await page.setContent(`<style>${characterCss}</style><div id="${scene.id}"><div class="character-heading"></div><div class="character-actor" data-character-actor="0"><div data-character-pose="idle" style="opacity:1"></div><div data-character-pose="explain" style="opacity:0"></div></div><div class="character-path"><span></span></div>${stage.panels.map(p=>`<div class="character-panel" data-character-panel="${p.id}"></div>`).join('')}</div>`);
 await page.addScriptTag({path:path.resolve('node_modules/gsap/dist/gsap.min.js')});
 const source=`(()=>{const tl=gsap.timeline({paused:true});${compileCharacterStage(stage,scene.id,0,30)}window.timeline=tl;})();void 0;`;
 await page.evaluate(source);
 const sample=async(t:number)=>page.evaluate(time=>{(window as any).timeline.seek(time,false);return [...document.querySelectorAll('[data-character-pose],.character-path span,.character-panel')].map(el=>({opacity:getComputedStyle(el).opacity,transform:getComputedStyle(el).transform}));},t);
 const times=[0,.5,29/30,1,31/30,2.5,89/30,3,91/30,4,7];
 const forward=[];for(const time of times)forward.push(await sample(time));
 for(let i=times.length-1;i>=0;i--)assert.deepEqual(await sample(times[i]!),forward[i],`reverse seek at ${times[i]}`);
 await page.evaluate(()=>{(window as any).timeline.kill();});
 // Restore authored initial CSS before compiling a fresh timeline.
 await page.evaluate(()=>{document.querySelectorAll('.character-heading,.character-actor,.character-panel,.character-path span').forEach(e=>e.removeAttribute('style'));document.querySelector('[data-character-pose="idle"]')!.setAttribute('style','opacity:1');document.querySelector('[data-character-pose="explain"]')!.setAttribute('style','opacity:0');});
 await page.evaluate(source);
 for(const i of [9,3,6,0,8,2,10,5])assert.deepEqual(await sample(times[i]!),forward[i],`fresh seek at ${times[i]}`);
 }finally{await browser.close();}
});

test('bilingual character layout loads in a Chinese spaced path without clipped text or caption overlap',async t=>{
 await requireFixtureFont();
 const base=path.resolve('.cache/character-browser-tests');await mkdir(base,{recursive:true});
 const project=await mkdtemp(path.join(base,'中文 空格 '));
 t.after(async()=>{assert.equal(path.dirname(project),base);await rm(project,{recursive:true});});
 await writeBrowserAssets(path.join(project,'assets'));
 await writeFile(path.join(project,'assets/actor.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><path d="M40 80L130 80L130 200L40 200Z M240 80L330 80L370 120M330 80V200H240Z" fill="none" stroke="black" stroke-width="5"/></svg>');
 await copyFile(path.resolve('node_modules/gsap/dist/gsap.min.js'),path.join(project,'assets/gsap.min.js'));
 const spec=characterFixture();spec.brand.colors=['#FFFFFF','#000000','#555555'];spec.brand.fontFamilies=[TEST_CJK_FONT];
 spec.assets.find(a=>a.id===spec.brand.logoAssetId)!.path='assets/logo.svg';spec.assets.at(-1)!.path='assets/actor.svg';
 const scene=spec.scenes[0]!;
 spec.scenes.push({...structuredClone(scene),id:'second-explanation',actualStartSec:8,actualEndSec:16});spec.output.targetDurationSec=16;
 const html=composeVideo(spec,{gsapPath:'assets/gsap.min.js',fonts:FIXTURE_FONTS,narration:{path:'assets/layout-only.wav',cues:[{sceneId:scene.id,text:scene.voiceover,start:.5,end:7}]}}).replace(/<audio\b[\s\S]*?<\/audio>/g,'');
 await writeFile(path.join(project,'index.html'),html);
 const env=await environment(),browser=await puppeteer.launch({executablePath:env.HYPERFRAMES_BROWSER_PATH,headless:true});
 try{const page=await browser.newPage();await page.setViewport({width:1920,height:1080});await page.goto(pathToFileURL(path.join(project,'index.html')).href);
 const firstFrame=await page.evaluate(()=>{(window as any).__timelines.main.seek(0,false);const s=getComputedStyle(document.getElementById('explain')!);return {opacity:s.opacity,visibility:s.visibility};});
 assert.deepEqual(firstFrame,{opacity:'1',visibility:'visible'},'A fresh page must show the same opening as reverse seek to zero');
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));(window as any).__timelines.main.seek(5,false);});
 const errors=await page.evaluate(()=>{
  const failures:string[]=[];
  const captions=[...document.querySelectorAll('.caption')].filter(e=>Number(getComputedStyle(e).opacity)>.5);
  if(captions.length!==2)failures.push('Both bilingual captions must be visible');
  for(const text of document.querySelectorAll('.character-text-pair')){const box=text.getBoundingClientRect(),panel=text.closest('.character-panel')?.getBoundingClientRect();if(text.scrollHeight>text.clientHeight+1||text.scrollWidth>text.clientWidth+1||box.bottom>1080||box.x<0||box.right>1920||(panel&&box.bottom>panel.bottom+1))failures.push(`Clipped: ${text.textContent}`);}
  for(const panel of document.querySelectorAll('.character-panel')){const p=panel.getBoundingClientRect();for(const caption of captions){const c=caption.getBoundingClientRect();if(p.x<c.right&&p.right>c.x&&p.y<c.bottom&&p.bottom>c.y)failures.push('Panel overlaps caption');}}
  if(getComputedStyle(captions[0]!).backgroundColor!=='rgba(0, 0, 0, 0)')failures.push('Caption has a background');
  return failures;
 });assert.deepEqual(errors,[]);
 const scales=await page.evaluate(()=>[...document.querySelectorAll('#explain .character-pose img')].map(image=>{
  const box=image.getBoundingClientRect(),img=image as HTMLImageElement;
  return {x:box.width/img.naturalWidth,y:box.height/img.naturalHeight};
 }));
 assert.equal(scales.length,2);
 for(const scale of scales)assert.ok(Math.abs(scale.x-scale.y)<.001,'Every pose must preserve source aspect ratio');
 assert.ok(Math.abs(scales[0]!.x-scales[1]!.x)<.001,'Both poses must use the same source scale');
 await page.evaluate(()=>{(window as any).__timelines.main.seek(15,false);});
 const motion=await browserMotionQa(page,spec);assert.deepEqual(motion.checks.filter(check=>check.status==='FAIL'),[]);
 const firstSceneVisible=await page.evaluate(()=>{
  const tl=(window as any).__timelines.main;
  for(const time of [15.9,0,2])tl.seek(time,false);
  const style=getComputedStyle(document.getElementById('explain')!);
  return style.visibility==='visible'&&Number(style.opacity)>.99;
 });assert.equal(firstSceneVisible,true,'The opening must recover after seeking back to exact zero');
 await page.addStyleTag({content:'.character-pose{visibility:hidden!important}'});
 const hidden=await browserMotionQa(page,spec);
 assert.ok(hidden.checks.filter(check=>check.id.endsWith('.real-subject')).every(check=>check.status==='FAIL'),'Loaded images hidden by pose wrappers must not count as visible actors');
 }finally{await browser.close();}
});
