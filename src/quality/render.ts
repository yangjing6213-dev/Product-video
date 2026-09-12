// SPDX-License-Identifier: Apache-2.0
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, digest, exists } from '../pipeline/stage-state.ts';
import { command, ensureSuccess, environment, hyperframes, recordCommand } from '../pipeline/tools.ts';
import { resolveProjectAsset } from '../assets/library.ts';
import { resumeCreativePlan } from './plan.ts';
import { assertCopyApproved } from './copy.ts';
import { inspectCompositionAudio } from './audio.ts';

export async function renderQuality(root: string, project: string, name = 'review', resume = false): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(name)) throw new Error('Use a safe new output name');
  const plan = await resumeCreativePlan(root, project);
  const entry = plan.sources.find(source => source.source === 'composition-entry');
  const index = await resolveProjectAsset(root, `${path.relative(root, project).replaceAll('\\', '/')}/index.html`);
  if (!entry || digest(await readFile(index)) !== entry.sha256) throw new Error('Composition differs from frozen plan; author a new variant');
  const source = await readFile(index, 'utf8');
  if (/Math\.random\s*\(|Date\.now\s*\(|repeat\s*:\s*-1|https?:\/\/|file:\/\/|[A-Za-z]:[\\/]/.test(source)) throw new Error('Quality composition must use deterministic, local relative resources');
  const projectRelative = path.relative(root, project).replaceAll('\\', '/');
  const video = await resolveProjectAsset(root, `${projectRelative}/renders/${name}.mp4`, true);
  const reportPath = await resolveProjectAsset(root, `${projectRelative}/reports/quality-render-${name}.json`, true);
  await resolveProjectAsset(root, `${projectRelative}/reports/commands`, true);
  if (await exists(video)) {
    if (resume && await exists(reportPath)) {
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      if (report.status === 'PASS' && report.planSha256 === plan.resolvedPlanSha256 && report.videoSha256 === digest(await readFile(video))) return video;
    }
    throw new Error('Existing video preserved; choose a new output name');
  }
  if (!plan.copy) throw new Error('Copy approval required before generation: this plan has no frozen copy binding');
  await assertCopyApproved(root, project, { projectId: plan.projectId, productId: plan.productId, copySha256: plan.copy.sha256 });
  const verifyCurrentInputs = async () => {
    const current = await resumeCreativePlan(root, project);
    if (current.resolvedPlanSha256 !== plan.resolvedPlanSha256) throw new Error('Frozen plan changed during rendering');
    await assertCopyApproved(root, project, { projectId: plan.projectId, productId: plan.productId, copySha256: plan.copy!.sha256 });
    const currentIndex = await resolveProjectAsset(root, `${projectRelative}/index.html`);
    if (digest(await readFile(currentIndex)) !== entry.sha256) throw new Error('Composition hash changed during rendering');
    await resolveProjectAsset(root, `${projectRelative}/renders/${name}.mp4`, true);
    await resolveProjectAsset(root, `${projectRelative}/reports/quality-render-${name}.json`, true);
    await resolveProjectAsset(root, `${projectRelative}/reports/commands`, true);
  };
  const audioBinding = await inspectCompositionAudio(root, project, plan);
  await mkdir(path.dirname(video), { recursive: true });
  const commands = [];
  for (const [label, args] of [
    ['lint', ['lint', project, '--json']],
    ['validate', ['validate', project]],
    ['inspect', ['inspect', project, '--json', '--samples', '15', '--strict']],
  ] as const) {
    const result = await hyperframes([...args], project);
    commands.push(await recordCommand(project, `quality-${name}-${label}`, result));
    ensureSuccess(result, `Quality ${label}`);
    if (label !== 'validate') {
      const parsed = JSON.parse(result.stdout);
      if ((parsed.errorCount ?? 0) > 0 || (parsed.warningCount ?? 0) > 0) throw new Error(`Quality ${label} has unreviewed findings`);
    } else if (/contrast warnings|⚠/i.test(result.stdout + result.stderr)) throw new Error('Quality validate has unreviewed warnings');
  }
  await verifyCurrentInputs();
  if (await exists(video)) throw new Error('Existing video preserved; output appeared during preflight');
  const rendered = await hyperframes(['render', project, '--output', video, '--quality', 'standard', '--fps', '30', '--workers', '1'], project, 600_000);
  commands.push(await recordCommand(project, `quality-${name}-render`, rendered));
  ensureSuccess(rendered, 'Quality render');
  await verifyCurrentInputs();
  const env = await environment();
  const probe = await command(env.HYPERFRAMES_FFPROBE_PATH ?? 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video], { env });
  commands.push(await recordCommand(project, `quality-${name}-probe`, probe)); ensureSuccess(probe, 'Quality media probe');
  const media = JSON.parse(probe.stdout); const stream = media.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
  const durationSec = Number(media.format.duration);
  if (!stream || stream.width !== plan.width || stream.height !== plan.height || Math.abs(durationSec - plan.durationFrames / 30) > 0.05 || stream.avg_frame_rate !== '30/1') throw new Error('Rendered dimensions/duration/fps differ from frozen plan');
  const decode = await command(env.HYPERFRAMES_FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-xerror', '-i', video, '-f', 'null', '-'], { env });
  commands.push(await recordCommand(project, `quality-${name}-decode`, decode)); ensureSuccess(decode, 'Quality full decode');
  if (decode.stderr.trim()) throw new Error('Decoder reported damaged frames');
  await verifyCurrentInputs();
  await atomicJson(reportPath, { schemaVersion: '1.0', status: 'PASS', scope: 'engineering render only', humanReview: 'NOT_RUN', humanScore: null,
    planSha256: plan.resolvedPlanSha256, videoPath: path.relative(root, video).replaceAll('\\', '/'), videoSha256: digest(await readFile(video)), audioBinding,
    media: { width: stream.width, height: stream.height, durationSec, fps: 30, decodeExitCode: decode.exitCode }, commands });
  return video;
}
