// SPDX-License-Identifier: Apache-2.0
import { validVideoSpec } from './input.ts';
import type { VideoSpec } from '../../src/contracts.ts';
import { CHARACTER_GENERATOR_POLICY } from '../../src/quality/policy.ts';

export function characterFixture(): VideoSpec {
  const spec = structuredClone(validVideoSpec) as VideoSpec;
  spec.generatorPolicy=structuredClone(CHARACTER_GENERATOR_POLICY);
  spec.brandLibrary={selections:[{assetId:'actor-sheet',contentVersion:'test-v1',sha256:'a'.repeat(64),purpose:'Original synthetic browser fixture'}]};
  spec.audio.narrationMode='hyperframes';
  spec.brand = { ...spec.brand, presentation: 'character', visualStyle: 'sketch-v1', canvas: 'light', colors: ['#F7F4EB','#17232D','#426B86','#D8AC35'] };
  spec.assets.push({ id:'actor-sheet',type:'image',path:'assets/actor.png',license:'owned',sourceUrl:'owned-fixture',required:true,fallbackAssetId:null,width:600,height:400,characterPoses:{idle:[0,0,180,380],explain:[200,0,400,380]} });
  const scene = { ...spec.scenes[0]!, id:'explain', plannedDurationSec:8, actualStartSec:0, actualEndSec:8, voiceover:'整理资料，再制作。', onScreenText:['把重点放在一起','资料','确认方案'],assetRefs:['actor-sheet'],
    bilingual:{onScreenText:['Bring the essentials together','Brief','Review the plan'],subtitle:'Gather your materials, then create.'},
    character:{layout:'sequence' as const,actors:[{assetId:'actor-sheet',side:'left' as const}],panels:[{id:'brief',textIndices:[1]},{id:'review',textIndices:[2]}],beats:[{frame:30,actor:0,pose:'explain' as const,panelId:'brief'},{frame:90,actor:0,pose:'idle' as const,panelId:'review'}]},
    action:{intent:'Explain the steps',primitive:'character-explain' as const,subject:{assetId:'actor-sheet'},beforeState:'Inputs separate',afterState:'Plan reviewed',startFrame:15,endFrame:120,holdFrames:90} };
  scene.onScreenText.push(CHARACTER_GENERATOR_POLICY.marketing.screenAction, CHARACTER_GENERATOR_POLICY.marketing.displayDomain);
  scene.bilingual.onScreenText.push('Visit ENHE for more AI tools and solutions.',CHARACTER_GENERATOR_POLICY.marketing.displayDomain);
  scene.character.panels[1]!.textIndices.push(3,4);
  spec.scenes=[scene]; spec.output.targetDurationSec=8; return spec;
}
