import assert from 'node:assert/strict';
import test from 'node:test';
import * as narration from '../../src/qa/narration.ts';
import { validateVoiceProfile, assertNarrationProfile, voiceProfileHash } from '../../src/quality/voice-profile.ts';
import { validateSpec } from '../../src/contracts.ts';
import { validVideoSpec } from '../fixtures/input.ts';

const profile={provider:'qwen3-tts',modelId:'Qwen3-TTS-12Hz-1.7B-Base',voiceId:'enhe-user-reference-v2',locale:'zh-CN',selectionPath:'reports/reference-v2/approved.json',selectionSha256:'a'.repeat(64),referenceAudioSha256:'b'.repeat(64)};

test('a separately approved local reference has its own profile and schema identity',()=>{
  assert.deepEqual(validateVoiceProfile(profile),profile);
  const input=structuredClone(validVideoSpec);input.audio.voiceProfile=profile as never;
  assert.doesNotThrow(()=>validateSpec(input));
  assert.throws(()=>validateVoiceProfile({...profile,voiceId:'../bad'}));
});

test('accepted Base reference reuse declares Base rather than inventing VoiceDesign provenance',()=>{
  const p=validateVoiceProfile(profile);const hash='c'.repeat(64);
  const evidence={qualityRulesSha256:hash,contextHash:hash,generator:{provider:'qwen3-tts',backend:'qwen3-tts',configuredModel:p.modelId,model:p.modelId,voice:p.voiceId,locale:p.locale,profileHash:voiceProfileHash(p),sourceMode:'reuse-approved-audio',settings:{referenceAudioSha256:profile.referenceAudioSha256,selectionSha256:profile.selectionSha256,instructApplied:false,speed:1,pitchSemitones:0}}};
  assert.doesNotThrow(()=>assertNarrationProfile(p,evidence,hash));
  assert.throws(()=>assertNarrationProfile(p,{...evidence,generator:{...evidence.generator,model:'made-up-model'}},hash));
});

test('only an explicit silent final poster permits narration to end before the video',()=>{
  const end=(narration as Record<string,unknown>).narrationTimelineEnd as (spec:typeof validVideoSpec)=>number;
  assert.equal(typeof end,'function');
  const spec=structuredClone(validVideoSpec);
  spec.scenes=[{...spec.scenes[0]!,actualStartSec:0,actualEndSec:20,voiceover:'批准正文'},
    {...spec.scenes[1]!,id:'poster',actualStartSec:20,actualEndSec:28,voiceover:'',caption:'',authorPosterAssetId:'author'}];
  assert.equal(end(spec),20);
  delete spec.scenes[1]!.authorPosterAssetId;assert.equal(end(spec),28);
  spec.scenes[1]!.authorPosterAssetId='author';spec.scenes[1]!.voiceover='不可丢失';
  assert.throws(()=>end(spec),/silent|poster/i);
  spec.scenes[1]!.voiceover='';spec.scenes[1]!.actualStartSec=21;
  assert.throws(()=>end(spec),/adjacent|poster/i);
});
