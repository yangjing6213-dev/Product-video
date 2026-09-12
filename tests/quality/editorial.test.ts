// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { compileWorkflowProgress, type SceneWorkflow } from '../../src/quality/workflow.ts';
import { authorRegionStyle } from '../../src/quality/editorial.ts';

const workflow: SceneWorkflow = { layout: 'horizontal-3', cards: ['input', 'focus', 'result'].map((id, i) => ({
  id, previewAssetId: id, title: id, sentence: 'Verified content', fields: [{label:'State',value:'Ready'}], focusFrame:30+i*90, completeFrame:100+i*90,
})) };
test('editorial motion lifts cards, reveals real previews, activates fields and preserves the legacy compiler', () => {
  const context = {sceneId:'proof', sceneStartFrame:0, fps:30};
  const legacy = compileWorkflowProgress(workflow, context);
  const editorial = compileWorkflowProgress(workflow, {...context, visualStyle:'editorial-v1'} as typeof context);
  assert.notEqual(editorial, legacy);
  assert.match(editorial, /y:-8/);
  assert.match(editorial, /workflow-fields li/);
  assert.match(editorial, /stroke-dashoffset/);
  assert.equal(compileWorkflowProgress(workflow, context), legacy);
});

test('author reframing preserves source aspect and rejects crops outside the original', () => {
  assert.throws(() => authorRegionStyle([20,30,10,60],1536,1024), /region/i);
  assert.throws(() => authorRegionStyle([0,0,1600,1024],1536,1024), /region/i);
  assert.throws(() => authorRegionStyle([0,0,100,100],undefined,1024), /dimensions/i);
  const style=authorRegionStyle([768,160,1536,928],1536,1024);
  assert.equal(style.aspectRatio,1);
  assert.match(style.image,/width:200%/);
  assert.match(style.image,/left:-100%/);
});
