// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { characterFixture } from '../fixtures/character.ts';
import { composeVideo } from '../../src/quality/composition.ts';
import {performanceFrame,performanceGrip} from '../../src/quality/performance.ts';

export function performanceFixture() {
 const spec=characterFixture();
 const scene=spec.scenes[0]!;
 (spec.assets.at(-1)! as any).characterRig={kind:'tuotuo',vector:{color:'#A9D7FC',head:'<rect x="30" y="30" width="150" height="140"/>',body:'<ellipse cx="120" cy="230" rx="55" ry="60"/>'}};
 scene.backgroundAssetId=spec.assets.find(a=>a.type==='screenshot')?.id ?? spec.assets[0]!.id;
 if(!scene.assetRefs.includes(scene.backgroundAssetId))scene.assetRefs.push(scene.backgroundAssetId);
 (scene.character as any).performance={version:'performance-v1',fact:spec.product.primaryProblem,sourceField:'product.primaryProblem',
  objective:'把说明交到统一时间轴',obstacle:'素材分散',outcome:'资料形成有序集合',roles:[{actor:0,role:'创作者'}],
  props:[{id:'brief',kind:'document',textIndices:[1,2,3,4],x:780,y:260}],
  cues:[{startFrame:10,endFrame:52,actor:0,verb:'search',propId:'brief',fromX:80,toX:80,meaning:'寻找项目说明'},
   {startFrame:60,endFrame:120,actor:0,verb:'gather',propId:'brief',fromX:80,toX:620,meaning:'将分散的说明带到创作位置'},
   {startFrame:126,endFrame:180,actor:0,verb:'place',propId:'brief',fromX:620,toX:620,meaning:'说明落入统一位置'}]};
 return spec;
}
test('performance stage renders continuous articulated actors on one real background without a paper board',()=>{
 const html=composeVideo(performanceFixture(),{gsapPath:'assets/gsap.min.js',fonts:[]});
 assert.match(html,/data-performance-stage/);
 assert.match(html,/data-joint="left-elbow"/);
 assert.match(html,/data-joint="right-knee"/);
 assert.doesNotMatch(html,/<article class="character-panel"/);
 assert.match(html,/performance-scene/);
 assert.match(html,/data-performance-prop="brief"/);
});
test('performance rejects decorative beats with no meaningful action target',()=>{
 const spec=performanceFixture();(spec.scenes[0]!.character as any).performance.cues[0].propId='missing';
 assert.throws(()=>composeVideo(spec,{gsapPath:'assets/gsap.min.js',fonts:[]}),/performance.*target/i);
});
test('performance requires a true scene backdrop',()=>{
 const spec=performanceFixture();delete spec.scenes[0]!.backgroundAssetId;
 assert.throws(()=>composeVideo(spec,{gsapPath:'assets/gsap.min.js',fonts:[]}),/performance.*background/i);
});
test('performance fact is evidence, not an invented label',()=>{
 const spec=performanceFixture();spec.scenes[0]!.character!.performance!.fact='Invented claim';
 assert.throws(()=>composeVideo(spec,{gsapPath:'assets/gsap.min.js',fonts:[]}),/cited product evidence/);
});
test('carried story object follows the exact animated hand rather than swapping two pictures',()=>{
 const p=performanceFixture().scenes[0]!.character!.performance!;
 for(const frame of [120,122,124]){
  const state=performanceFrame(p,frame),grip=performanceGrip(state.actors[0]!,'right'),prop=state.props[0]!;
  assert.equal(prop.x,grip.x);assert.equal(prop.y,grip.y);assert.equal(prop.scale,.55);
 }
 const angles=[70,71,72,73,74].map(f=>performanceFrame(p,f).actors[0]!.joints['left-hip']);
 assert.equal(new Set(angles).size,5);
});
test('vector assets reject executable or unbalanced markup',()=>{
 for(const unsafe of ['<script>alert(1)</script>','<g><circle cx="1" cy="1" r="1"/>','<path onclick="alert(1)" d="M0 0"/>','<image href="https://example.test/a.png"/>']){
  const spec=performanceFixture();spec.assets.at(-1)!.characterRig!.vector!.head=unsafe;
  assert.throws(()=>composeVideo(spec,{gsapPath:'assets/gsap.min.js',fonts:[]}),/vector|shape/i);
 }
});
