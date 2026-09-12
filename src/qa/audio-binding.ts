// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { CheckResult, VideoSpec } from '../contracts.ts';
import { atomicJson, digest } from '../pipeline/stage-state.ts';
import { command, ensureSuccess, environment, recordCommand } from '../pipeline/tools.ts';

const SAMPLE_RATE = 8_000;
const LIMITS = { partialCorrelation: 0.9, normalizedResidual: 0.2, gainMin: 0.5, gainMax: 2, contribution: 0.2 };

function projectFile(project: string, relative: string): string {
  if (path.isAbsolute(relative) || path.win32.isAbsolute(relative)) throw new Error(`Audio asset path must be project-relative: ${relative}`);
  const file = path.resolve(project, relative);
  const back = path.relative(path.resolve(project), file);
  if (back === '..' || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) throw new Error(`Audio asset path escapes project: ${relative}`);
  return file;
}

function floats(bytes: Buffer): Float32Array {
  if (bytes.length % 4 !== 0) throw new Error('Decoded PCM byte length is invalid');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Float32Array.from({ length: bytes.length / 4 }, (_, index) => view.getFloat32(index * 4, true));
}

interface Metrics {
  samples: number;
  narrationPartialCorrelation: number;
  narrationGain: number;
  musicGain?: number;
  narrationToMusicGainRatio?: number;
  narrationContribution: number;
  normalizedResidual: number;
}

function metrics(final: Float32Array, narration: Float32Array, music?: Float32Array): Metrics {
  const length = Math.min(final.length, narration.length, music?.length ?? Number.POSITIVE_INFINITY);
  if (!Number.isFinite(length) || length < SAMPLE_RATE / 4) throw new Error('Decoded PCM overlap is shorter than 0.25 seconds');
  let yMean = 0, nMean = 0, mMean = 0;
  for (let i = 0; i < length; i++) { yMean += final[i]!; nMean += narration[i]!; if (music) mMean += music[i]!; }
  yMean /= length; nMean /= length; mMean /= length;
  let yy = 0, nn = 0, mm = 0, yn = 0, ym = 0, nm = 0;
  for (let i = 0; i < length; i++) {
    const y = final[i]! - yMean, n = narration[i]! - nMean, m = music ? music[i]! - mMean : 0;
    yy += y * y; nn += n * n; mm += m * m; yn += y * n; ym += y * m; nm += n * m;
  }
  if (yy <= 1e-12 || nn <= 1e-12) throw new Error('Final or narration PCM has no measurable signal');
  let narrationGain: number, musicGain: number | undefined, partial: number, residual: number;
  if (music && mm > 1e-12) {
    const determinant = nn * mm - nm * nm;
    if (determinant <= 1e-12 * nn * mm) throw new Error('Narration and music PCM cannot be separated');
    narrationGain = (yn * mm - ym * nm) / determinant;
    musicGain = (ym * nn - yn * nm) / determinant;
    const partialNumerator = yn - (ym * nm) / mm;
    const partialDenominator = Math.sqrt(Math.max(0, yy - (ym * ym) / mm) * Math.max(0, nn - (nm * nm) / mm));
    partial = partialDenominator > 1e-12 ? partialNumerator / partialDenominator : 0;
    residual = Math.sqrt(Math.max(0, yy - narrationGain * yn - musicGain * ym) / yy);
  } else {
    narrationGain = yn / nn;
    partial = yn / Math.sqrt(yy * nn);
    residual = Math.sqrt(Math.max(0, yy - narrationGain * yn) / yy);
  }
  const result: Metrics = {
    samples: length,
    narrationPartialCorrelation: partial,
    narrationGain,
    narrationContribution: Math.abs(narrationGain) * Math.sqrt(nn / yy),
    normalizedResidual: residual,
  };
  if (musicGain !== undefined) {
    result.musicGain = musicGain;
    result.narrationToMusicGainRatio = musicGain > 0 ? narrationGain / musicGain : 0;
  }
  return result;
}

