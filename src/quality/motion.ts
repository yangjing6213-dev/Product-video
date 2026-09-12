// SPDX-License-Identifier: Apache-2.0

import {
  compileWorkflowProgress,
  validateSceneWorkflow,
  type SceneWorkflow,
  type WorkflowAssetType,
} from './workflow.ts';

export type ActionPrimitive =
  | 'focus-transfer'
  | 'layer-assemble'
  | 'state-change'
  | 'before-after'
  | 'object-handoff'
  | 'reading-hold'
  | 'workflow-progress';

export type ActionDirection = 'left' | 'right' | 'up' | 'down';
export type ActionLayerRole = 'base' | 'title' | 'logo' | 'subtitle' | 'value-line';

export interface MotionAssetLayer {
  id: string;
  assetId: string;
  /** Pixel bounds in [left, top, right, bottom] order on the parent asset canvas. */
  bounds: [number, number, number, number];
  role: ActionLayerRole;
}

export interface MotionAsset {
  id: string;
  path: string;
  type?: WorkflowAssetType;
  width?: number;
  height?: number;
  layers?: MotionAssetLayer[];
}

export interface SceneAction {
  intent: string;
  primitive: ActionPrimitive;
  subject: { assetId: string; layerIds?: string[] };
  beforeState: string;
  afterState: string;
  startFrame: number;
  endFrame: number;
  holdFrames: number;
  syncCueId?: string;
  direction?: ActionDirection;
  relatedAssetIds?: string[];
  /** Normalized crop rectangle over the real subject asset. */
  focus?: { x: number; y: number; width: number; height: number };
}

export interface SceneActionContext {
  sceneId: string;
  sceneDurationFrames: number;
  sceneAssetRefs: readonly string[];
  cueIds?: readonly string[];
  assets: readonly MotionAsset[];
  backgroundAssetId?: string;
  workflow?: SceneWorkflow;
}

export interface CompileSceneActionContext {
  sceneId: string;
  sceneStartFrame: number;
  fps: number;
  timelineName?: string;
  workflow?: SceneWorkflow;
  visualStyle?: 'editorial-v1' | 'editorial-v2';
}

