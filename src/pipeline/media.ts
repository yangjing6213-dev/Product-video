import path from 'node:path';
import { stat } from 'node:fs/promises';
import type { VideoSpec, CheckResult } from '../contracts.ts';
import { checkMedia } from '../qa/checks.ts';
import { command, environment, ensureSuccess, recordCommand } from './tools.ts';
import { atomicJson } from './stage-state.ts';
import { verifyFinalAudioBinding } from '../qa/audio-binding.ts';

export async function probeMedia(file: string, project: string, reportLabel = 'ffprobe') {
  const env = await environment();
  const result = await command(env.HYPERFRAMES_FFPROBE_PATH ?? 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { env });
  await recordCommand(project, reportLabel, result); ensureSuccess(result, 'FFprobe');
  return JSON.parse(result.stdout);
}
export async function verifyMedia(file: string, project: string, spec: VideoSpec): Promise<CheckResult[]> {
  const env = await environment();
  const probe = await probeMedia(file, project);
  await atomicJson(path.join(project, 'reports/media-probe.json'), probe);
  const checks = checkMedia(probe, spec);
  const hasAudio = probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio');
  const result = await command(env.HYPERFRAMES_FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-v', 'info', '-i', file, '-vf', 'blackdetect=d=0.5:pix_th=0.10:pic_th=0.98', ...(hasAudio ? ['-af', 'silencedetect=n=-50dB:d=2'] : []), '-f', 'null', '-'], { env, timeoutMs: 180000 });
  await recordCommand(project, 'ffmpeg-decode-black-silence', result);
  checks.push({ id: 'decode', status: result.exitCode === 0 && (await stat(file)).size > 0 ? 'PASS' : 'FAIL', message: `Full decode exit ${result.exitCode}` });
  checks.push({ id: 'black-frames', status: /black_start:/.test(result.stderr) ? 'FAIL' : 'PASS', message: 'FFmpeg blackdetect: no black segment >=0.5s required' });
  const narration = spec.audio.narrationMode !== 'none';
  checks.push({ id: 'silence', status: !hasAudio || !narration ? 'SKIPPED_WITH_REASON' : /silence_start:/.test(result.stderr) ? 'FAIL' : 'PASS', message: narration ? 'Narration must have no unexpected silence >=2s' : 'No narration; silence is intentional' });
  checks.push(await verifyFinalAudioBinding(file, project, spec));
  return checks;
}

export async function contactSheet(file: string, project: string, spec: VideoSpec): Promise<string> {
  const env = await environment();
  const times = spec.scenes.map(scene => scene.heroFrameSec ?? ((scene.actualStartSec ?? 0) + (scene.actualEndSec ?? scene.plannedDurationSec)) / 2);
  const selects = times.map(t => `between(t,${t},${t + 0.02})`).join('+');
  const output = path.join(project, 'reports/contact-sheet.jpg');
  const result = await command(env.HYPERFRAMES_FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-vf', `select='${selects}',scale=640:360,tile=3x2`, '-frames:v', '1', '-update', '1', '-y', output], { env });
  await recordCommand(project, 'contact-sheet', result); ensureSuccess(result, 'Contact sheet');
  return output;
}
