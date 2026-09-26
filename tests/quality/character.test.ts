// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validVideoSpec } from '../fixtures/input.ts';
import { validateSpec, type VideoSpec } from '../../src/contracts.ts';
import { composeVideo } from '../../src/quality/composition.ts';
import { validateSceneAction } from '../../src/quality/motion.ts';
import { copyDraftFromVideoSpec, freezeCopyDraft, recordCopyDecision, assertVideoSpecCopyApproved } from '../../src/quality/copy.ts';
import { CHARACTER_GENERATOR_POLICY, ACTIVE_GENERATOR_POLICY, resolveGeneratorInput } from '../../src/quality/policy.ts';
import { editorialCss } from '../../src/quality/editorial.ts';
import { validateCharacterSelection } from '../../src/quality/character.ts';

import { characterFixture } from '../fixtures/character.ts';
const options={gsapPath:'assets/gsap.min.js',fonts:[{family:'Source Han Sans CN',path:'assets/font.otf'}]};

test('character mode is explicitly selected and leaves normal defaults unchanged',()=>{
 const old=resolveGeneratorInput(validVideoSpec) as VideoSpec;
 assert.deepEqual(old.generatorPolicy,ACTIVE_GENERATOR_POLICY);
 const next=resolveGeneratorInput(characterFixture()) as VideoSpec;
 assert.deepEqual(next.generatorPolicy,CHARACTER_GENERATOR_POLICY);
 assert.equal(next.brand.visualStyle,'sketch-v1');
});
test('schema and composition accept a bounded bilingual character scene',()=>{
 const spec=characterFixture(); validateSpec(spec);
 const output=composeVideo(spec,{...options,narration:{path:'assets/voice.wav',cues:[{sceneId:'explain',text:spec.scenes[0]!.voiceover,start:.5,end:7}]}});
 assert.match(output,/data-character-stage/); assert.match(output,/data-character-pose="explain"/);
 assert.match(output,/Bring the essentials together/);assert.match(output,/Gather your materials, then create\./);
 assert.match(output,/data-caption-language="en"/); assert.doesNotMatch(output,/Math\.random|repeat:-1/);
 assert.match(output,/data-caption-start="0.5" data-caption-end="7"/);
});
test('selected original character colors are explicit and monochrome remains the default',()=>{
 const spec=characterFixture();
 const actor=spec.assets.find(a=>a.characterPoses)!;
 assert.match(composeVideo(spec,options),/filter:grayscale\(1\)/);
 actor.characterColor='original'; validateSpec(spec);
 const output=composeVideo(spec,options);
 assert.match(output,/data-character-color="original"/);
 assert.match(output,/data-character-color="original"\] img\{filter:none\}/);
});
test('missing translations, invalid pose crop and out-of-range beats fail closed',()=>{
 for(const mutation of [
  (s:VideoSpec)=>{s.scenes[0]!.bilingual!.onScreenText.pop();},
  (s:VideoSpec)=>{s.assets.at(-1)!.characterPoses!.idle=[0,0,999,380];},
  (s:VideoSpec)=>{s.scenes[0]!.character!.beats[0]!.frame=999;},
  (s:VideoSpec)=>{s.scenes[0]!.character!.panels[0]!.textIndices=[999];},
  (s:VideoSpec)=>{s.assets.at(-1)!.license='unknown';},
 ]){const s=characterFixture();mutation(s);assert.throws(()=>composeVideo(s,options));}
});
test('character actions require a validated character stage, and arbitrary action names fail',()=>{
 const spec=characterFixture(),scene=spec.scenes[0]!;
 const context={sceneId:scene.id,sceneDurationFrames:240,sceneAssetRefs:scene.assetRefs,assets:spec.assets};
 assert.throws(()=>validateSceneAction(scene.action!,context),/character/i);
 assert.throws(()=>validateSceneAction({...scene.action!,primitive:'invented' as any},context),/primitive/i);
});
test('English text is included in immutable copy review and later edits invalidate approval',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'enhe-bilingual-'));
 try{const spec=characterFixture(),project=path.join(root,'projects',spec.projectId);
 const copy=await freezeCopyDraft(root,project,copyDraftFromVideoSpec(spec,'v1'));
 await recordCopyDecision(root,project,{decision:'ACCEPTED',copySha256:copy.copySha256,userInstruction:'Test fixture explicit copy decision'});
 await assertVideoSpecCopyApproved(root,project,spec);
 spec.scenes[0]!.bilingual!.subtitle='Unreviewed changed translation';
 await assert.rejects(assertVideoSpecCopyApproved(root,project,spec),/copy|bilingual/i);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('new bilingual text is escaped and never injected as markup',()=>{
 const spec=characterFixture();spec.scenes[0]!.bilingual!.onScreenText[0]='<script>alert(1)</script>';
 const output=composeVideo(spec,options);assert.match(output,/&lt;script&gt;/);assert.doesNotMatch(output,/<script>alert\(1\)/);
});

test('incomplete bilingual copy is rejected before voice or copy freezing',()=>{
 const spec=characterFixture();delete spec.scenes[0]!.bilingual;
 assert.throws(()=>copyDraftFromVideoSpec(spec,'v1'),/English|bilingual/i);
});

test('character presentation keeps the frozen author framing from editorial mode',()=>{
 const spec=characterFixture();
 const styles=editorialCss(spec,{background:'#071827',foreground:'#FFFFFF',accent:'#111111'});
 assert.match(styles,/\.sketch-v1 \.author-region\{position:absolute;margin:0;overflow:hidden;z-index:2\}/);
 assert.match(styles,/\.sketch-v1.landscape \.author-information-region\{right:4%;top:50%;width:49%/);
 assert.match(styles,/\.sketch-v1.portrait \.author-information-region\{left:5%;bottom:5%;width:90%/);
});

test('character actors cannot bypass the pinned brand-library selection',()=>{
 for(const change of [
  (s:VideoSpec)=>{delete s.brandLibrary;},
  (s:VideoSpec)=>{s.brandLibrary={selections:[],omissionReason:'Do not use reviewed assets'};},
  (s:VideoSpec)=>{s.brandLibrary!.selections[0]!.assetId='another-image';},
 ]){const spec=characterFixture();change(spec);assert.throws(()=>validateCharacterSelection(spec),/selected|pinned|library/i);assert.throws(()=>composeVideo(spec,options),/selected|pinned|library/i);}
});

test('character ending must visibly include the exact reviewed CTA and website',()=>{
 const spec=characterFixture();spec.scenes[0]!.onScreenText[3]='Different screen action';
 assert.throws(()=>composeVideo(spec,options),/CTA/);
 assert.throws(()=>copyDraftFromVideoSpec(spec,'v1'),/CTA/);
});
