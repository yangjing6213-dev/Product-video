// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';import {test} from 'node:test';
import {sourceSilhouette,renderSourceRig,type SourceRig} from '../../src/quality/source-rig.ts';
import puppeteer from 'puppeteer-core';import {environment} from '../../src/pipeline/tools.ts';
test('runtime source mask preserves enclosed white gloves instead of white-keying the whole image',()=>{
 const pixels=new Uint8ClampedArray(12*12*4).fill(255),before=pixels.slice();
 for(let y=3;y<=8;y++)for(let x=3;x<=8;x++)if(y===3||y===8||x===3||x===8){const i=(y*12+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=0;}
 const original=pixels.slice(),result=sourceSilhouette(pixels,12,12,[0,0,12,12]);
 assert.equal(result.retainedPixels,36);assert.equal(result.exteriorPixels,108);assert.deepEqual(pixels,original);assert.notDeepEqual(pixels,before);
});
test('source compositing rejects invalid crops and executable region paths',()=>{
 assert.throws(()=>sourceSilhouette(new Uint8ClampedArray(16),2,2,[-1,0,2,2]),/crop/);
 assert.throws(()=>renderSourceRig({sourceAssetId:'a',sourceWidth:2,sourceHeight:2,bounds:[0,0,2,2],maskPath:'<script>',parts:[]},'a.png','a'),/silhouette/);
});
test('reviewed matte threshold removes exterior grey fringes while keeping enclosed white',()=>{
 const pixels=new Uint8ClampedArray(12*12*4).fill(255);
 for(let y=2;y<10;y++)for(let x=2;x<10;x++){const edge=x===2||x===9||y===2||y===9,outline=x===3||x===8||y===3||y===8,i=(y*12+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=edge?140:outline?0:255;}
 assert.equal(sourceSilhouette(pixels,12,12,[0,0,12,12]).retainedPixels,64);
 assert.equal(sourceSilhouette(pixels,12,12,[0,0,12,12],[],80).retainedPixels,36);
 assert.throws(()=>sourceSilhouette(pixels,12,12,[0,0,12,12],[],0),/threshold/);
});
test('only explicitly reviewed enclosed background holes are opened',()=>{
 const px=new Uint8ClampedArray(10*10*4).fill(255);
 for(let y=2;y<8;y++)for(let x=2;x<8;x++)if(x===2||x===7||y===2||y===7){const i=(y*10+x)*4;px[i]=px[i+1]=px[i+2]=0;}
 assert.equal(sourceSilhouette(px,10,10,[0,0,10,10]).retainedPixels,36);
 assert.equal(sourceSilhouette(px,10,10,[0,0,10,10],[[4,4]]).retainedPixels,20);
 assert.throws(()=>sourceSilhouette(px,10,10,[0,0,10,10],[[2,2]]),/reviewed paper/);
});
test('source silhouettes are continuous contours, not one antialiased rectangle per row',()=>{
 const px=new Uint8ClampedArray(20*20*4).fill(255);for(let y=4;y<16;y++)for(let x=4;x<16;x++){const i=(y*20+x)*4;px[i]=30;px[i+1]=110;px[i+2]=210;}
 const mask=sourceSilhouette(px,20,20,[0,0,20,20]);assert.equal(mask.retainedPixels,144);assert.equal((mask.path.match(/M/g)??[]).length,1);assert.equal((mask.path.match(/L/g)??[]).length,3);
});
test('editable source SVG preserves enclosed white detail and does not stripe under rotation',async()=>{
 const browser=await puppeteer.launch({executablePath:(await environment()).HYPERFRAMES_BROWSER_PATH,headless:true});
 try{const page=await browser.newPage();const fixture=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=40;const ctx=c.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,32,40);ctx.fillStyle='#101010';ctx.fillRect(8,8,16,24);ctx.fillStyle='#80c4fe';ctx.fillRect(9,9,14,22);ctx.fillStyle='white';ctx.fillRect(13,18,6,5);return{url:c.toDataURL(),pixels:[...ctx.getImageData(0,0,32,40).data]};});
 const mask=sourceSilhouette(new Uint8ClampedArray(fixture.pixels),32,40,[0,0,32,40]);
 const rig:SourceRig={sourceAssetId:'fixture',sourceWidth:32,sourceHeight:40,bounds:[0,0,32,40],maskPath:mask.path,parts:[{name:'body',clip:'M0 0H32V40H0Z',pivot:[16,24]},{name:'head',clip:'M8 8H24V16H8Z',pivot:[16,16]},...(['leftArm','rightArm','leftLeg','rightLeg'] as const).map((name,i)=>({name,clip:`M${i} 0h1v1h-1Z`,pivot:[i,0] as [number,number]}))]};
 const svg=renderSourceRig(rig,fixture.url,'fixture');assert.throws(()=>renderSourceRig(rig,'https://example.invalid/a.png','f'),/frozen local/);assert.throws(()=>renderSourceRig(rig,'../a.png','f'),/frozen local/);
 const result=await page.evaluate(async svg=>{async function draw(value:string){const im=new Image();im.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(value)));await im.decode();const c=document.createElement('canvas');c.width=32;c.height=40;const ctx=c.getContext('2d')!;ctx.drawImage(im,0,0);return ctx.getImageData(0,0,32,40).data;}
 const neutral=await draw(svg),rotated=await draw(svg.replace('</defs>','</defs><g transform="rotate(12 16 20)">').replace('</svg>','</g></svg>'));let minInteriorAlpha=255;
 for(let y=13;y<27;y++)for(let x=12;x<20;x++){const r=12*Math.PI/180,xx=Math.round(16+(x-16)*Math.cos(r)-(y-20)*Math.sin(r)),yy=Math.round(20+(x-16)*Math.sin(r)+(y-20)*Math.cos(r));minInteriorAlpha=Math.min(minInteriorAlpha,rotated[(yy*32+xx)*4+3]!);}
 return{outside:neutral[3],white:[...neutral.slice((20*32+16)*4,(20*32+16)*4+4)],minInteriorAlpha};},svg);
 assert.equal(result.outside,0);assert.deepEqual(result.white,[255,255,255,255]);assert.ok(result.minInteriorAlpha>=248,JSON.stringify(result));
 }finally{await browser.close();}
});
