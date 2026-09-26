// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';import assert from 'node:assert/strict';
import {curve,armPoint,solveArm,bodyPoint,faceTexture,paintWarp,actingRuntime,rotate,type ArmLandmarks} from '../../src/quality/source-acting.ts';
import puppeteer from 'puppeteer-core';import {environment} from '../../src/pipeline/tools.ts';
const limb:ArmLandmarks={root:[0,0],joint:[0,40],grip:[0,80]};
test('elbow bending keeps shoulder anchored and follows the complete wrist arc',()=>{
 assert.deepEqual(armPoint([0,0],limb,20,35),[0,0]);
 const wrist=armPoint([0,80],limb,0,90);assert.ok(Math.abs(wrist[0]+40)<.001);assert.ok(Math.abs(wrist[1]-40)<.001);
 assert.deepEqual(armPoint([12,35],limb,0,0),[12,35]);
 assert.deepEqual(armPoint([20,-25],limb,40,0),[20,-25]);
});
test('hand contact solver reaches a held prop without changing arm lengths',()=>{
 const a:ArmLandmarks={root:[257,324],joint:[226,370],grip:[228,410]},target:[number,number]=[181,350];
 const solved=solveArm(a,target),grip=armPoint(a.grip,a,solved.shoulder,solved.bend);assert.ok(solved.reachable);assert.ok(Math.hypot(grip[0]-target[0],grip[1]-target[1])<.001);
 assert.equal(solveArm(a,[0,0]).reachable,false);
});
test('body anticipation keeps the contact line planted and seek results deterministic',()=>{
 const a=bodyPoint([20,100],[0,70],100,6,3);assert.deepEqual(a,[20,100]);
 const before=bodyPoint([20,30],[0,70],100,6,3);bodyPoint([20,30],[0,70],100,-6,-2);assert.deepEqual(bodyPoint([20,30],[0,70],100,6,3),before);
});
test('authored timing has continuous velocity through an intermediate key and exact rest holds',()=>{
 const keys=[[0,0],[1,20],[2,35],[3,35],[4,35]] as [number,number][];const h=.0001;
 const l=(curve(keys,1)-curve(keys,1-h))/h,r=(curve(keys,1+h)-curve(keys,1))/h;
 assert.ok(Math.abs(l-r)<.03);assert.equal(curve(keys,3.4),35);assert.equal(curve(keys,5),35);assert.throws(()=>curve([[1,1],[0,2]],.5),/ordered/);
});
test('actual canvas mesh keeps opaque interiors solid after rotation without modifying its source',async()=>{
 const browser=await puppeteer.launch({executablePath:(await environment()).HYPERFRAMES_BROWSER_PATH,headless:true});
 try{const page=await browser.newPage();await page.addScriptTag({content:actingRuntime()});const result=await page.evaluate(()=>{
  const source=document.createElement('canvas');source.width=64;source.height=64;const raw=source.getContext('2d')!;raw.fillStyle='#86c5fb';raw.fillRect(0,0,64,64);const before=[...raw.getImageData(0,0,64,64).data];
  const canvas=document.createElement('canvas');canvas.width=110;canvas.height=110;const c=canvas.getContext('2d')!;
  paintWarp(c,source,[0,0,64,64],p=>{const q=rotate(p,[32,32],9);return[q[0]+23,q[1]+23];},7);
  const pixels=c.getImageData(0,0,110,110).data;let min=255;for(let y=35;y<75;y++)for(let x=35;x<75;x++)min=Math.min(min,pixels[(y*110+x)*4+3]!);
  const eye=document.createElement('canvas');eye.width=64;eye.height=80;const ec=eye.getContext('2d')!;ec.fillStyle='#86c5fb';ec.fillRect(0,0,64,80);ec.fillStyle='#000';ec.beginPath();ec.ellipse(32,40,12,23,0,0,Math.PI*2);ec.fill();
  const closed=faceTexture(eye,[0,0,64,80],[{cx:32,cy:40,rx:22,ry:32}],0,0,1),ep=closed.getContext('2d')!.getImageData(0,0,64,80).data;let top=80,bottom=0;for(let y=0;y<80;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4;if(ep[i]!<35&&ep[i+1]!<35&&ep[i+2]!<35&&ep[i+3]!>240){top=Math.min(top,y);bottom=Math.max(bottom,y);}}
  return{min,sourceUnchanged:before.every((n,i)=>n===raw.getImageData(0,0,64,64).data[i]),outerAlpha:pixels[3],closedHeight:bottom-top+1,faceBoundaryUnchanged:ep[0]===134&&ep[1]===197&&ep[2]===251&&ep[3]===255};
 });assert.ok(result.min>=254,JSON.stringify(result));assert.ok(result.sourceUnchanged);assert.equal(result.outerAlpha,0);
 assert.ok(result.faceBoundaryUnchanged);assert.ok(result.closedHeight>0&&result.closedHeight<=6,JSON.stringify(result));
 }finally{await browser.close();}
});
