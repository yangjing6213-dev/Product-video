// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compileWorkflowProgress,
  validateSceneWorkflow,
  workflowText,
  type SceneWorkflow,
  type WorkflowAsset,
} from '../../src/quality/workflow.ts';

const assets: WorkflowAsset[] = [
  { id: 'background', type: 'image' },
  { id: 'copy-preview', type: 'screenshot' },
  { id: 'type-preview', type: 'image' },
  { id: 'logo-preview', type: 'logo' },
  { id: 'source-preview', type: 'screen-recording' },
];

function card(id: string, previewAssetId: string, focusFrame: number, completeFrame: number) {
  return {
    id,
    previewAssetId,
    title: `${id}标题`,
    sentence: `${id}真实短句`,
    fields: [{ label: '字段', value: `${id}值` }],
    focusFrame,
    completeFrame,
  };
}

function workflow(layout: SceneWorkflow['layout'] = 'horizontal-3'): SceneWorkflow {
  const cards = [
    card('copy', 'copy-preview', 20, 70),
    card('type', 'type-preview', 90, 140),
    card('logo', 'logo-preview', 160, 210),
  ];
  if (layout === 'feature-row-4') cards.push(card('source', 'source-preview', 230, 280));
  return { layout, cards };
}

function context(stage: SceneWorkflow) {
  return {
    sceneDurationFrames: 360,
    sceneAssetRefs: ['background', ...stage.cards.map(item => item.previewAssetId)],
    backgroundAssetId: 'background',
    assets,
    action: {
      subjectAssetId: stage.cards[0]!.previewAssetId,
      relatedAssetIds: stage.cards.map(item => item.previewAssetId),
      startFrame: 10,
      endFrame: 300,
    },
  };
}

test('workflowText returns every card title, sentence and approved label-value line in render order', () => {
  assert.deepEqual(workflowText(workflow()), [
    'copy标题', 'copy真实短句', '字段：copy值',
    'type标题', 'type真实短句', '字段：type值',
    'logo标题', 'logo真实短句', '字段：logo值',
  ]);
});

test('workflow validation accepts exact layouts, real previews and non-overlapping ordered timing', () => {
  for (const layout of ['vertical-3', 'horizontal-3', 'feature-row-4'] as const) {
    const stage = workflow(layout);
    assert.deepEqual(validateSceneWorkflow(stage, context(stage)), stage);
  }
});

test('workflow validation rejects wrong cardinality, background-as-result, mismatched action assets and overlapping timing', () => {
  const wrongCount = workflow();
  wrongCount.cards.pop();
  assert.throws(() => validateSceneWorkflow(wrongCount, context(wrongCount)), /exactly 3 cards/i);

  const backgroundPreview = workflow();
  backgroundPreview.cards[0]!.previewAssetId = 'background';
  assert.throws(() => validateSceneWorkflow(backgroundPreview, context(backgroundPreview)), /background/i);

  const wrongOrder = workflow();
  const wrongOrderContext = context(wrongOrder);
  wrongOrderContext.action.relatedAssetIds.reverse();
  assert.throws(() => validateSceneWorkflow(wrongOrder, wrongOrderContext), /same order/i);

  const overlap = workflow();
  overlap.cards[1]!.focusFrame = overlap.cards[0]!.completeFrame - 1;
  assert.throws(() => validateSceneWorkflow(overlap, context(overlap)), /timing|overlap/i);
});

test('workflow progress compiles seekable card, preview and connector changes without visible state labels', () => {
  const source = compileWorkflowProgress(workflow(), { sceneId: 'proof', sceneStartFrame: 60, fps: 30 });
  assert.match(source, /data-workflow-card-id=.*copy/);
  assert.match(source, /data-asset-id=.*copy-preview/);
  assert.match(source, /data-workflow-connector-index=.*0/);
  assert.match(source, /data-state/);
  assert.match(source, /stroke-dashoffset/);
  assert.doesNotMatch(source, />ordinary<|>focus<|>complete<|repeat\s*:\s*-1|Math\.random|Date\.now/);
});
