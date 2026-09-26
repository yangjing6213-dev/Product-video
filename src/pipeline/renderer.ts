import path from 'node:path';
import type { ProductInput } from '../contracts.ts';

export type RendererId = 'hyperframes' | 'remotion';
export type RenderQuality = 'draft' | 'final';

export const DEFAULT_RENDERER: RendererId = 'hyperframes';
export const RENDERER_VERSIONS: Record<RendererId, string> = {
  hyperframes: 'hyperframes-0.8.33',
  remotion: 'remotion-4.0.529',
};

export function isRendererId(value: unknown): value is RendererId {
  return value === 'hyperframes' || value === 'remotion';
}

export function parseRenderer(value: unknown): RendererId {
  if (!isRendererId(value)) throw new Error(`Unsupported renderer: ${String(value)}. Expected hyperframes or remotion`);
  return value;
}

export function resolveRenderer(input: Pick<ProductInput, 'renderMode'>): RendererId {
  if (input.renderMode === undefined) return DEFAULT_RENDERER;
  return parseRenderer(input.renderMode);
}

export function assertRendererMatch(input: Pick<ProductInput, 'renderMode'>, requested?: RendererId): RendererId {
  const resolved = resolveRenderer(input);
  if (requested !== undefined && input.renderMode !== undefined && requested !== resolved) {
    throw new Error(`Renderer mismatch: project is frozen for ${resolved}, requested ${requested}`);
  }
  return requested ?? resolved;
}

export function rendererOutputPath(project: string, renderer: RendererId, quality: RenderQuality): string {
  return path.join(project, 'renders', renderer === 'hyperframes' ? '' : renderer, `${quality}.mp4`);
}

export function rendererStageVersion(renderer: RendererId): string {
  return RENDERER_VERSIONS[renderer];
}
