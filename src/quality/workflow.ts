// SPDX-License-Identifier: Apache-2.0

export type WorkflowLayout = 'vertical-3' | 'horizontal-3' | 'feature-row-4';
export type WorkflowAssetType = 'logo' | 'screenshot' | 'screen-recording' | 'image' | 'audio' | 'font';

export interface WorkflowField {
  label: string;
  value: string;
}

export interface WorkflowCard {
  id: string;
  previewAssetId: string;
  title: string;
  sentence: string;
  fields: WorkflowField[];
  focusFrame: number;
  completeFrame: number;
}

export interface SceneWorkflow {
  layout: WorkflowLayout;
  cards: WorkflowCard[];
}

export interface WorkflowAsset {
  id: string;
  type: WorkflowAssetType;
}

export interface WorkflowValidationContext {
  sceneDurationFrames: number;
  sceneAssetRefs: readonly string[];
  backgroundAssetId?: string;
  assets: readonly WorkflowAsset[];
  action: {
    subjectAssetId: string;
    relatedAssetIds?: readonly string[];
    startFrame: number;
    endFrame: number;
  };
}

export interface CompileWorkflowContext {
  sceneId: string;
  sceneStartFrame: number;
  fps: number;
  timelineName?: string;
  visualStyle?: 'editorial-v1' | 'editorial-v2';
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const layouts: Record<WorkflowLayout, number> = { 'vertical-3': 3, 'horizontal-3': 3, 'feature-row-4': 4 };
const previewTypes = new Set<WorkflowAssetType>(['logo', 'screenshot', 'screen-recording', 'image']);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function workflowText(workflow: SceneWorkflow): string[] {
  return workflow.cards.flatMap(card => [card.title, card.sentence, ...card.fields.map(field => `${field.label}：${field.value}`)]);
}

export function validateSceneWorkflow(workflow: SceneWorkflow, context: WorkflowValidationContext): SceneWorkflow {
  const expectedCards = layouts[workflow?.layout];
  if (!expectedCards) throw new Error('Workflow requires a supported layout');
  if (!Array.isArray(workflow.cards) || workflow.cards.length !== expectedCards) throw new Error(`${workflow.layout} requires exactly ${expectedCards} cards`);
  const assets = new Map(context.assets.map(asset => [asset.id, asset]));
  const sceneRefs = new Set(context.sceneAssetRefs);
  const cardIds = new Set<string>();
  const previewIds = new Set<string>();
  let previousComplete = context.action.startFrame;

  for (const card of workflow.cards) {
    if (!ID.test(card.id) || cardIds.has(card.id)) throw new Error('Workflow card IDs must be unique safe IDs');
    if (!ID.test(card.previewAssetId) || previewIds.has(card.previewAssetId)) throw new Error('Workflow card previews must be unique safe asset IDs');
    if (!text(card.title) || !text(card.sentence) || !card.fields.length || card.fields.some(field => !text(field.label) || !text(field.value))) {
      throw new Error('Every workflow card requires a title, sentence and readable fields');
    }
    if (![card.focusFrame, card.completeFrame].every(Number.isSafeInteger)
      || card.focusFrame < previousComplete
      || card.completeFrame <= card.focusFrame
      || card.completeFrame > context.action.endFrame
      || card.completeFrame > context.sceneDurationFrames) {
      throw new Error('Workflow card timing must be ordered, non-overlapping and inside the action');
    }
    if (card.previewAssetId === context.backgroundAssetId) throw new Error('Workflow background cannot be used as a result preview');
    const asset = assets.get(card.previewAssetId);
    if (!asset || !previewTypes.has(asset.type) || !sceneRefs.has(card.previewAssetId)) throw new Error(`Workflow preview must reference a real visual scene asset: ${card.previewAssetId}`);
    cardIds.add(card.id);
    previewIds.add(card.previewAssetId);
    previousComplete = card.completeFrame;
  }

  const related = context.action.relatedAssetIds ?? [];
  const previews = workflow.cards.map(card => card.previewAssetId);
  if (context.action.subjectAssetId !== previews[0]) throw new Error('Workflow action subject must be the first real preview');
  if (related.length !== previews.length || related.some((id, index) => id !== previews[index])) throw new Error('Workflow action related assets must match card previews in the same order');
  return structuredClone(workflow);
}

const number = (value: number): string => Number(value.toFixed(4)).toString();
const selector = (sceneId: string, attribute: string, value: string): string => JSON.stringify(`#${sceneId} [${attribute}="${value}"]`);

export function compileWorkflowProgress(workflow: SceneWorkflow, context: CompileWorkflowContext): string {
  if (!ID.test(context.sceneId) || !Number.isSafeInteger(context.sceneStartFrame) || context.sceneStartFrame < 0 || !Number.isFinite(context.fps) || context.fps <= 0) {
    throw new Error('Workflow compilation requires a safe scene ID, start frame and positive fps');
  }
  const timeline = context.timelineName ?? 'tl';
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(timeline)) throw new Error('Workflow compilation requires a safe timeline variable');
  const at = (frame: number): string => number((context.sceneStartFrame + frame) / context.fps);
  const start = at(0);
  const lines: string[] = [];

