// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validProductInput, validVideoSpec } from '../fixtures/input.ts';
import { ACTIVE_GENERATOR_POLICY, resolveGeneratorInput, trustedGeneratorPolicy } from '../../src/quality/policy.ts';
import { digest } from '../../src/pipeline/stage-state.ts';
import { assertVoiceReuseCompatible } from '../../src/pipeline/voice-reuse.ts';
import { editorialCss } from '../../src/quality/editorial.ts';
import { compileWorkflowProgress, type SceneWorkflow } from '../../src/quality/workflow.ts';

const previousBytes=readFileSync(new URL('../../recipes/policies/generator-quality.v2.json',import.meta.url));
const previous={...JSON.parse(previousBytes.toString('utf8')),rulesSha256:digest(previousBytes)};

test('fresh tasks use the approved new screen action and visual version; old policy stays trusted',()=>{
 const result=resolveGeneratorInput(validProductInput) as typeof validProductInput;
 assert.equal(result.brand.visualStyle,'editorial-v2');
 assert.equal(result.product.cta.label,'访问恩禾官网，获取更多AI工具和解决方案。');
 assert.deepEqual(trustedGeneratorPolicy(previous),previous);
 assert.equal(previous.marketing.screenAction,'访问恩禾官网，了解产品与使用方式。');
});

test('trusted screen-only policy revision reuses exact voice, but untrusted or audible differences fail',()=>{
 const source=structuredClone(validVideoSpec),target=structuredClone(source);
 source.generatorPolicy=previous;target.generatorPolicy=structuredClone(ACTIVE_GENERATOR_POLICY);
 assert.doesNotThrow(()=>assertVoiceReuseCompatible(source,target));
 for(const change of [(s:typeof target)=>{s.generatorPolicy!.marketing.spokenAction+='changed';},(s:typeof target)=>{s.generatorPolicy!.rulesSha256='0'.repeat(64);},(s:typeof target)=>{s.scenes[0]!.voiceover+='changed';}]){
  const changed=structuredClone(target);change(changed);
  assert.throws(()=>assertVoiceReuseCompatible(source,changed),/voice reuse|trusted policy/i);
 }
});

test('new editorial style scales only subtitles to 30.8px and aligns the logo at the text edge',()=>{
 const spec=structuredClone(validVideoSpec);spec.brand.visualStyle='editorial-v2' as never;
 const css=editorialCss(spec,{background:'#071827',foreground:'#F4F6F7',accent:'#2876DF'});
 assert.match(css,/\.editorial-v2 \.caption\{font-size:30\.8px/);
 assert.match(css,/object-position:left center/);
 spec.brand.logoAssetId='enhe-logo';
 assert.match(editorialCss(spec,{background:'#071827',foreground:'#F4F6F7',accent:'#2876DF'}),/object-position:-14\.64px center/);
 assert.match(css,/\.workflow-card-title\{font-size:44px/);
 spec.brand.visualStyle='editorial-v1';
 assert.doesNotMatch(editorialCss(spec,{background:'#071827',foreground:'#F4F6F7',accent:'#2876DF'}),/font-size:30\.8px/);
});

test('new card choreography reveals evidence and copy without the previous lift motion',()=>{
 const workflow:SceneWorkflow={layout:'horizontal-3',cards:['input','focus','result'].map((id,i)=>({id,previewAssetId:id,title:id,sentence:'Approved content',fields:[{label:'State',value:'Ready'}],focusFrame:30+i*90,completeFrame:100+i*90}))};
 const context={sceneId:'proof',sceneStartFrame:0,fps:30};
 const old=compileWorkflowProgress(workflow,{...context,visualStyle:'editorial-v1'});
 const current=compileWorkflowProgress(workflow,{...context,visualStyle:'editorial-v2' as never});
 assert.match(current,/clipPath:"inset\(0% 30% 0% 0%\)"/);
 assert.match(current,/clipPath:"inset\(0% 0% 0% 0%\)"/);assert.match(current,/workflow-card-copy/);
 assert.match(current,/stroke-dashoffset/);assert.doesNotMatch(current,/y:-8/);
 assert.equal(compileWorkflowProgress(workflow,{...context,visualStyle:'editorial-v1'}),old);
});
