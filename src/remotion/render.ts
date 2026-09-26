import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { getCompositions, renderMedia } from '@remotion/renderer';
import type { VideoSpec } from '../contracts.ts';
import { environment, REPO } from '../pipeline/tools.ts';
import type { RenderQuality } from '../pipeline/renderer.ts';
import type { RemotionInputProps, RemotionSpec } from './Root.tsx';

function durationInFramesForSpec(spec: RemotionSpec): number {
  const end = spec.scenes.reduce((max, scene, index) => {
    const start = scene.actualStartSec ?? (index === 0 ? 0 : max);
    return Math.max(max, scene.actualEndSec ?? start + scene.plannedDurationSec);
  }, 0);
  return Math.max(1, Math.round(Math.max(end, spec.output.targetDurationSec) * spec.output.fps));
}

function serializableSpec(spec: VideoSpec): RemotionSpec {
  return {
    product: { name: spec.product.name, oneLiner: spec.product.oneLiner, url: spec.product.url },
    brand: { colors: spec.brand.colors, fontFamilies: spec.brand.fontFamilies, canvas: spec.brand.canvas },
    output: { width: spec.output.width, height: spec.output.height, fps: spec.output.fps, targetDurationSec: spec.output.targetDurationSec },
    assets: spec.assets.map(({ id, path: assetPath, fallbackAssetId }) => ({ id, path: assetPath, fallbackAssetId })),
    scenes: spec.scenes.map((scene) => ({ id: scene.id, actualStartSec: scene.actualStartSec, actualEndSec: scene.actualEndSec, plannedDurationSec: scene.plannedDurationSec, voiceover: scene.voiceover, onScreenText: scene.onScreenText, assetRefs: scene.assetRefs, caption: scene.caption, bilingual: scene.bilingual })),
    captions: { enabled: spec.captions.enabled },
  };
}

function narrationPath(spec: VideoSpec): string | null {
  if (spec.audio.narrationMode === 'hyperframes' && spec.audio.voice) return 'narration.wav';
  const asset = spec.audio.externalAudioAssetId ? spec.assets.find((candidate) => candidate.id === spec.audio.externalAudioAssetId) : null;
  return asset?.path ?? null;
}

export interface RemotionRenderEvidence {
  renderer: 'remotion';
  version: '4.0.529';
  bundlePath: string;
  compositionId: string;
  durationMs: number;
  quality: RenderQuality;
}

export async function renderRemotionProject(project: string, spec: VideoSpec, quality: RenderQuality, output: string): Promise<RemotionRenderEvidence> {
  const started = performance.now();
  const env = await environment();
  const bundlePath = await bundle({ entryPoint: path.join(REPO, 'src/remotion/entry.tsx'), publicDir: project, onProgress: () => undefined });
  const inputProps: RemotionInputProps = { spec: serializableSpec(spec), narrationPath: narrationPath(spec) };
  const compositions = await getCompositions(bundlePath, { inputProps, browserExecutable: env.HYPERFRAMES_BROWSER_PATH });
  const registered = compositions.find((candidate) => candidate.id === 'main');
  if (!registered) throw new Error('Remotion composition "main" was not registered');
  const composition = {
    ...registered,
    width: inputProps.spec.output.width,
    height: inputProps.spec.output.height,
    fps: inputProps.spec.output.fps,
    durationInFrames: durationInFramesForSpec(inputProps.spec),
  };
  await renderMedia({
    composition,
    serveUrl: bundlePath,
    inputProps,
    codec: 'h264',
    outputLocation: output,
    overwrite: true,
    browserExecutable: env.HYPERFRAMES_BROWSER_PATH,
    concurrency: 4,
  });
  return { renderer: 'remotion', version: '4.0.529', bundlePath, compositionId: composition.id, durationMs: performance.now() - started, quality };
}