export interface MotionReviewHint {
  code: 'motion.reading-hold.review';
  sceneId: string;
  message: string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function assertFrame(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer frame`);
}

function validateFocus(focus: SceneAction['focus']): void {
  if (!focus) throw new Error('focus-transfer requires a normalized focus rectangle');
  const { x, y, width, height } = focus;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    throw new Error('Focus rectangle must stay inside the real subject image in normalized 0..1 coordinates');
  }
}

/** Validate executable action semantics against the real assets available to one scene. */
export function validateSceneAction(action: SceneAction, context: SceneActionContext): SceneAction {
  if (!action || !text(action.intent) || !text(action.beforeState) || !text(action.afterState)) throw new Error('Scene action requires intent, beforeState and afterState');
  if (!ID.test(action.subject?.assetId ?? '')) throw new Error('Scene action requires a safe subject asset ID');
  assertFrame(action.startFrame, 'Action startFrame');
  assertFrame(action.endFrame, 'Action endFrame');
  assertFrame(action.holdFrames, 'Action holdFrames');
  if (action.endFrame <= action.startFrame || action.endFrame + action.holdFrames > context.sceneDurationFrames) {
    throw new Error('Scene action timing and reading hold must stay inside the scene');
  }
  const assets = new Map(context.assets.map(asset => [asset.id, asset]));
  const sceneRefs = new Set(context.sceneAssetRefs);
  const requireSceneAsset = (assetId: string): MotionAsset => {
    const asset = assets.get(assetId);
    if (!asset) throw new Error(`Scene action must reference a real declared asset: ${assetId}`);
    if (!sceneRefs.has(assetId)) throw new Error(`Scene action asset must be present in scene assetRefs: ${assetId}`);
    return asset;
  };
  const subject = requireSceneAsset(action.subject.assetId);
  if (action.syncCueId && (!ID.test(action.syncCueId) || !context.cueIds?.includes(action.syncCueId))) throw new Error('Scene action syncCueId must reference a real narration cue');

  if (action.primitive === 'focus-transfer') validateFocus(action.focus);
  if (action.primitive === 'layer-assemble') {
    const layerIds = action.subject.layerIds;
    if (!layerIds || layerIds.length < 2 || new Set(layerIds).size !== layerIds.length) throw new Error('layer-assemble requires at least two unique real layer IDs');
    if (!subject.width || !subject.height || subject.width <= 0 || subject.height <= 0) throw new Error('layer-assemble requires real parent asset dimensions');
    const layers = new Map((subject.layers ?? []).map(layer => [layer.id, layer]));
    for (const layerId of layerIds) {
      const layer = layers.get(layerId);
      if (!layer) throw new Error(`layer-assemble requires a real declared layer: ${layerId}`);
      requireSceneAsset(layer.assetId);
      const [left, top, right, bottom] = layer.bounds;
      if (![left, top, right, bottom].every(Number.isFinite) || left < 0 || top < 0 || right <= left || bottom <= top || right > subject.width || bottom > subject.height) {
        throw new Error(`Layer bounds must stay inside the real parent asset: ${layerId}`);
      }
    }
  }
  if (action.primitive === 'state-change' || action.primitive === 'before-after') {
    const related = action.relatedAssetIds;
    if (!related || related.length < 2 || new Set(related).size !== related.length) throw new Error(`${action.primitive} requires at least two distinct real declared assets`);
    for (const assetId of related) requireSceneAsset(assetId);
  }
  if (action.primitive === 'workflow-progress') {
    if (!context.workflow) throw new Error('workflow-progress requires a scene workflow');
    validateSceneWorkflow(context.workflow, {
      sceneDurationFrames: context.sceneDurationFrames,
      sceneAssetRefs: context.sceneAssetRefs,
      backgroundAssetId: context.backgroundAssetId,
      assets: context.assets.map(asset => ({ id: asset.id, type: asset.type ?? 'image' })),
      action: {
        subjectAssetId: action.subject.assetId,
        relatedAssetIds: action.relatedAssetIds,
        startFrame: action.startFrame,
        endFrame: action.endFrame,
      },
    });
  }
  if (action.direction && !['left', 'right', 'up', 'down'].includes(action.direction)) throw new Error('Unsupported scene action direction');
  return structuredClone(action);
}

const number = (value: number): string => Number(value.toFixed(4)).toString();
const selector = (sceneId: string, attribute: string, value: string): string =>
  JSON.stringify(`#${sceneId} [${attribute}="${value}"]`);

function directionOffset(direction: ActionDirection | undefined, distance: number): { x: number; y: number } {
  if (direction === 'right') return { x: distance, y: 0 };
  if (direction === 'up') return { x: 0, y: -distance };
  if (direction === 'down') return { x: 0, y: distance };
  return { x: -distance, y: 0 };
}

/** Compile one already-validated action to finite GSAP timeline statements. */
export function compileSceneAction(action: SceneAction, context: CompileSceneActionContext): string {
  if (!Number.isFinite(context.fps) || context.fps <= 0) throw new Error('A positive finite fps is required');
  assertFrame(context.sceneStartFrame, 'Scene startFrame');
  if (!ID.test(context.sceneId)) throw new Error('A safe scene ID is required');
  const timeline = context.timelineName ?? 'tl';
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(timeline)) throw new Error('A safe timeline variable is required');
  const absolute = (frame: number): string => number((context.sceneStartFrame + frame) / context.fps);
  const duration = number((action.endFrame - action.startFrame) / context.fps);
  const start = absolute(action.startFrame);
  const holdEnd = absolute(action.endFrame + action.holdFrames);
  const subject = selector(context.sceneId, 'data-asset-id', action.subject.assetId);
  const lines = [`${timeline}.addLabel(${JSON.stringify(`action-${context.sceneId}`)},${start});`];

  if (action.primitive === 'focus-transfer') {
    const focus = action.focus!;
    const scale = Math.min(3, 1 / Math.max(focus.width, focus.height));
    const xPercent = (0.5 - (focus.x + focus.width / 2)) * 100 * scale;
    const yPercent = (0.5 - (focus.y + focus.height / 2)) * 100 * scale;
    lines.push(`${timeline}.fromTo(${subject},{scale:1,xPercent:0,yPercent:0},{scale:${number(scale)},xPercent:${number(xPercent)},yPercent:${number(yPercent)},duration:${duration},ease:"power3.inOut",immediateRender:false},${start});`);
  } else if (action.primitive === 'layer-assemble') {
    const layerIds = action.subject.layerIds!;
    const layerDurationFrames = Math.max(1, Math.floor((action.endFrame - action.startFrame) / layerIds.length));
    const offset = directionOffset(action.direction, 72);
    lines.push(`${timeline}.fromTo(${subject},{scale:1.025},{scale:1,duration:${number(layerDurationFrames / context.fps)},ease:"sine.out",immediateRender:false},${start});`);
    layerIds.forEach((layerId, index) => {
      const layer = selector(context.sceneId, 'data-layer-id', layerId);
      lines.push(`${timeline}.fromTo(${layer},{x:${offset.x},y:${offset.y},autoAlpha:0},{x:0,y:0,autoAlpha:1,duration:${number(layerDurationFrames / context.fps)},ease:"power3.out",immediateRender:false},${absolute(action.startFrame + layerDurationFrames * index)});`);
    });
  } else if (action.primitive === 'state-change' || action.primitive === 'before-after') {
    const [beforeId, afterId] = action.relatedAssetIds!;
    const before = selector(context.sceneId, 'data-asset-id', beforeId!);
    const after = selector(context.sceneId, 'data-asset-id', afterId!);
    lines.push(`${timeline}.set(${before},{autoAlpha:1},${start});`);
    if (action.primitive === 'state-change') {
      lines.push(`${timeline}.to(${before},{autoAlpha:0,duration:${duration},ease:"sine.inOut"},${start});`);
      lines.push(`${timeline}.fromTo(${after},{autoAlpha:0},{autoAlpha:1,duration:${duration},ease:"sine.inOut",immediateRender:false},${start});`);
    } else {
      lines.push(`${timeline}.fromTo(${after},{clipPath:"inset(0 100% 0 0)",autoAlpha:1},{clipPath:"inset(0 0% 0 0)",autoAlpha:1,duration:${duration},ease:"power2.inOut",immediateRender:false},${start});`);
    }
  } else if (action.primitive === 'object-handoff') {
    const offset = directionOffset(action.direction, 96);
    lines.push(`${timeline}.fromTo(${subject},{x:${offset.x},y:${offset.y},scale:.94,autoAlpha:0},{x:0,y:0,scale:1,autoAlpha:1,duration:${duration},ease:"power3.inOut",immediateRender:false},${start});`);
  } else if (action.primitive === 'workflow-progress') {
    if (!context.workflow) throw new Error('workflow-progress requires a scene workflow');
    lines.push(compileWorkflowProgress(context.workflow, {
      sceneId: context.sceneId,
      sceneStartFrame: context.sceneStartFrame,
      fps: context.fps,
      timelineName: timeline,
      visualStyle: context.visualStyle,
    }));
  } else {
    lines.push(`${timeline}.set(${subject},{autoAlpha:1},${start});`);
  }
  lines.push(`${timeline}.set(${subject},{visibility:"visible"},${holdEnd});`);
  return lines.join('\n');
}

/** Reading pauses are candidates for human review, never automatic aesthetic verdicts. */
export function motionReviewHints(action: SceneAction, sceneId: string): MotionReviewHint[] {
  if (action.primitive !== 'reading-hold') return [];
  return [{
    code: 'motion.reading-hold.review',
    sceneId,
    message: 'Review the stated reading reason and the stable subject frames; this hint does not decide visual acceptance.',
  }];
}
