import { stat } from 'node:fs/promises';
import path from 'node:path';

import { isProjectRelativePath, type Asset, type CheckResult, type ProductInput, type VideoSpec } from '../contracts.ts';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OutputDimensions {
  width: number;
  height: number;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string | number;
  r_frame_rate?: string | number;
  duration?: string | number;
}

interface ProbeData {
  format?: {
    duration?: string | number;
  };
  streams?: ProbeStream[];
}

function result(id: string, passed: boolean, passMessage: string, failMessage: string): CheckResult {
  return {
    id,
    status: passed ? 'PASS' : 'FAIL',
    message: passed ? passMessage : failMessage,
  };
}

function parseRate(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const [numeratorText, denominatorText] = value.split('/');
  const numerator = Number(numeratorText);
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return undefined;
  }
  return numerator / denominator;
}

export function checkMedia(probe: any, spec: VideoSpec): CheckResult[] {
  const data = (probe ?? {}) as ProbeData;
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(data.format?.duration);
  const fps = parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate);
  const audioRequired = spec.audio.narrationMode !== 'none' || spec.audio.musicAssetId !== null;

  const results: CheckResult[] = [
    result('media.video-stream', Boolean(video), 'Video stream is present', 'Video stream is missing'),
    result(
      'media.resolution',
      video?.width === spec.output.width && video?.height === spec.output.height,
      `Resolution is ${spec.output.width}x${spec.output.height}`,
      `Expected ${spec.output.width}x${spec.output.height}; received ${video?.width ?? 'missing'}x${video?.height ?? 'missing'}`,
    ),
    result(
      'media.fps',
      fps !== undefined && Math.abs(fps - spec.output.fps) < 0.01,
      `Frame rate is ${spec.output.fps} fps`,
      `Expected ${spec.output.fps} fps; received ${fps ?? 'missing'}`,
    ),
    result(
      'media.duration',
      Number.isFinite(duration) &&
        duration >= (spec.generatorPolicy ? 8 : 30) &&
        duration <= (spec.generatorPolicy ? 90 : 60) &&
        Math.abs(duration - spec.output.targetDurationSec) <= 0.5,
      `Duration ${duration.toFixed(3)}s matches the spec`,
      `Expected ${spec.output.targetDurationSec}s (±0.5s, within ${spec.generatorPolicy ? '8–90' : '30–60'}s); received ${Number.isFinite(duration) ? `${duration}s` : 'missing'}`,
    ),
    result(
      'media.video-codec',
      Boolean(video?.codec_name),
      `Video codec is ${video?.codec_name}`,
      'Video codec is missing',
    ),
  ];

  if (!audioRequired) {
    results.push(
      { id: 'media.audio-stream', status: 'SKIPPED_WITH_REASON', message: 'Audio is not required by the spec' },
      { id: 'media.audio-codec', status: 'SKIPPED_WITH_REASON', message: 'Audio is not required by the spec' },
    );
    return results;
  }

  results.push(
    result('media.audio-stream', Boolean(audio), 'Audio stream is present', 'Audio stream is required but missing'),
    result(
      'media.audio-codec',
      Boolean(audio?.codec_name),
      `Audio codec is ${audio?.codec_name}`,
      'Audio codec is required but missing',
    ),
    result(
      'media.audio-duration',
      Boolean(audio) && Number.isFinite(Number(audio?.duration)) && Math.abs(Number(audio?.duration) - spec.output.targetDurationSec) <= 0.5,
      `Audio duration matches ${spec.output.targetDurationSec}s`,
      `Expected audio duration ${spec.output.targetDurationSec}s (±0.5s); received ${audio?.duration ?? 'missing'}`,
    ),
  );
  return results;
}

export function checkSafeArea(rect: Rect, output: OutputDimensions, percent: number): boolean {
  if (
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent >= 50 ||
    rect.width < 0 ||
    rect.height < 0 ||
    output.width <= 0 ||
    output.height <= 0
  ) {
    return false;
  }
  const horizontalMargin = output.width * (percent / 100);
  const verticalMargin = output.height * (percent / 100);
  const epsilon = 1e-9;
  return (
    rect.x + epsilon >= horizontalMargin &&
    rect.y + epsilon >= verticalMargin &&
    rect.x + rect.width <= output.width - horizontalMargin + epsilon &&
    rect.y + rect.height <= output.height - verticalMargin + epsilon
  );
}