  workflow.cards.forEach((card, index) => {
    const cardSelector = selector(context.sceneId, 'data-workflow-card-id', card.id);
    const preview = JSON.stringify(`#${context.sceneId} [data-workflow-card-id="${card.id}"] [data-asset-id="${card.previewAssetId}"]`);
    const duration = number((card.completeFrame - card.focusFrame) / context.fps);
    if (context.visualStyle === 'editorial-v2') {
      const copy = JSON.stringify(`#${context.sceneId} [data-workflow-card-id="${card.id}"] .workflow-card-copy`);
      const entryFrame = Math.min(card.focusFrame, 5 + index * 4);
      const reveal = number(Math.min(.65, (card.completeFrame - card.focusFrame) / context.fps / 3));
      const mask = workflow.layout === 'vertical-3' ? 'inset(0% 0% 25% 0%)' : 'inset(0% 30% 0% 0%)';
      lines.push(`${timeline}.set(${cardSelector},{attr:{"data-state":"ordinary"},y:0,scale:1},${start});`);
      lines.push(`${timeline}.to(${cardSelector},{autoAlpha:1,duration:${number(Math.min(.35,(card.focusFrame-entryFrame)/context.fps))},ease:"sine.out"},${at(entryFrame)});`);
      lines.push(`${timeline}.set(${preview},{autoAlpha:.72,clipPath:${JSON.stringify(mask)}},${start});`);
      lines.push(`${timeline}.set(${copy},{opacity:.78,x:0},${start});`);
      lines.push(`${timeline}.set(${cardSelector},{attr:{"data-state":"focus"}},${at(card.focusFrame)});`);
      lines.push(`${timeline}.to(${preview},{autoAlpha:1,clipPath:"inset(0% 0% 0% 0%)",duration:${reveal},ease:"power3.inOut"},${at(card.focusFrame)});`);
      lines.push(`${timeline}.to(${copy},{opacity:1,duration:${reveal},ease:"sine.out"},${at(card.focusFrame)});`);
      if (index > 0) {
        const connector = selector(context.sceneId, 'data-workflow-connector-index', String(index - 1));
        lines.push(`${timeline}.set(${connector},{attr:{"stroke-dashoffset":1}},${start});`);
        lines.push(`${timeline}.to(${connector},{attr:{"stroke-dashoffset":0},duration:${reveal},ease:"power2.inOut"},${at(card.focusFrame)});`);
      }
      lines.push(`${timeline}.set(${cardSelector},{attr:{"data-state":"complete"}},${at(card.completeFrame)});`);
      return;
    }
    if (context.visualStyle === 'editorial-v1') {
      const fields = JSON.stringify(`#${context.sceneId} [data-workflow-card-id="${card.id}"] .workflow-fields li`);
      const reveal = number(Math.min(.5, (card.completeFrame - card.focusFrame) / context.fps / 3));
      const entryFrame=Math.min(card.focusFrame,8+index*4);
      const entryDuration=number(Math.min(.42,(card.focusFrame-entryFrame)/context.fps));
      lines.push(`${timeline}.set(${cardSelector},{attr:{"data-state":"ordinary"},y:18,scale:1},${start});`);
      lines.push(`${timeline}.to(${cardSelector},{autoAlpha:1,y:0,duration:${entryDuration},ease:"power2.out"},${at(entryFrame)});`);
      lines.push(`${timeline}.set(${preview},{autoAlpha:.76,scale:1},${start});`);
      lines.push(`${timeline}.set(${fields},{opacity:.55},${start});`);
      lines.push(`${timeline}.set(${cardSelector},{attr:{"data-state":"focus"}},${at(card.focusFrame)});`);
      lines.push(`${timeline}.to(${cardSelector},{y:-8,duration:${reveal},ease:"power2.out"},${at(card.focusFrame)});`);
      lines.push(`${timeline}.to(${preview},{autoAlpha:1,duration:${reveal},ease:"power2.out"},${at(card.focusFrame)});`);
      lines.push(`${timeline}.to(${fields},{opacity:1,duration:${reveal},stagger:${number(Math.min(.15, (card.completeFrame-card.focusFrame)/context.fps/(card.fields.length+1)/2))},ease:"sine.out"},${at(card.focusFrame)});`);
      if (index > 0) {
        const connector = selector(context.sceneId, 'data-workflow-connector-index', String(index - 1));
        lines.push(`${timeline}.set(${connector},{attr:{"stroke-dashoffset":1}},${start});`);
        lines.push(`${timeline}.to(${connector},{attr:{"stroke-dashoffset":0},duration:${duration},ease:"none"},${at(card.focusFrame)});`);
      }
      lines.push(`${timeline}.set(${cardSelector},{attr:{"data-state":"complete"},y:0},${at(card.completeFrame)});`);
      return;
    }
    lines.push(`${timeline}.set(${cardSelector},{attr:{"data-state":"ordinary"},autoAlpha:1,scale:1},${start});`);
    lines.push(`${timeline}.set(${preview},{autoAlpha:.78,scale:.97},${start});`);
    lines.push(`${timeline}.set(${cardSelector},{attr:{"data-state":"focus"}},${at(card.focusFrame)});`);
    lines.push(`${timeline}.to(${cardSelector},{autoAlpha:1,scale:1.02,duration:${duration},ease:"power2.out"},${at(card.focusFrame)});`);
    lines.push(`${timeline}.to(${preview},{autoAlpha:1,scale:1,duration:${duration},ease:"power2.out"},${at(card.focusFrame)});`);
    if (index > 0) {
      const connector = selector(context.sceneId, 'data-workflow-connector-index', String(index - 1));
      lines.push(`${timeline}.set(${connector},{attr:{"stroke-dashoffset":1}},${start});`);
      lines.push(`${timeline}.to(${connector},{attr:{"stroke-dashoffset":0},duration:${duration},ease:"none"},${at(card.focusFrame)});`);
    }
    lines.push(`${timeline}.set(${cardSelector},{attr:{"data-state":"complete"},scale:1},${at(card.completeFrame)});`);
  });
  return lines.join('\n');
}
