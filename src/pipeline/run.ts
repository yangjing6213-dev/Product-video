import { copyFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProductInput, CheckResult } from '../contracts.ts';
import { checkAssets } from '../qa/checks.ts';
import { atomicJson, digest, exists, hashFiles, readState, runStage } from './stage-state.ts';
import { REPO, command, ensureSuccess, environment, filesUnder, hyperframes, recordCommand } from './tools.ts';
import { inputFor, manifest, specFor } from './project.ts';
import { captureWithFallback, requireCreative, selectNarration } from './gates.ts';
import { compositionQa, writeQa } from './qa.ts';
import { contactSheet, probeMedia, verifyMedia } from './media.ts';
import {
  validateNarrationCues,
  validatePhraseTranscript,
  validateTranscriptTiming,
  type NarrationCues,
} from '../qa/narration.ts';

export const STAGE_CONTRACT_VERSIONS = {
  preflight: 1,
  capture: 1,
  creative: 1,
  voice: 2,
  qa: 3,
  draft: 1,
  final: 1,
  media: 2,
} as const;
type PipelineStage = keyof typeof STAGE_CONTRACT_VERSIONS;

export async function preflight(project: string): Promise<string[]> {
  const input = await inputFor(project);
  const checks = await checkAssets(input, project);
  const env = await environment();
  const commandReports: string[] = [];
  for (const [name, executable] of [['ffmpeg', env.HYPERFRAMES_FFMPEG_PATH ?? 'ffmpeg'], ['ffprobe', env.HYPERFRAMES_FFPROBE_PATH ?? 'ffprobe']] as const) {
    const result = await command(executable, ['-version'], { env, timeoutMs: 15000 });
    commandReports.push(await recordCommand(project, `preflight-${name}`, result));
    checks.push({ id: name, status: result.exitCode === 0 ? 'PASS' : 'FAIL', message: `Tool availability exit ${result.exitCode}` });
  }
  for (const [id, url, required] of [
    ['product-url', input.product.url, false],
    ['cta-url', input.product.cta.url, true],
  ] as const) {
    if (!url.trim()) {
      checks.push({
        id,
        status: required ? 'FAIL' : 'SKIPPED_WITH_REASON',
        message: required ? 'CTA URL is required' : 'Product URL omitted; supplied assets are required',
      });
      continue;
    }
    try {
      const parsed = new URL(url);
      const valid = ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
      checks.push({
        id,
        status: valid ? 'PASS' : 'FAIL',
        message: valid ? 'Credential-free HTTP(S) URL' : 'Only credential-free HTTP(S) URLs are allowed',
      });
    } catch {
      checks.push({ id, status: 'FAIL', message: 'URL is malformed' });
    }
  }
  const report = path.join(project, 'reports/preflight.json');
  await atomicJson(report, { schemaVersion: '1.0', projectId: input.projectId, generatedAt: new Date().toISOString(), status: checks.some(c => c.status === 'FAIL') ? 'FAIL' : 'PASS', checks });
  if (checks.some(c => c.status === 'FAIL')) throw new Error('Preflight failed; see reports/preflight.json');
  return [report, await manifest(project, input), ...commandReports];
}

type CaptureEvidenceProvider = 'hyperframes-capture' | 'supplied-assets';
interface CaptureEvidenceFile { path: string; bytes: Uint8Array }
interface PngDimensions { width: number; height: number }
export interface CaptureEvidence {
  captureCli: {
    evidenceSource: 'hyperframes-cli-stdout';
    url: string | null;
    httpStatus: number | null;
    title: string | null;
    screenshots: number | null;
    warnings: string[];
  } | null;
  viewport: {
    evidenceSource: 'png-ihdr';
    kind: 'capture-viewport' | 'supplied-asset';
    file: string;
    width: number;
    height: number;
  } | null;
}