export function checkCaption(
  text: string,
  rect: Rect,
  output: OutputDimensions,
  maxLines: number,
  safeAreaPercent: number,
): CheckResult[] {
  const lineCount = text.length === 0 ? 0 : text.split(/\r?\n/).length;
  return [
    result(
      'caption.lines',
      lineCount <= maxLines,
      `Caption uses ${lineCount} of ${maxLines} allowed lines`,
      `Caption uses ${lineCount} lines; maximum is ${maxLines}`,
    ),
    result(
      'caption.safe-area',
      checkSafeArea(rect, output, safeAreaPercent),
      `Caption is inside the ${safeAreaPercent}% safe area`,
      `Caption exceeds the ${safeAreaPercent}% safe area`,
    ),
  ];
}

function scopedAssetPath(projectDir: string, assetPath: string): string | undefined {
  if (path.isAbsolute(assetPath) || path.win32.isAbsolute(assetPath)) {
    return undefined;
  }
  const assetRoot = path.resolve(projectDir, 'assets');
  const resolved = path.resolve(projectDir, assetPath);
  const relative = path.relative(assetRoot, resolved);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    return undefined;
  }
  return resolved;
}

async function isFile(filePath: string | undefined): Promise<boolean> {
  if (!filePath) {
    return false;
  }
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function usableFallback(asset: Asset | undefined, projectDir: string): Promise<boolean> {
  if (!asset || asset.license === 'unknown') {
    return false;
  }
  return isFile(scopedAssetPath(projectDir, asset.path));
}

export async function checkAssets(input: ProductInput, projectDir: string): Promise<CheckResult[]> {
  const byId = new Map(input.assets.map((asset) => [asset.id, asset]));
  const checks: CheckResult[] = [];
  const danglingReferences: string[] = [];
  const requireReference = (field: string, assetId: string | null): void => {
    if (assetId && !byId.has(assetId)) danglingReferences.push(`${field}=${assetId}`);
  };
  requireReference('brand.logoAssetId', input.brand.logoAssetId);
  input.product.features.forEach((feature, featureIndex) => {
    feature.evidenceAssetIds.forEach((assetId) => requireReference(`product.features[${featureIndex}].evidenceAssetIds`, assetId));
  });
  input.assets.forEach((asset) => requireReference(`assets.${asset.id}.fallbackAssetId`, asset.fallbackAssetId));
  if (input.audio.narrationMode === 'external-audio' && !input.audio.externalAudioAssetId) {
    danglingReferences.push('audio.externalAudioAssetId=missing');
  } else {
    requireReference('audio.externalAudioAssetId', input.audio.externalAudioAssetId);
  }
  requireReference('audio.musicAssetId', input.audio.musicAssetId);
  checks.push(result(
    'asset.references',
    danglingReferences.length === 0,
    'All asset references resolve',
    `Unknown asset references: ${danglingReferences.join(', ')}`,
  ));

  for (const asset of input.assets) {
    checks.push(
      result(
        `asset.license.${asset.id}`,
        asset.license !== 'unknown',
        `Asset ${asset.id} has an explicit ${asset.license} license`,
        `Asset ${asset.id} has an unknown license and cannot enter a final render`,
      ),
    );

    const resolved = scopedAssetPath(projectDir, asset.path);
    if (!resolved) {
      checks.push({
        id: `asset.path.${asset.id}`,
        status: 'FAIL',
        message: `Asset ${asset.id} must use a project-relative path beneath assets/`,
      });
      continue;
    }

    if (await isFile(resolved)) {
      checks.push({ id: `asset.path.${asset.id}`, status: 'PASS', message: `Asset ${asset.id} exists` });
      continue;
    }

    if (!asset.required) {
      checks.push({
        id: `asset.path.${asset.id}`,
        status: 'SKIPPED_WITH_REASON',
        message: `Optional asset ${asset.id} is missing`,
      });
      continue;
    }

    const fallback = asset.fallbackAssetId ? byId.get(asset.fallbackAssetId) : undefined;
    if (await usableFallback(fallback, projectDir)) {
      checks.push({
        id: `asset.path.${asset.id}`,
        status: 'SKIPPED_WITH_REASON',
        message: `Required asset ${asset.id} is missing; licensed fallback ${fallback!.id} is available`,
      });
      continue;
    }

    checks.push({
      id: `asset.path.${asset.id}`,
      status: 'FAIL',
      message: asset.fallbackAssetId
        ? `Required asset ${asset.id} and usable fallback ${asset.fallbackAssetId} are missing`
        : `Required asset ${asset.id} is missing and has no fallback`,
    });
  }

  return checks;
}

function includesOpenerMessage(spec: VideoSpec): boolean {
  const first = spec.scenes[0];
  if (!first) {
    return false;
  }
  const openerText = [first.caption ?? '', ...first.onScreenText].join(' ').toLocaleLowerCase();
  return [spec.product.name, spec.narrative.coreMessage].some(
    (message) => message.length > 0 && openerText.includes(message.toLocaleLowerCase()),
  );
}

export function checkSpec(spec: VideoSpec): CheckResult[] {
  const epsilon = 0.001;
  let expectedStart = 0;
  let timingValid = spec.scenes.length > 0;
  for (const scene of spec.scenes) {
    const start = scene.actualStartSec;
    const end = scene.actualEndSec;
    if (
      start === null ||
      end === null ||
      Math.abs(start - expectedStart) > epsilon ||
      end <= start
    ) {
      timingValid = false;
      break;
    }
    expectedStart = end;
  }
  timingValid = timingValid && Math.abs(expectedStart - spec.output.targetDurationSec) <= epsilon;

  const seenSceneIds = new Set<string>();
  const duplicateSceneIds = new Set<string>();
  for (const scene of spec.scenes) {
    if (seenSceneIds.has(scene.id)) duplicateSceneIds.add(scene.id);
    seenSceneIds.add(scene.id);
  }
  const invalidHeroFrames = spec.scenes.filter((scene) => {
    if (scene.heroFrameSec === undefined) return false;
    if (scene.actualStartSec === null || scene.actualEndSec === null) return true;
    return scene.heroFrameSec < scene.actualStartSec || scene.heroFrameSec >= scene.actualEndSec;
  });
  const invalidCompositionFiles = spec.scenes.filter((scene) => !isProjectRelativePath(scene.compositionFile));

  const assetIds = new Set(spec.assets.map((asset) => asset.id));
  const missingReferences = spec.scenes.flatMap((scene) =>
    scene.assetRefs.filter((assetId) => !assetIds.has(assetId)).map((assetId) => `${scene.id}:${assetId}`),
  );
  const first = spec.scenes[0];
  const openerTime = first?.heroFrameSec ?? first?.actualStartSec;
  const openerValid = openerTime !== null && openerTime !== undefined && openerTime <= 3 && includesOpenerMessage(spec);
  const transitionsValid = spec.scenes.slice(0, -1).every((scene) => scene.transition.durationSec > 0);

  return [
    result(
      'spec.timing',
      timingValid,
      'Scene timing is contiguous and matches target duration',
      'Scene timing must start at zero, remain contiguous, use positive durations, and match target duration',
    ),
    result(
      'spec.scene-ids',
      duplicateSceneIds.size === 0,
      'Scene IDs are unique',
      `Duplicate scene IDs: ${[...duplicateSceneIds].join(', ')}`,
    ),
    result(
      'spec.hero-frames',
      invalidHeroFrames.length === 0,
      'Every declared hero frame falls within its rendered scene',
      `Hero frames outside rendered scene timing: ${invalidHeroFrames.map((scene) => scene.id).join(', ')}`,
    ),
    result(
      'spec.composition-files',
      invalidCompositionFiles.length === 0,
      'Every composition file uses a project-relative path',
      `Composition files must stay within the project: ${invalidCompositionFiles.map((scene) => scene.id).join(', ')}`,
    ),
    result(
      'spec.asset-refs',
      missingReferences.length === 0,
      'All scene asset references resolve',
      `Unknown scene asset references: ${missingReferences.join(', ')}`,
    ),
    result(
      'spec.opener',
      openerValid,
      'Product name or core result appears within the first three seconds',
      'The opener must show the product name or core result within the first three seconds',
    ),
    result(
      'spec.transitions',
      transitionsValid,
      'Every non-final scene has a transition',
      'Every non-final scene must have a transition with positive duration',
    ),
  ];
}
