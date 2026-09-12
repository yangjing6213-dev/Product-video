// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compileSceneAction,
  motionReviewHints,
  validateSceneAction,
  type MotionAsset,
  type SceneAction,
} from '../../src/quality/motion.ts';
import type { SceneWorkflow } from '../../src/quality/workflow.ts';

const assets: MotionAsset[] = [
  {
    id: 'cover-base',
    path: 'assets/cover-base.png',
    width: 1774,
    height: 887,
    layers: [
      { id: 'title', assetId: 'cover-title', bounds: [132, 250, 1035, 512], role: 'title' },
      { id: 'logo', assetId: 'cover-logo', bounds: [121, 90, 362, 135], role: 'logo' },
    ],
  },
  { id: 'cover-title', path: 'assets/cover-title.png' },
  { id: 'cover-logo', path: 'assets/cover-logo.png' },
  { id: 'social-result', path: 'assets/social-result.png' },
];

const layeredAction: SceneAction = {
  intent: '看清标题和标志如何组成真实封面',
  primitive: 'layer-assemble',
  subject: { assetId: 'cover-base', layerIds: ['title', 'logo'] },
  beforeState: '摄影底图独立可见',
  afterState: '标题和标志回到批准位置',
  startFrame: 15,
  endFrame: 75,
  holdFrames: 45,
  syncCueId: 'cue-compose',
  direction: 'left',
};

test('layer assembly requires real declared layers and compiles a finite seekable subject action', () => {
  const action = validateSceneAction(layeredAction, {
    sceneId: 'composition-proof',
    sceneDurationFrames: 180,
    sceneAssetRefs: ['cover-base', 'cover-title', 'cover-logo'],
    cueIds: ['cue-compose'],
    assets,
  });
  const source = compileSceneAction(action, {
    sceneId: 'composition-proof',
    sceneStartFrame: 90,
    fps: 30,
  });

  assert.match(source, /data-asset-id=\\\"cover-base\\\"/);
  assert.match(source, /data-layer-id=\\\"title\\\"/);
  assert.match(source, /data-layer-id=\\\"logo\\\"/);
  assert.match(source, /duration:1/);
  assert.match(source, /4\.5/);
  assert.doesNotMatch(source, /repeat\s*:\s*-1|Math\.random|Date\.now/);
});

test('state comparison rejects invented or undeclared evidence assets', () => {
  const action: SceneAction = {
    ...layeredAction,
    primitive: 'before-after',
    subject: { assetId: 'cover-base' },
    relatedAssetIds: ['cover-base', 'invented-result'],
  };
  assert.throws(() => validateSceneAction(action, {
    sceneId: 'comparison',
    sceneDurationFrames: 180,
    sceneAssetRefs: ['cover-base'],
    cueIds: ['cue-compose'],
    assets,
  }), /real declared asset|scene assetRefs/i);
});

test('workflow-progress validates the real workflow contract and compiles all card states', () => {
  const workflow: SceneWorkflow = {
    layout: 'horizontal-3',
    cards: [
      { id: 'copy', previewAssetId: 'cover-base', title: '文案', sentence: '真实短句', fields: [{ label: '字段', value: '值' }], focusFrame: 15, completeFrame: 55 },
      { id: 'logo', previewAssetId: 'cover-logo', title: '标志', sentence: '真实短句', fields: [{ label: '字段', value: '值' }], focusFrame: 65, completeFrame: 105 },
      { id: 'share', previewAssetId: 'social-result', title: '分享', sentence: '真实短句', fields: [{ label: '字段', value: '值' }], focusFrame: 115, completeFrame: 155 },
    ],
  };
  const action: SceneAction = {
    ...layeredAction,
    primitive: 'workflow-progress',
    subject: { assetId: 'cover-base' },
    relatedAssetIds: ['cover-base', 'cover-logo', 'social-result'],
    startFrame: 10,
    endFrame: 160,
    holdFrames: 20,
  };
  const validated = validateSceneAction(action, {
    sceneId: 'workflow', sceneDurationFrames: 180,
    sceneAssetRefs: ['cover-base', 'cover-logo', 'social-result'], cueIds: ['cue-compose'], assets, workflow,
  });
  const source = compileSceneAction(validated, { sceneId: 'workflow', sceneStartFrame: 0, fps: 30, workflow });
  assert.match(source, /data-workflow-card-id=.*copy/);
  assert.match(source, /data-workflow-card-id=.*share/);
  assert.match(source, /data-workflow-connector-index=.*1/);
});

test('focus transfer rejects a crop outside the real image and action timing outside the scene', () => {
  const action: SceneAction = {
    ...layeredAction,
    primitive: 'focus-transfer',
    subject: { assetId: 'cover-base' },
    focus: { x: 0.8, y: 0.1, width: 0.4, height: 0.5 },
    endFrame: 170,
    holdFrames: 20,
  };
  assert.throws(() => validateSceneAction(action, {
    sceneId: 'focus', sceneDurationFrames: 180, sceneAssetRefs: ['cover-base'], cueIds: ['cue-compose'], assets,
  }), /focus|timing|scene/i);
});

test('a justified reading hold yields a review hint without claiming visual pass or fail', () => {
  const action: SceneAction = {
    ...layeredAction,
    primitive: 'reading-hold',
    subject: { assetId: 'cover-base' },
    beforeState: '完整成果已稳定落位',
    afterState: '观众读完真实成果文字',
    holdFrames: 90,
  };
  const validated = validateSceneAction(action, {
    sceneId: 'reading', sceneDurationFrames: 210, sceneAssetRefs: ['cover-base'], cueIds: ['cue-compose'], assets,
  });
  const hints = motionReviewHints(validated, 'reading');
  assert.deepEqual(hints, [{
    code: 'motion.reading-hold.review',
    sceneId: 'reading',
    message: 'Review the stated reading reason and the stable subject frames; this hint does not decide visual acceptance.',
  }]);
  assert.ok(hints.every(hint => !('status' in hint)));
});