async function decode(source: string, output: string, project: string, label: string): Promise<Float32Array> {
  const env = await environment();
  const result = await command(env.HYPERFRAMES_FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', source,
    '-map', '0:a:0', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', output], { env, timeoutMs: 180_000 });
  await recordCommand(project, `audio-binding-${label}`, result);
  ensureSuccess(result, `Audio binding ${label} decode`);
  return floats(await readFile(output));
}

/** Bind decoded final PCM to the frozen narration and optional static music. This is waveform evidence, not ASR. */
export async function verifyFinalAudioBinding(finalFile: string, project: string, spec: VideoSpec): Promise<CheckResult> {
  const reportFile = path.join(project, 'reports/audio-binding.json');
  if (!spec.generatorPolicy) {
    await atomicJson(reportFile, { schemaVersion: '1.0', status: 'SKIPPED_WITH_REASON', method: 'decoded-pcm-linear-mix-binding', asr: 'NOT_RUN', reason: 'Historical task has no current generator policy' });
    return { id: 'media.audio-binding', status: 'SKIPPED_WITH_REASON', message: 'Historical task preserved without current PCM mix enforcement' };
  }
  if (spec.audio.narrationMode === 'none') {
    await atomicJson(reportFile, { schemaVersion: '1.0', status: 'SKIPPED_WITH_REASON', method: 'decoded-pcm-linear-mix-binding', asr: 'NOT_RUN', reason: 'No narration is required' });
    return { id: 'media.audio-binding', status: 'SKIPPED_WITH_REASON', message: 'No narration is required; PCM binding skipped' };
  }
  const narrationAsset = spec.audio.narrationMode === 'external-audio'
    ? spec.assets.find((asset) => asset.id === spec.audio.externalAudioAssetId)
    : undefined;
  const narrationPath = narrationAsset ? narrationAsset.path : 'narration.wav';
  const musicAsset = spec.audio.musicAssetId ? spec.assets.find((asset) => asset.id === spec.audio.musicAssetId) : undefined;
  const resolvedProject = path.resolve(project);
  const work = await mkdtemp(path.join(resolvedProject, '.audio-binding-'));
  try {
    if (!narrationPath) throw new Error('Required narration asset is not declared');
    if (spec.audio.musicAssetId && !musicAsset) throw new Error('Declared music asset is missing');
    const sources = {
      final: finalFile,
      narration: projectFile(project, narrationPath),
      ...(musicAsset ? { music: projectFile(project, musicAsset.path) } : {}),
    };
    const [finalPcm, narrationPcm, musicPcm] = await Promise.all([
      decode(sources.final, path.join(work, 'final.f32le'), project, 'final'),
      decode(sources.narration, path.join(work, 'narration.f32le'), project, 'narration'),
      sources.music ? decode(sources.music, path.join(work, 'music.f32le'), project, 'music') : Promise.resolve(undefined),
    ]);
    const observed = metrics(finalPcm, narrationPcm, musicPcm);
    const gain = observed.narrationToMusicGainRatio ?? observed.narrationGain;
    const gainPass = gain >= LIMITS.gainMin && gain <= LIMITS.gainMax;
    const passed = observed.narrationPartialCorrelation >= LIMITS.partialCorrelation && observed.normalizedResidual <= LIMITS.normalizedResidual &&
      observed.narrationGain > 0 && observed.narrationContribution >= LIMITS.contribution && gainPass;
    await atomicJson(reportFile, {
      schemaVersion: '1.0', status: passed ? 'PASS' : 'FAIL', method: 'decoded-pcm-linear-mix-binding', asr: 'NOT_RUN', sampleRateHz: SAMPLE_RATE,
      final: { path: path.relative(project, finalFile).replaceAll('\\', '/'), sha256: digest(await readFile(finalFile)) },
      narration: { path: narrationPath.replaceAll('\\', '/'), sha256: digest(await readFile(sources.narration)) },
      ...(sources.music && musicAsset ? { music: { path: musicAsset.path.replaceAll('\\', '/'), sha256: digest(await readFile(sources.music)) } } : {}),
      metrics: observed, thresholds: LIMITS,
      limitation: 'PCM waveform binding verifies the declared mix sources; it does not recognize or transcribe spoken words.',
    });
    return {
      id: 'media.audio-binding', status: passed ? 'PASS' : 'FAIL',
      message: passed
        ? `Final PCM contains the frozen narration${musicAsset ? ' and static music mix' : ''} (partial correlation ${observed.narrationPartialCorrelation.toFixed(3)}, residual ${observed.normalizedResidual.toFixed(3)}); ASR NOT_RUN`
        : `Final PCM does not bind the required frozen narration${musicAsset ? '/music mix' : ''} (partial correlation ${observed.narrationPartialCorrelation.toFixed(3)}, contribution ${observed.narrationContribution.toFixed(3)}, residual ${observed.normalizedResidual.toFixed(3)}); ASR NOT_RUN`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await atomicJson(reportFile, { schemaVersion: '1.0', status: 'FAIL', method: 'decoded-pcm-linear-mix-binding', asr: 'NOT_RUN', error: message });
    return { id: 'media.audio-binding', status: 'FAIL', message: `Final narration PCM binding failed: ${message}; ASR NOT_RUN` };
  } finally {
    const resolvedWork = path.resolve(work);
    if (path.dirname(resolvedWork) !== resolvedProject || !path.basename(resolvedWork).startsWith('.audio-binding-')) {
      throw new Error(`Refusing to remove unexpected audio-binding temporary path: ${resolvedWork}`);
    }
    await rm(resolvedWork, { recursive: true, force: true });
  }
}
