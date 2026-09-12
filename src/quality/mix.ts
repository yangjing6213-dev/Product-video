// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizedRelativePath, resolveProjectAsset, writeExclusiveSnapshot } from '../assets/library.ts';
import { digest, exists } from '../pipeline/stage-state.ts';
import { command, ensureSuccess, environment } from '../pipeline/tools.ts';
import { assertCopyApproved } from './copy.ts';
import { validateAudioMix, type AudioMix } from './plan.ts';
export interface AudioMixRequest extends Omit<AudioMix, 'schemaVersion' | 'mixSha256'> { copySha256: string; voicePath: string }

/** Produce a single full-timeline PCM track. This does not synthesize speech or approve sound. */
export async function createAudioMix(root: string, project: string, input: AudioMixRequest): Promise<AudioMix> {
  const request = structuredClone(input);
  const { copySha256, voicePath, ...settings } = request;
  const projectRelative = normalizedRelativePath(path.relative(root, project));
  const provisional: AudioMix = { ...settings, schemaVersion: '1.0', mixSha256: digest('pending audio mix') };
  validateAudioMix(provisional, request.voiceSha256, request.durationSec);
  normalizedRelativePath(voicePath);
  if (!request.mixPath.startsWith(`${projectRelative}/`) || path.extname(request.mixPath) !== '.wav') throw new Error('Audio mix output path must be a new task-local .wav');
  const output = await resolveProjectAsset(root, request.mixPath, true);
  if (await exists(output)) throw new Error('Existing audio mix preserved; choose a new output path');
  await assertCopyApproved(root, project, { copySha256 });
  const sources = [
    { path: voicePath, sha256: request.voiceSha256, name: 'voice.wav' },
    { path: request.music.path, sha256: request.music.sha256, name: 'music.audio' },
    { path: request.music.licensePath, sha256: request.music.licenseSha256, name: 'license.txt' },
  ];
  const readSources = async () => Promise.all(sources.map(async source => {
    const bytes = await readFile(await resolveProjectAsset(root, source.path));
    if (digest(bytes) !== source.sha256) throw new Error(`Audio mix input hash changed: ${source.path}`);
    return bytes;
  }));
  const sourceBytes = await readSources();
  const stagingRelative = `${projectRelative}/reports/audio-mix-${randomUUID()}`;
  const staging = await resolveProjectAsset(root, stagingRelative, true);
  await mkdir(path.dirname(staging), { recursive: true });
  await mkdir(staging, { recursive: false });
  for (let i = 0; i < sources.length; i++) await writeExclusiveSnapshot(path.join(staging, sources[i]!.name), sourceBytes[i]!);
  const stageOutput = path.join(staging, 'mix.wav');
  const env = await environment();
  const channelFilters: string[] = [];
  let voiceDurationSec = 0;
  for (const name of ['voice.wav', 'music.audio']) {
    const probe = await command(env.HYPERFRAMES_FFPROBE_PATH ?? 'ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=channels,duration:format=duration', '-of', 'json', path.join(staging, name)], { env });
    ensureSuccess(probe, 'Audio mix input probe');
    const probed = JSON.parse(probe.stdout) as { streams: Array<{ channels: number; duration?: string }>; format?: { duration?: string } };
    const streams = probed.streams;
    if (streams.length !== 1 || ![1, 2].includes(streams[0]!.channels)) throw new Error('Audio mix requires a single mono or stereo stream per input');
    if (name === 'voice.wav') {
      voiceDurationSec = Number(streams[0]!.duration ?? probed.format?.duration);
      if (!Number.isFinite(voiceDurationSec) || voiceDurationSec <= 0 || voiceDurationSec + request.voiceOffsetSec > request.durationSec + 1 / 48000) throw new Error('Raw voice duration plus offset exceeds the mix timeline or cannot be verified; extend the film instead of trimming speech');
    }
    channelFilters.push(streams[0]!.channels === 1 ? 'pan=stereo|c0=c0|c1=c0' : 'anull');
  }
  const number = (value: number) => String(value);
  const filters = [
    `[0:a]${channelFilters[0]},aresample=48000,aformat=sample_fmts=fltp,volume=${number(request.voiceGainDb)}dB,adelay=${Math.round(request.voiceOffsetSec * 48000)}S:all=1,apad,atrim=duration=${number(request.durationSec)}[voice]`,
    `[1:a]${channelFilters[1]},aresample=48000,aformat=sample_fmts=fltp,volume=${number(request.musicGainDb)}dB,adelay=${Math.round(request.musicOffsetSec * 48000)}S:all=1,apad,atrim=duration=${number(request.durationSec)},afade=t=in:st=${number(request.musicOffsetSec)}:d=${number(request.fadeInSec)},afade=t=out:st=${number(request.durationSec - request.fadeOutSec)}:d=${number(request.fadeOutSec)}[music]`,
    '[voice][music]amix=inputs=2:duration=longest:normalize=0,aresample=192000,alimiter=limit=0.8413951416:level=0:latency=1,aresample=48000[mix]',
  ].join(';');
  const result = await command(env.HYPERFRAMES_FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-nostdin', '-n',
    '-i', path.join(staging, 'voice.wav'), '-i', path.join(staging, 'music.audio'), '-filter_complex', filters,
    '-map', '[mix]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', stageOutput], { env });
  await writeFile(path.join(staging, 'command.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  ensureSuccess(result, 'Audio premix');
  const outputProbe = await command(env.HYPERFRAMES_FFPROBE_PATH ?? 'ffprobe', ['-v', 'error', '-show_entries',
    'stream=codec_name,channels,sample_rate,bits_per_raw_sample,duration:format=duration', '-of', 'json', stageOutput], { env });
  ensureSuccess(outputProbe, 'Audio premix output probe');
  const media = JSON.parse(outputProbe.stdout) as { streams: Array<{ codec_name: string; channels: number; sample_rate: string; bits_per_raw_sample: string; duration?: string }>; format?: { duration?: string } };
  const stream = media.streams[0];
  const measuredDurationSec = Number(stream?.duration ?? media.format?.duration);
  if (media.streams.length !== 1 || !stream || stream.codec_name !== 'pcm_s24le' || stream.channels !== 2 || Number(stream.sample_rate) !== 48000 || Number(stream.bits_per_raw_sample) !== 24 || !Number.isFinite(measuredDurationSec) || Math.abs(measuredDurationSec - request.durationSec) > 1 / 48000) throw new Error('Measured audio mix duration or PCM format differs from the requested output');
  await writeFile(path.join(staging, 'output-probe.json'), JSON.stringify(outputProbe, null, 2), { flag: 'wx' });
  const bytes = await readFile(stageOutput);
  const completed: AudioMix = { ...provisional, mixSha256: digest(bytes) };
  await readSources();
  await assertCopyApproved(root, project, { copySha256 });
  const currentOutput = await resolveProjectAsset(root, request.mixPath, true);
  await mkdir(path.dirname(currentOutput), { recursive: true });
  const checkedOutput = await resolveProjectAsset(root, request.mixPath, true);
  await writeExclusiveSnapshot(checkedOutput, bytes);
  await writeFile(path.join(staging, 'receipt.json'), JSON.stringify({ status: 'PASS', humanSoundReview: 'NOT_RUN', copySha256,
    audioMix: completed, limiter: { ceilingDb: -1.5, oversampleRate: 192000, level: false },
    measured: { voiceDurationSec, durationSec: measuredDurationSec, sampleRate: Number(stream.sample_rate), channels: stream.channels, codec: stream.codec_name, bitsPerSample: Number(stream.bits_per_raw_sample) } }, null, 2), { flag: 'wx' });
  return completed;
}