function pngDimensions(bytes: Uint8Array): PngDimensions | null {
  if (bytes.byteLength < 24) return null;
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    !signature.every((value, index) => buffer[index] === value) ||
    buffer.readUInt32BE(8) !== 13 ||
    buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function extractCaptureEvidence(
  provider: CaptureEvidenceProvider,
  upstreamStdout: string | null,
  files: readonly CaptureEvidenceFile[],
): CaptureEvidence {
  let captureCli: CaptureEvidence['captureCli'] = null;
  if (provider === 'hyperframes-capture' && upstreamStdout?.trim()) {
    try {
      const parsed = JSON.parse(upstreamStdout) as Record<string, unknown>;
      captureCli = {
        evidenceSource: 'hyperframes-cli-stdout',
        url: typeof parsed.url === 'string' ? parsed.url : null,
        httpStatus: typeof parsed.httpStatus === 'number' && Number.isFinite(parsed.httpStatus) ? parsed.httpStatus : null,
        title: typeof parsed.title === 'string' ? parsed.title : null,
        screenshots: typeof parsed.screenshots === 'number' && Number.isFinite(parsed.screenshots) ? parsed.screenshots : null,
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((warning): warning is string => typeof warning === 'string') : [],
      };
    } catch {
      captureCli = null;
    }
  }

  const candidates = files
    .map((file) => ({ ...file, normalizedPath: file.path.replaceAll('\\', '/'), dimensions: pngDimensions(file.bytes) }))
    .filter((file): file is typeof file & { dimensions: PngDimensions } => file.dimensions !== null);
  const selected = provider === 'hyperframes-capture'
    ? candidates.find((file) => /(?:^|\/)scroll-000\.png$/i.test(file.normalizedPath))
      ?? candidates.find((file) => /(?:^|\/)scroll-\d+\.png$/i.test(file.normalizedPath))
    : candidates[0];
  return {
    captureCli,
    viewport: selected ? {
      evidenceSource: 'png-ihdr',
      kind: provider === 'hyperframes-capture' ? 'capture-viewport' : 'supplied-asset',
      file: selected.normalizedPath,
      ...selected.dimensions,
    } : null,
  };
}

export async function captureProject(project: string, suppliedOnly = false): Promise<string[]> {
  const input = await inputFor(project);
  const supplied = async () => {
    const assets = input.assets.filter(a => ['screenshot', 'image', 'screen-recording'].includes(a.type) && a.license !== 'unknown');
    const usable: string[] = [];
    for (const a of assets) if (await exists(path.join(project, a.path))) usable.push(path.join(project, a.path));
    return usable;
  };
  let result: { provider: string; files: string[]; reason?: string };
  let captureAttempted = false;
  let captureStdout: string | null = null;
  if (suppliedOnly) {
    const files = await supplied();
    if (!files.length) throw new Error('No usable supplied assets');
    result = { provider: 'supplied-assets', files, reason: 'High-quality supplied assets take priority' };
  } else {
    captureAttempted = true;
    result = await captureWithFallback(async () => {
      const captureDir = path.join(project, 'capture');
      const cmd = await hyperframes(['capture', input.product.url, '--output', captureDir, '--skip-vision', '--skip-assets', '--max-screenshots', '6', '--timeout', '60000', '--capture-budget', '90000', '--json'], REPO, 150000);
      captureStdout = cmd.stdout;
      await recordCommand(project, 'capture', cmd); ensureSuccess(cmd, 'URL capture');
      const screenshots = (await filesUnder(path.join(captureDir, 'screenshots'))).filter(f => /\.(png|jpg)$/i.test(f));
      return screenshots;
    }, supplied);
  }
  const files: Array<{ path: string; sha256: string }> = [];
  const evidenceFiles: CaptureEvidenceFile[] = [];
  for (const file of result.files) {
    const bytes = await readFile(file);
    const relative = path.relative(project, file).replaceAll('\\', '/');
    files.push({ path: relative, sha256: digest(bytes) });
    evidenceFiles.push({ path: relative, bytes });
  }
  const evidence = extractCaptureEvidence(
    result.provider === 'hyperframes-capture' ? 'hyperframes-capture' : 'supplied-assets',
    captureStdout,
    evidenceFiles,
  );
  const report = path.join(project, 'reports/capture-report.json');
  const now = new Date().toISOString();
  await atomicJson(report, {
    schemaVersion: '1.0',
    projectId: input.projectId,
    status: 'PASS',
    provider: result.provider,
    reason: result.reason ?? null,
    sourceUrl: input.product.url || null,
    captureAttempted,
    capturedAt: result.provider === 'hyperframes-capture' ? now : null,
    verifiedAt: now,
    captureCli: evidence.captureCli,
    viewport: evidence.viewport,
    files,
  });
  const commandReport = path.join(project, 'reports/commands/capture.json');
  return [report, ...result.files, ...(captureAttempted && await exists(commandReport) ? [commandReport] : [])];
}

interface DoctorCheck { name?: string; ok?: boolean }
interface ListedVoice { id?: string; language?: string; defaultLang?: string }
function productInputFromSpec(spec: Awaited<ReturnType<typeof specFor>>): ProductInput {
  return {
    schemaVersion: spec.schemaVersion,
    projectId: spec.projectId,
    product: spec.product,
    brand: spec.brand,
    assets: spec.assets,
    output: spec.output,
    audio: spec.audio,
    captions: spec.captions,
  };
}

function parseJsonOutput<T>(stdout: string, label: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function localeLanguage(locale: string): string {
  return locale.toLocaleLowerCase().split('-')[0] || locale.toLocaleLowerCase();
}

async function narrationTiming(
  project: string,
  spec: Awaited<ReturnType<typeof specFor>>,
  audio: string,
  allowPhraseCues: boolean,
) {
  const probe = await probeMedia(audio, project, 'ffprobe-narration') as { format?: { duration?: string | number }; streams?: Array<{ codec_type?: string }> };
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || !probe.streams?.some(stream => stream.codec_type === 'audio')) {
    throw new Error('Narration audio must contain a decodable audio stream with positive duration');
  }
  const transcriptFile = path.join(project, 'transcript.json');
  if (!await exists(transcriptFile)) throw new Error('Narration requires transcript.json with real measured or ASR timing before rendering');
  const transcriptBytes = await readFile(transcriptFile);
  const words = validateTranscriptTiming(parseJsonOutput<unknown>(transcriptBytes.toString('utf8'), 'Transcript'), duration);
  const sceneEnd = spec.scenes.at(-1)?.actualEndSec;
  if (sceneEnd === null || sceneEnd === undefined || Math.abs(sceneEnd - duration) > 0.5) {
    throw new Error(`Narration duration ${duration}s does not match scene timing ${sceneEnd ?? 'missing'}s; update video-spec.json from real audio timing`);
  }
  const audioSha256 = digest(await readFile(audio));
  const cueFile = path.join(project, 'reports/narration-cues.json');
  let cues: NarrationCues | null = null;
  let cuesSha256: string | null = null;
  if (allowPhraseCues && await exists(cueFile)) {
    const cueBytes = await readFile(cueFile);
    cues = validateNarrationCues(parseJsonOutput<unknown>(cueBytes.toString('utf8'), 'Narration cues'), spec, audioSha256, duration);
    validatePhraseTranscript(words, cues);
    cuesSha256 = digest(cueBytes);
  }
  return {
    durationSec: duration,
    transcriptEntryCount: words.length,
    wordCount: cues ? null : words.length,
    transcript: transcriptFile,
    transcriptSha256: digest(transcriptBytes),
    audioSha256,
    cues: cues ? cueFile : null,
    cuesSha256,
    cueCount: cues?.cues.length ?? null,
    timingSource: cues?.timingSource ?? 'whisper-cpp-asr',
    transcriptGranularity: cues ? 'phrase' : 'word',
    transcriptSource: cues ? 'measured-tts-segments' : 'whisper-cpp-asr',
    asrStatus: cues ? 'NOT_RUN' : 'PASS',
    generator: cues?.generator ?? null,
  };
}

async function voice(project: string): Promise<string[]> {
  const spec = await specFor(project);
  const report = path.join(project, 'reports/voice-report.json');
  if (spec.audio.narrationMode === 'none') {
    const mode = selectNarration('none', false, false);
    await atomicJson(report, { ...mode, requestedMode: 'none', generatedAudio: false });
    return [report];
  }

  const asset = spec.assets.find(a => a.id === spec.audio.externalAudioAssetId);
  const external = asset ? path.join(project, asset.path) : '';
  if (spec.audio.narrationMode === 'external-audio') {
    try {
      const mode = selectNarration('external-audio', false, Boolean(external && await exists(external)));
      const timing = await narrationTiming(project, spec, external, true);
      const reportTiming = {
        ...timing,
        transcript: path.relative(project, timing.transcript).replaceAll('\\', '/'),
        cues: timing.cues ? path.relative(project, timing.cues).replaceAll('\\', '/') : null,
      };
      await atomicJson(report, {
        schemaVersion: '2.0',
        ...mode,
        requestedMode: 'external-audio',
        generatedAudio: false,
        ...reportTiming,
        backend: timing.generator?.backend ?? 'external-audio',
        backendVersion: timing.generator?.backendVersion ?? null,
      });
      return [
        report,
        external,
        timing.transcript,
        ...(timing.cues ? [timing.cues] : []),
        path.join(project, 'reports/commands/ffprobe-narration.json'),
      ];
    } catch (error) {
      await atomicJson(report, { status: 'FAIL', requestedMode: 'external-audio', generatedAudio: false, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  const doctor = await hyperframes(['doctor', '--json']);
  const doctorReport = await recordCommand(project, 'tts-doctor', doctor);
  const listing = await hyperframes(['tts', '--list', '--json']);
  const listingReport = await recordCommand(project, 'tts-list', listing);
  let checks: DoctorCheck[] = [];
  let voices: ListedVoice[] = [];
  try {
    if (doctor.exitCode === 0) checks = parseJsonOutput<{ checks?: DoctorCheck[] }>(doctor.stdout, 'HyperFrames doctor').checks ?? [];
    if (listing.exitCode === 0) voices = parseJsonOutput<unknown>(listing.stdout, 'TTS voice discovery') as ListedVoice[];
  } catch (error) {
    await atomicJson(report, {
      status: 'FAIL',
      requestedMode: 'hyperframes',
      recommendedMode: 'none',
      generatedAudio: false,
      error: error instanceof Error ? error.message : String(error),
      evidence: [path.relative(project, doctorReport), path.relative(project, listingReport)],
    });
    throw error;
  }
  const ttsAvailable = checks.find(check => check.name === 'TTS (Kokoro)')?.ok === true;
  const transcriptAvailable = checks.find(check => check.name === 'whisper-cpp')?.ok === true;
  const language = localeLanguage(spec.output.locale);
  const matchingVoices = Array.isArray(voices)
    ? voices.filter(voice => voice.id && (voice.language?.toLocaleLowerCase().startsWith(language) || voice.defaultLang?.toLocaleLowerCase().startsWith(language)))
    : [];
  const selectedVoice = spec.audio.voice
    ? matchingVoices.find(voice => voice.id === spec.audio.voice)
    : matchingVoices[0];
  if (!ttsAvailable || !transcriptAvailable || !selectedVoice?.id) {
    const unavailable = [
      ...(!ttsAvailable ? ['Kokoro TTS'] : []),
      ...(!transcriptAvailable ? ['whisper-cpp transcription'] : []),
      ...(!selectedVoice?.id ? [`${language} voice`] : []),
    ];
    await atomicJson(report, {
      status: 'FAIL',
      requestedMode: 'hyperframes',
      recommendedMode: 'none',
      generatedAudio: false,
      unavailable,
      evidence: [path.relative(project, doctorReport), path.relative(project, listingReport)],
    });
    throw new Error(`Local narration runtime unavailable (${unavailable.join(', ')}); use narrationMode=none or supplied external audio`);
  }

  const narration = spec.scenes.map(scene => scene.voiceover.trim()).filter(Boolean).join('\n');
  if (!narration) {
    await atomicJson(report, { status: 'FAIL', requestedMode: 'hyperframes', recommendedMode: 'none', generatedAudio: false, error: 'No authored voiceover text' });
    throw new Error('Local narration requires authored scene voiceover text; use narrationMode=none otherwise');
  }
  const narrationText = path.join(project, 'reports/narration.txt');
  const audio = path.join(project, 'narration.wav');
  const evidence = [doctorReport, listingReport];
  try {
    await writeFile(narrationText, `${narration}\n`);
    const generated = await hyperframes(['tts', '--text-file', narrationText, '--output', audio, '--voice', selectedVoice.id, '--lang', language, '--json'], project, 600_000);
    const generatedReport = await recordCommand(project, 'tts-generate', generated);
    evidence.push(generatedReport);
    ensureSuccess(generated, 'Local narration generation');
    if (!await exists(audio)) throw new Error('TTS reported success without creating narration.wav');
    const transcribed = await hyperframes(['transcribe', audio, '--dir', project, '--language', language, '--json'], project, 600_000);
    const transcribedReport = await recordCommand(project, 'tts-transcribe', transcribed);
    evidence.push(transcribedReport);
    ensureSuccess(transcribed, 'Narration transcription');
    const timing = await narrationTiming(project, spec, audio, false);
    const reportTiming = {
      ...timing,
      transcript: path.relative(project, timing.transcript).replaceAll('\\', '/'),
      cues: null,
    };
    await atomicJson(report, {
      schemaVersion: '2.0',
      status: 'PASS',
      requestedMode: 'hyperframes',
      mode: 'hyperframes',
      generatedAudio: true,
      voice: selectedVoice.id,
      language,
      ...reportTiming,
      backend: 'hyperframes-tts',
      backendVersion: '0.8.33',
    });
    return [
      report,
      narrationText,
      audio,
      timing.transcript,
      ...evidence,
      path.join(project, 'reports/commands/ffprobe-narration.json'),
    ];
  } catch (error) {
    await atomicJson(report, {
      status: 'FAIL',
      requestedMode: 'hyperframes',
      recommendedMode: 'none',
      generatedAudio: await exists(audio),
      error: error instanceof Error ? error.message : String(error),
      evidence: evidence.map(file => path.relative(project, file).replaceAll('\\', '/')),
    });
    throw error;
  }
}

async function recordFirstPlayableDraft(project: string, observedAt?: string): Promise<void> {
  const firstPlayableDraftAt = observedAt ?? (await readState(project)).stages.draft?.finishedAt;
  if (!firstPlayableDraftAt) return;
  const file = path.join(project, 'reports/run-history.json');
  await mkdir(path.dirname(file), { recursive: true });
  try {
    const handle = await open(file, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify({ schemaVersion: '1.0', firstPlayableDraftAt }, null, 2)}\n`);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

export async function renderProject(
  project: string,
  quality: 'draft' | 'high',
  resume = true,
  compositionAlreadyChecked = false,
): Promise<string> {
  const spec = await specFor(project);
  const sources = [
    path.join(project, 'video-spec.json'),
    path.join(project, 'DESIGN.md'),
    path.join(project, 'index.html'),
    ...await filesUnder(path.join(project, 'compositions')),
    ...await filesUnder(path.join(project, 'assets')),
  ];
  const warningReview = path.join(project, 'reports/lint-warning-review.json');
  if (existsSyncFile(warningReview)) sources.push(warningReview);
  if (spec.audio.narrationMode === 'hyperframes') sources.push(path.join(project, 'narration.wav'));
  const fingerprint = await hashFiles(sources, { quality, version: 'hyperframes-0.8.33', fps: 30 });
  const output = path.join(project, 'renders', quality === 'draft' ? 'draft.mp4' : 'final.mp4');
  const stage = quality === 'draft' ? 'draft' : 'final';
  await runStage(project, stage, fingerprint, resume, async () => {
    if (!compositionAlreadyChecked) await compositionQa(project, spec);
    await mkdir(path.dirname(output), { recursive: true });
    const result = await hyperframes(['render', project, '--quality', quality, '--fps', '30', '--workers', '4', '--output', output, '--strict'], REPO, 1200000);
    await recordCommand(project, `render-${quality}`, result);
    if (result.exitCode !== 0) {
      await recordCommand(project, 'failure-doctor', await hyperframes(['doctor']));
      await recordCommand(project, 'failure-info', await hyperframes(['info', project]));
    }
    ensureSuccess(result, 'Render');
    const checks = await verifyMedia(output, project, spec);
    await atomicJson(path.join(project, `reports/${quality}-media-report.json`), { status: checks.some(c => c.status === 'FAIL') ? 'FAIL' : 'PASS', checks });
    if (checks.some(c => c.status === 'FAIL')) throw new Error('Render produced invalid media; see media report');
    await atomicJson(path.join(project, `reports/render-${quality}-report.json`), { quality, output: path.relative(project, output), durationMs: result.durationMs, exitCode: result.exitCode });
    const mediaReport = path.join(project, `reports/${quality}-media-report.json`);
    const renderReport = path.join(project, `reports/render-${quality}-report.json`);
    const commandReport = path.join(project, `reports/commands/render-${quality}.json`);
    if (quality === 'high') await copyFile(renderReport, path.join(project, 'reports/render-report.json'));
    if (quality === 'draft') await recordFirstPlayableDraft(project, new Date().toISOString());
    return {
      outputs: [
        output,
        mediaReport,
        renderReport,
        commandReport,
        ...(quality === 'high' ? [path.join(project, 'reports/render-report.json')] : []),
      ],
      durationMs: result.durationMs,
    };
  }, STAGE_CONTRACT_VERSIONS[stage]);
  if (quality === 'draft') await recordFirstPlayableDraft(project);
  return output;
}

export async function runProject(project: string, resume: boolean, suppliedOnly = false): Promise<string> {
  const runStarted = performance.now();
  const input = await inputFor(project);
  const inputHash = await hashFiles([path.join(project, 'input/product-input.json'), ...input.assets.map(a => path.join(project, a.path)).filter(existsSyncFile)], { version: '1.0' });
  const run = async (name: PipelineStage, hash: string, work: () => Promise<string[]>) => runStage(
    project,
    name,
    hash,
    resume,
    async () => ({ outputs: await work() }),
    STAGE_CONTRACT_VERSIONS[name],
  );
  try {
    await run('preflight', inputHash, () => preflight(project));
    const suppliedAssets = input.assets
      .filter(a => !a.id.startsWith('capture-'))
      .map(a => path.join(project, a.path))
      .filter(existsSyncFile);
    const captureHash = await hashFiles(suppliedAssets, {
      url: input.product.url,
      suppliedOnly,
      assets: input.assets.filter(a => !a.id.startsWith('capture-')),
    });
    await run('capture', captureHash, () => captureProject(project, suppliedOnly));
    const creative = await requireCreative(project);
    const creativeHash = await hashFiles(creative, { inputHash });
    await run('creative', creativeHash, async () => {
      const authored = await specFor(project);
      if (JSON.stringify(productInputFromSpec(authored)) !== JSON.stringify(input)) {
        throw new Error('Creative artifacts do not match current product input; refresh DESIGN.md, SCRIPT.md, STORYBOARD.md and video-spec.json');
      }
      return creative;
    });
    const spec = await specFor(project);
    const voiceInputs = [path.join(project, 'video-spec.json')];
    if (spec.audio.narrationMode === 'external-audio') {
      const external = spec.assets.find(asset => asset.id === spec.audio.externalAudioAssetId);
      if (external && existsSyncFile(path.join(project, external.path))) voiceInputs.push(path.join(project, external.path));
      if (existsSyncFile(path.join(project, 'transcript.json'))) voiceInputs.push(path.join(project, 'transcript.json'));
      if (existsSyncFile(path.join(project, 'reports/narration-cues.json'))) voiceInputs.push(path.join(project, 'reports/narration-cues.json'));
    }
    await run('voice', await hashFiles(voiceInputs, { narrationMode: spec.audio.narrationMode }), () => voice(project));
    const sourceHash = await hashFiles([
      path.join(project, 'index.html'),
      ...creative,
      ...await filesUnder(path.join(project, 'assets')),
      ...await filesUnder(path.join(project, 'compositions')),
      ...(spec.audio.narrationMode !== 'none'
        ? ['transcript.json', 'reports/voice-report.json', 'reports/narration-cues.json']
            .map(file => path.join(project, file))
            .filter(existsSyncFile)
        : []),
      ...(existsSyncFile(path.join(project, 'reports/lint-warning-review.json'))
        ? [path.join(project, 'reports/lint-warning-review.json')]
        : []),
    ]);
    await runStage(project, 'qa', sourceHash, resume, async () => ({
      checks: await compositionQa(project, spec),
      outputs: [
        path.join(project, 'reports/browser-layout.json'),
        ...['lint', 'validate', 'inspect'].map(label => path.join(project, `reports/commands/hyperframes-${label}.json`)),
      ],
    }), STAGE_CONTRACT_VERSIONS.qa);
    await renderProject(project, 'draft', resume, true);
    const final = await renderProject(project, 'high', resume, true);
    await run('media', await hashFiles([final, path.join(project, 'video-spec.json')]), async () => {
      const previous = JSON.parse(await readFile(path.join(project, 'reports/qa-report.json'), 'utf8')) as { checks: CheckResult[] };
      const checks = [...previous.checks, ...await verifyMedia(final, project, spec)];
      const qa = await writeQa(project, spec, checks);
      if (checks.some(c => c.status === 'FAIL')) throw new Error('Final media QA failed');
      return [
        qa,
        path.join(project, 'reports/qa-report.md'),
        path.join(project, 'reports/media-probe.json'),
        path.join(project, 'reports/commands/ffprobe.json'),
        path.join(project, 'reports/commands/ffmpeg-decode-black-silence.json'),
        await contactSheet(final, project, spec),
        path.join(project, 'reports/commands/contact-sheet.json'),
      ];
    });
    return await writeRunReport(project, input, inputHash, runStarted);
  } catch (error) { await writeRunReport(project, input, inputHash, runStarted, error instanceof Error ? error.message : String(error)); throw error; }
}
import { existsSync as existsSyncFile } from 'node:fs';
interface ScorecardSummary {
  benchmarkStatus: 'PASS' | 'FAIL' | 'PARTIAL' | null;
  manualCorrectionMinutes: number | null;
}

async function scorecardSummary(project: string, input: ProductInput): Promise<ScorecardSummary> {
  const scorecardFile = path.join(project, 'reports/scorecard.json');
  const finalVideo = path.join(project, 'renders/final.mp4');
  if (!await exists(scorecardFile) || !await exists(finalVideo)) {
    return { benchmarkStatus: null, manualCorrectionMinutes: null };
  }
  try {
    const scorecard = JSON.parse(await readFile(scorecardFile, 'utf8')) as {
      projectId?: unknown;
      status?: unknown;
      finalVideoSha256?: unknown;
      manualCorrectionMinutes?: unknown;
    };
    const currentHash = digest(await readFile(finalVideo));
    const status = ['PASS', 'FAIL', 'PARTIAL'].includes(String(scorecard.status))
      ? scorecard.status as ScorecardSummary['benchmarkStatus']
      : null;
    const minutes = scorecard.manualCorrectionMinutes;
    if (
      scorecard.projectId !== input.projectId ||
      typeof scorecard.finalVideoSha256 !== 'string' ||
      scorecard.finalVideoSha256.toLocaleLowerCase() !== currentHash ||
      status === null ||
      typeof minutes !== 'number' ||
      !Number.isFinite(minutes) ||
      minutes < 0
    ) {
      return { benchmarkStatus: null, manualCorrectionMinutes: null };
    }
    return { benchmarkStatus: status, manualCorrectionMinutes: minutes };
  } catch {
    return { benchmarkStatus: null, manualCorrectionMinutes: null };
  }
}

interface CommandSummary {
  command: string[];
  exitCode: number;
  durationMs: number;
  reportPath: string;
}

function projectRelative(project: string, file: string): string {
  return path.relative(project, file).replaceAll('\\', '/');
}

async function existingProjectPath(project: string, relative: string): Promise<string | null> {
  return await exists(path.join(project, relative)) ? relative : null;
}

async function commandSummaries(project: string): Promise<CommandSummary[]> {
  const summaries: CommandSummary[] = [];
  const files = (await filesUnder(path.join(project, 'reports/commands')))
    .filter(file => file.toLocaleLowerCase().endsWith('.json'))
    .sort();
  for (const file of files) {
    try {
      const value = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
      if (
        !Array.isArray(value.command) ||
        !value.command.every((part): part is string => typeof part === 'string') ||
        typeof value.exitCode !== 'number' || !Number.isFinite(value.exitCode) ||
        typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs)
      ) continue;
      summaries.push({
        command: value.command,
        exitCode: value.exitCode,
        durationMs: value.durationMs,
        reportPath: projectRelative(project, file),
      });
    } catch {
      // A malformed retained command report is omitted rather than represented as executed evidence.
    }
  }
  return summaries;
}

async function qaSummary(project: string): Promise<{
  status: 'PASS' | 'FAIL' | 'PARTIAL' | null;
  paths: Record<string, string | null>;
}> {
  const reportPath = 'reports/qa-report.json';
  let status: 'PASS' | 'FAIL' | 'PARTIAL' | null = null;
  if (await exists(path.join(project, reportPath))) {
    try {
      const report = JSON.parse(await readFile(path.join(project, reportPath), 'utf8')) as Record<string, unknown>;
      if (report.status === 'PASS' || report.status === 'FAIL' || report.status === 'PARTIAL') status = report.status;
    } catch {
      status = null;
    }
  }
  return {
    status,
    paths: {
      report: await existingProjectPath(project, reportPath),
      markdown: await existingProjectPath(project, 'reports/qa-report.md'),
      browserLayout: await existingProjectPath(project, 'reports/browser-layout.json'),
      mediaReport: await existingProjectPath(project, 'reports/high-media-report.json'),
    },
  };
}

async function creativeVersions(project: string): Promise<{
  recipeVersion: string | null;
  promptVersions: Record<string, string>;
}> {
  try {
    const spec = await specFor(project);
    return { recipeVersion: spec.recipeVersion, promptVersions: spec.promptVersions };
  } catch {
    return { recipeVersion: null, promptVersions: {} };
  }
}

async function writeRunReport(
  project: string,
  input: ProductInput,
  inputHash: string,
  runStarted: number,
  error?: string,
): Promise<string> {
  const state = await readState(project);
  const scorecard = await scorecardSummary(project, input);
  const creative = await creativeVersions(project);
  const commands = await commandSummaries(project);
  const qa = await qaSummary(project);
  const artifacts = {
    draft: await existingProjectPath(project, 'renders/draft.mp4'),
    final: await existingProjectPath(project, 'renders/final.mp4'),
    contactSheet: await existingProjectPath(project, 'reports/contact-sheet.jpg'),
    scorecard: await existingProjectPath(project, 'reports/scorecard.json'),
  };
  const cumulativeStageDurationMs = Object.values(state.stages).reduce(
    (total, stage) => total + (typeof stage.durationMs === 'number' && Number.isFinite(stage.durationMs) ? stage.durationMs : 0),
    0,
  );
  const renderStageDurationMs = ['draft', 'final'].reduce((total, name) => {
    const duration = state.stages[name]?.durationMs;
    return total + (typeof duration === 'number' && Number.isFinite(duration) ? duration : 0);
  }, 0);
  const file = path.join(project, 'reports/run-report.json');
  const stageStatus = error ? 'FAIL' : 'PASS';
  await atomicJson(file, {
    schemaVersion: '1.0',
    projectId: input.projectId,
    inputHash,
    recipeVersion: creative.recipeVersion,
    promptVersions: creative.promptVersions,
    versions: { hyperframes: '0.8.33', node: process.version, pipeline: '1.0', stageContracts: STAGE_CONTRACT_VERSIONS },
    stages: state.stages,
    status: stageStatus,
    stageStatus,
    benchmarkStatus: scorecard.benchmarkStatus,
    error: error ?? null,
    commands,
    commandReportsDirectory: 'reports/commands/',
    qa,
    artifacts,
    durations: {
      currentRunElapsedMs: performance.now() - runStarted,
      cumulativeStageDurationMs,
      renderStageDurationMs,
      currentRunElapsedDefinition: 'Elapsed time in this runProject invocation through report aggregation',
      cumulativeStageDurationDefinition: 'Sum of each persisted stage record latest durationMs; not wall-clock elapsed time',
    },
    manualCorrectionMinutes: scorecard.manualCorrectionMinutes,
    remainingRisks: scorecard.benchmarkStatus === null
      ? ['Visual scorecard and manual correction time require separate review']
      : [],
    generatedAt: new Date().toISOString(),
  });
  return file;
}
