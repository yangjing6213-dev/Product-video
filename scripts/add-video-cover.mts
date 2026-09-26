// SPDX-License-Identifier: Apache-2.0
// Assemble a reviewed cover around an accepted local video; never regenerate voice or the original scenes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { REPO, command, environment } from '../src/pipeline/tools.ts';
import { digest } from '../src/pipeline/stage-state.ts';
import { resolveProjectAsset, writeExclusiveSnapshot } from '../src/assets/library.ts';
import { assertCopyApproved } from '../src/quality/copy.ts';
import { renderCoverPlayer } from '../src/quality/cover.ts';

const { values } = parseArgs({ options: { manifest: { type: 'string' }, 'project-root': { type: 'string', default: REPO } } });
if (!values.manifest) throw Error('--manifest is required');
const root = path.resolve(values['project-root']);
const manifestPath = await resolveProjectAsset(root, values.manifest), directory = path.dirname(manifestPath);
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (manifest.schemaVersion !== '1.0' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(manifest.outputName) || !Number.isFinite(manifest.holdSeconds) || manifest.holdSeconds < 1 || manifest.holdSeconds > 5 || !/^[a-f0-9]{64}$/.test(manifest.copySha256)) throw Error('Invalid cover manifest');
const copy = await assertCopyApproved(root, directory, { copySha256: manifest.copySha256 });
const input = async asset => {
  if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw Error('Frozen input hash required');
  const file = await resolveProjectAsset(root, asset.path);
  if (digest(await fs.readFile(file)) !== asset.sha256) throw Error('Frozen cover/video input changed');
  return file;
};
const source = await input(manifest.source), cover = await input(manifest.cover);
const master = path.join(directory, `${manifest.outputName}-master.mp4`), playback = path.join(directory, `${manifest.outputName}.mp4`);
const poster = path.join(directory, `${manifest.outputName}.png`), player = path.join(directory, 'WATCH.html');
for (const output of [master, playback, poster, player, path.join(directory, 'assembly-commands.json'), path.join(directory, 'assembly-result.json')]) {
  if (await fs.lstat(output).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw Error('Output already exists; preserve it and choose a new version directory');
}
const env = await environment(), results = [];
const run = async (exe, args) => {
  if (!exe) throw Error('Local media tool is not configured');
  const result = await command(exe, args, { cwd: root, env, timeoutMs: 600_000 });
  results.push(result);
  await fs.writeFile(path.join(directory, 'assembly-commands.json'), JSON.stringify(results, null, 2));
  if (result.exitCode !== 0) throw Error((result.stderr || result.stdout).slice(-2000));
  return result;
};
const ffmpeg = env.HYPERFRAMES_FFMPEG_PATH, probe = env.HYPERFRAMES_FFPROBE_PATH;
const media = JSON.parse((await run(probe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source])).stdout);
const video = media.streams.find(stream => stream.codec_type === 'video');
if (!video || video.width !== 1920 || video.height !== 1080 || video.avg_frame_rate !== '30/1' || !media.streams.some(stream => stream.codec_type === 'audio')) throw Error('This cover assembly requires an accepted 1080p / 30 fps video with audio');
const seconds = Math.round(manifest.holdSeconds * 30) / 30;
// The image is scaled to fit, never stretched. The approved source video is decoded without frame effects.
await run(ffmpeg, ['-v', 'error', '-n', '-loop', '1', '-framerate', '30', '-t', String(seconds), '-i', cover, '-i', source, '-itsoffset', String(seconds), '-i', source,
  '-filter_complex', `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x10161f,setsar=1,format=yuv420p,trim=end_frame=${Math.round(seconds * 30)},setpts=PTS-STARTPTS[c];[1:v]setpts=PTS-STARTPTS[v];[c][v]concat=n=2:v=1:a=0[out]`,
  '-map', '[out]', '-map', '2:a:0', '-c:v', 'libx264', '-preset', 'fast', '-qp', '0', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', master]);
await run(ffmpeg, ['-v', 'error', '-n', '-i', master, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '12', '-c:a', 'copy', '-movflags', '+faststart', playback]);
await writeExclusiveSnapshot(poster, await fs.readFile(cover));
await writeExclusiveSnapshot(player, renderCoverPlayer(copy.onScreenText.slice(0, 2).join(' · '), path.basename(playback), path.basename(poster)));
await input(manifest.source); await input(manifest.cover);
await fs.writeFile(path.join(directory, 'assembly-result.json'), JSON.stringify({ status: 'PARTIAL', note: 'Assembly only; decode, preservation, browser and visual QA still required.', holdSeconds: seconds, originalDuration: media.format.duration, input: manifest, outputs: [master, playback, poster, player].map(file => path.relative(root, file).replaceAll('\\', '/')) }, null, 2));
console.log(JSON.stringify({ master, playback, poster, player }));
