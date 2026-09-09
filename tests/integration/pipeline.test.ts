import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ProductInput, VideoSpec } from '../../src/contracts.ts';
import { main } from '../../src/cli.ts';
import { initialize } from '../../src/pipeline/project.ts';
import { verifyMedia } from '../../src/pipeline/media.ts';
import { sourceChecks } from '../../src/pipeline/qa.ts';
import { captureProject, extractCaptureEvidence, renderProject, runProject, STAGE_CONTRACT_VERSIONS } from '../../src/pipeline/run.ts';
import { digest, hashFiles, readState, runStage, type RunState } from '../../src/pipeline/stage-state.ts';
import {
  command,
  environment,
  filesUnder,
  installCommandRunnerForTests,
  REPO,
  type CommandResult,
} from '../../src/pipeline/tools.ts';
import { validProductInput, validVideoSpec } from '../fixtures/input.ts';

interface ProjectFixture {
  project: string;
  input: ProductInput;
  spec: VideoSpec;
  asset: string;
}

function pngIhdr(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeProject(options: { creative?: boolean; productUrl?: string } = {}): Promise<ProjectFixture> {
  const project = await mkdtemp(path.join(tmpdir(), 'epvs pipeline with spaces '));
  const input = structuredClone(validProductInput);
  input.projectId = `integration-${randomUUID()}`;
  input.product.url = options.productUrl ?? 'https://example.com/product';
  input.brand.fontFamilies = ['Microsoft YaHei', 'Segoe UI'];
  input.assets = [
    {
      id: 'hero-shot',
      type: 'screenshot',
      path: 'assets/Hero Image.svg',
      sourceUrl: 'https://example.com/product',
      license: 'owned',
      required: true,
      fallbackAssetId: null,
    },
  ];
  input.brand.logoAssetId = 'hero-shot';
  const asset = path.join(project, input.assets[0]!.path);
  await mkdir(path.dirname(asset), { recursive: true });
  await writeFile(asset, '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="white"/></svg>');
  await writeJson(path.join(project, 'input/product-input.json'), input);

  const spec = structuredClone(validVideoSpec);
  Object.assign(spec, {
    projectId: input.projectId,
    product: input.product,
    brand: input.brand,
    assets: input.assets,
    output: input.output,
    audio: input.audio,
    captions: input.captions,
  });
  for (const scene of spec.scenes) scene.assetRefs = ['hero-shot'];

  if (options.creative) {
    await writeJson(path.join(project, 'video-spec.json'), spec);
    await writeFile(path.join(project, 'DESIGN.md'), `# Design\n\n${spec.brand.colors.join('\n')}\n`);
    await writeFile(path.join(project, 'SCRIPT.md'), '# Script\n');
    await writeFile(path.join(project, 'STORYBOARD.md'), '# Storyboard\n');
    const scenes = spec.scenes.map((scene) => `<section class="scene" id="${scene.id}">
      <img class="logo" src="assets/Hero%20Image.svg" width="100" height="100" alt="logo">
      <h1>${scene.id}</h1><div class="media-crop"></div><span class="caption">Caption</span>
    </section>`).join('\n');
    await writeFile(path.join(project, 'index.html'), `<!doctype html><html><head><style>
      html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0A0A0A;color:#F5F5F5;font-family:"Microsoft YaHei","Segoe UI",sans-serif} .scene{position:absolute;inset:0}
      .logo{position:absolute;left:200px;top:100px}.scene h1{position:absolute;left:400px;top:200px;width:800px;height:100px;margin:0;font-size:64px;line-height:1.2}
      .caption{position:absolute;left:300px;bottom:100px;width:600px;height:48px;font-size:32px;line-height:48px}
      .media-crop{position:absolute;left:1000px;top:300px;width:500px;height:300px}
    </style></head><body>${scenes}</body></html>`);
    await mkdir(path.join(project, 'compositions'), { recursive: true });
    for (const scene of spec.scenes) {
      await writeFile(path.join(project, scene.compositionFile), '<!doctype html><html><body>invalid scene</body></html>');
    }
  }

  return { project, input, spec, asset };
}

async function withPortableMediaTools<T>(work: () => Promise<T>): Promise<T> {
  const env = await environment();
  assert.equal(typeof env.HYPERFRAMES_FFMPEG_PATH, 'string', 'portable FFmpeg path must be configured');
  assert.equal(typeof env.HYPERFRAMES_FFPROBE_PATH, 'string', 'portable FFprobe path must be configured');
  return work();
}

function passStage(fingerprint: string, outputs: string[], outputHashes: Record<string, string>, contractVersion = 1) {
  return {
    status: 'PASS' as const,
    fingerprint,
    contractVersion,
    startedAt: '2026-09-09T00:00:00.000Z',
    finishedAt: '2026-09-09T00:00:01.000Z',
    durationMs: 1000,
    result: { outputs, outputHashes },
  };
}

async function seedFullyCachedRun(fixture: ProjectFixture): Promise<RunState> {
  const { project, input, spec } = fixture;
  const marker = path.join(project, 'cached-output.txt');
  const markerRelative = 'cached-output.txt';
  const draft = path.join(project, 'renders/draft.mp4');
  const final = path.join(project, 'renders/final.mp4');
  await mkdir(path.dirname(draft), { recursive: true });
  await writeFile(marker, 'cached');
  await writeFile(draft, 'cached draft');
  await writeFile(final, 'cached final');

  const creative = ['DESIGN.md', 'SCRIPT.md', 'STORYBOARD.md', 'video-spec.json'].map((file) =>
    path.join(project, file),
  );
  const compositions = await filesUnder(path.join(project, 'compositions'));
  const inputHash = await hashFiles(
    [path.join(project, 'input/product-input.json'), ...input.assets.map((asset) => path.join(project, asset.path))],
    { version: '1.0' },
  );
  const captureHash = await hashFiles(
    input.assets.map((asset) => path.join(project, asset.path)),
    {
      url: input.product.url,
      suppliedOnly: true,
      assets: input.assets.filter((asset) => !asset.id.startsWith('capture-')),
    },
  );
  const creativeHash = await hashFiles(creative, { inputHash });
  const voiceHash = await hashFiles([path.join(project, 'video-spec.json')], { narrationMode: spec.audio.narrationMode });
  const sourceHash = await hashFiles([
    path.join(project, 'index.html'),
    ...creative,
    ...spec.assets.map((asset) => path.join(project, asset.path)),
    ...compositions,
  ]);
  const renderSources = [
    path.join(project, 'video-spec.json'),
    path.join(project, 'DESIGN.md'),
    path.join(project, 'index.html'),
    ...compositions,
    ...spec.assets.map((asset) => path.join(project, asset.path)),
  ];
  const draftHash = await hashFiles(renderSources, { quality: 'draft', version: 'hyperframes-0.8.33', fps: 30 });
  const finalHash = await hashFiles(renderSources, { quality: 'high', version: 'hyperframes-0.8.33', fps: 30 });
  const mediaHash = await hashFiles([final, path.join(project, 'video-spec.json')]);
  const markerHashes = { [markerRelative]: digest('cached') };
  const state: RunState = {
    schemaVersion: '1.0',
    stages: {
      preflight: passStage(inputHash, [markerRelative], markerHashes),
      capture: passStage(captureHash, [markerRelative], markerHashes),
      creative: passStage(creativeHash, [markerRelative], markerHashes),
      voice: passStage(voiceHash, [markerRelative], markerHashes, STAGE_CONTRACT_VERSIONS.voice),
      qa: passStage(sourceHash, [markerRelative], markerHashes, STAGE_CONTRACT_VERSIONS.qa),
      draft: passStage(draftHash, [markerRelative], markerHashes),
      final: passStage(finalHash, [markerRelative], markerHashes),
      media: passStage(mediaHash, [markerRelative], markerHashes, STAGE_CONTRACT_VERSIONS.media),
    },
  };
  await writeJson(path.join(project, 'run-state.json'), state);
  return state;
}

test('initialize is idempotent for the same source input and never overwrites existing project data', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'epvs init source '));
  const input = structuredClone(validProductInput);
  input.projectId = `integration-${randomUUID()}`;
  input.assets = [{ ...input.assets[0]!, path: 'Source Logo.svg' }];
  await writeFile(path.join(source, 'Source Logo.svg'), '<svg>original</svg>');
  const inputFile = path.join(source, 'product input.json');
  await writeJson(inputFile, input);
  const expectedProject = path.join(REPO, 'projects', input.projectId);

  try {
    const project = await initialize(inputFile);
    await writeFile(path.join(project, 'USER-NOTES.md'), 'preserve me');
    assert.equal(await initialize(inputFile), project);
    assert.equal(await readFile(path.join(project, 'USER-NOTES.md'), 'utf8'), 'preserve me');
    assert.equal(await readFile(path.join(project, 'assets/brand-logo.svg'), 'utf8'), '<svg>original</svg>');
  } finally {
    await rm(expectedProject, { recursive: true, force: true });
  }
});

test('initialize recognizes equivalent legacy asset paths by id and bytes without migrating user files', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'epvs legacy init source '));
  const input = structuredClone(validProductInput);
  input.projectId = `integration-${randomUUID()}`;
  input.assets = [{ ...input.assets[0]!, id: 'logo', path: 'Incoming Logo.png' }];
  input.brand.logoAssetId = 'logo';
  await writeFile(path.join(source, 'Incoming Logo.png'), 'same image bytes');
  const inputFile = path.join(source, 'product input.json');
  await writeJson(inputFile, input);
  const project = path.join(REPO, 'projects', input.projectId);
  const legacy = structuredClone(input);
  legacy.assets[0]!.path = 'assets/enhe-logo-gradient.png';
  try {
    await mkdir(path.join(project, 'input'), { recursive: true });
    await mkdir(path.join(project, 'assets'), { recursive: true });
    await writeJson(path.join(project, 'input/product-input.json'), legacy);
    await writeFile(path.join(project, 'assets/enhe-logo-gradient.png'), 'same image bytes');
    await writeFile(path.join(project, 'USER-NOTES.md'), 'preserve me');

    assert.equal(await initialize(inputFile), project);
    assert.equal(await readFile(path.join(project, 'USER-NOTES.md'), 'utf8'), 'preserve me');
    await assert.rejects(readFile(path.join(project, 'assets/logo.png')), /ENOENT/);

    await writeFile(path.join(source, 'Incoming Logo.png'), 'different image bytes');
    await assert.rejects(initialize(inputFile), /different input/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('a fully cached --resume run executes no third-party commands', async () => {
  const fixture = await makeProject({ creative: true });
  const before = await seedFullyCachedRun(fixture);

  const report = await runProject(fixture.project, true, true);

  assert.equal(path.basename(report), 'run-report.json');
  assert.deepEqual((await readState(fixture.project)).stages, before.stages);
  const commandDir = path.join(fixture.project, 'reports/commands');
  await assert.rejects(readdir(commandDir), /ENOENT/);
});

test('direct verify-input, capture, and qa commands honor --resume stage reuse', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'epvs direct resume source '));
  const input = structuredClone(validProductInput);
  input.projectId = `integration-${randomUUID()}`;
  input.brand.fontFamilies = ['Microsoft YaHei', 'Segoe UI'];
  input.assets = [{ ...input.assets[0]!, type: 'screenshot', path: 'Incoming Logo.svg', fallbackAssetId: null }];
  input.product.features[0]!.evidenceAssetIds = ['brand-logo'];
  await writeFile(path.join(source, 'Incoming Logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="white"/></svg>');
  const inputFile = path.join(source, 'product input.json');
  await writeJson(inputFile, input);
  const project = await initialize(inputFile);
  const canonicalInput = JSON.parse(await readFile(path.join(project, 'input/product-input.json'), 'utf8')) as ProductInput;
  const spec = structuredClone(validVideoSpec);
  Object.assign(spec, {
    projectId: canonicalInput.projectId,
    product: canonicalInput.product,
    brand: canonicalInput.brand,
    assets: canonicalInput.assets,
    output: canonicalInput.output,
    audio: canonicalInput.audio,
    captions: canonicalInput.captions,
  });
  for (const scene of spec.scenes) scene.assetRefs = ['brand-logo'];
  await writeJson(path.join(project, 'video-spec.json'), spec);
  await writeFile(path.join(project, 'DESIGN.md'), `# Design\n\n${spec.brand.colors.join('\n')}\n`);
  await writeFile(path.join(project, 'SCRIPT.md'), '# Script\n');
  await writeFile(path.join(project, 'STORYBOARD.md'), '# Storyboard\n');
  const scenes = spec.scenes.map((scene) => `<section class="scene" id="${scene.id}">
    <img class="logo" src="assets/brand-logo.svg" width="100" height="100" alt="logo">
    <h1>${scene.id}</h1><div class="media-crop"></div><span class="caption">Caption</span>
  </section>`).join('\n');
  await writeFile(path.join(project, 'index.html'), `<!doctype html><html><head><style>
    html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0A0A0A;color:#F5F5F5;font-family:"Microsoft YaHei","Segoe UI",sans-serif}.scene{position:absolute;inset:0}
    .logo{position:absolute;left:200px;top:100px}.scene h1{position:absolute;left:400px;top:200px;width:800px;height:100px;margin:0;font-size:64px;line-height:1.2}
    .caption{position:absolute;left:300px;bottom:100px;width:600px;height:48px;font-size:32px;line-height:48px}
    .media-crop{position:absolute;left:1000px;top:300px;width:500px;height:300px}
  </style></head><body>${scenes}</body></html>`);
  await mkdir(path.join(project, 'compositions'), { recursive: true });
  for (const scene of spec.scenes) await writeFile(path.join(project, scene.compositionFile), '<!doctype html><html><body>scene</body></html>');

  let allowCommands = true;
  const originalLog = console.log;
  console.log = () => undefined;
  const restore = installCommandRunnerForTests(async (_executable, args) => {
    if (!allowCommands) throw new Error('direct resume invoked an external command');
    return fakeResult(args, 0, ['lint', 'inspect'].includes(args[1] ?? '') ? JSON.stringify({ issues: [] }) : '');
  });
  try {
    await main(['verify-input', '--project', input.projectId, '--resume']);
    await main(['capture', '--project', input.projectId, '--supplied-only', '--resume']);
    await main(['qa', '--project', input.projectId, '--resume']);
    allowCommands = false;
    await main(['verify-input', '--project', input.projectId, '--resume']);
    await main(['capture', '--project', input.projectId, '--supplied-only', '--resume']);
    await main(['qa', '--project', input.projectId, '--resume']);
  } finally {
    restore();
    console.log = originalLog;
    await rm(project, { recursive: true, force: true });
  }
});

test('a completed real pipeline run resumes without re-running any external command', async () => {
  const fixture = await makeProject({ creative: true });
  let allowCommands = true;
  const restore = installCommandRunnerForTests(async (_executable, args) => {
    if (!allowCommands) throw new Error('resume invoked an external command');
    const subcommand = args[1];
    if (subcommand === 'render') {
      const outputIndex = args.indexOf('--output');
      const output = args[outputIndex + 1]!;
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, `valid fake ${args[args.indexOf('--quality') + 1]} media`);
    }
    if (args.includes('-show_streams')) {
      return fakeResult(args, 0, JSON.stringify({
        format: { duration: fixture.spec.output.targetDurationSec },
        streams: [{
          codec_type: 'video',
          codec_name: 'h264',
          width: fixture.spec.output.width,
          height: fixture.spec.output.height,
          avg_frame_rate: `${fixture.spec.output.fps}/1`,
        }],
      }));
    }
    if (args.some((argument) => argument.includes('tile=3x2'))) {
      await writeFile(args.at(-1)!, 'fake contact sheet');
    }
    return fakeResult(args, 0, ['lint', 'inspect'].includes(subcommand ?? '') ? JSON.stringify({ issues: [] }) : '');
  });
  try {
    await runProject(fixture.project, false, true);
    const historyFile = path.join(fixture.project, 'reports/run-history.json');
    const firstHistory = JSON.parse(await readFile(historyFile, 'utf8')) as {
      firstPlayableDraftAt: string;
      operatorNote?: string;
    };
    assert.equal(typeof firstHistory.firstPlayableDraftAt, 'string');
    await writeJson(historyFile, { ...firstHistory, operatorNote: 'preserve this evidence' });
    const finalVideo = path.join(fixture.project, 'renders/final.mp4');
    await writeJson(path.join(fixture.project, 'reports/scorecard.json'), {
      schemaVersion: '1.0',
      projectId: fixture.input.projectId,
      status: 'PASS',
      finalVideoSha256: digest(await readFile(finalVideo)),
      manualCorrectionMinutes: 12,
    });
    const before = await readState(fixture.project);
    assert.ok(Object.entries(before.stages).every(
      ([name, stage]) => stage.contractVersion === STAGE_CONTRACT_VERSIONS[name as keyof typeof STAGE_CONTRACT_VERSIONS],
    ));
    allowCommands = false;
    const report = await runProject(fixture.project, true, true);
    assert.deepEqual((await readState(fixture.project)).stages, before.stages);
    const scoredRun = JSON.parse(await readFile(report, 'utf8')) as {
      stageStatus: string;
      benchmarkStatus: string | null;
      manualCorrectionMinutes: number | null;
      recipeVersion: string | null;
      promptVersions: Record<string, string>;
      commands: Array<{ command: string[]; exitCode: number; durationMs: number; reportPath: string }>;
      qa: { status: string | null; paths: Record<string, string | null> };
      artifacts: Record<string, string | null>;
      durations: { currentRunElapsedMs: number; cumulativeStageDurationMs: number; renderStageDurationMs: number };
      versions: { stageContracts: Record<string, number> };
    };
    assert.equal(scoredRun.stageStatus, 'PASS');
    assert.equal(scoredRun.benchmarkStatus, 'PASS');
    assert.equal(scoredRun.manualCorrectionMinutes, 12);
    assert.equal(scoredRun.recipeVersion, fixture.spec.recipeVersion);
    assert.deepEqual(scoredRun.promptVersions, fixture.spec.promptVersions);
    assert.ok(scoredRun.commands.length > 0);
    assert.ok(scoredRun.commands.every((item) => Array.isArray(item.command) && Number.isFinite(item.exitCode) && Number.isFinite(item.durationMs) && item.reportPath.startsWith('reports/commands/')));
    assert.equal(scoredRun.qa.status, 'PASS');
    assert.equal(scoredRun.qa.paths.report, 'reports/qa-report.json');
    assert.equal(scoredRun.artifacts.draft, 'renders/draft.mp4');
    assert.equal(scoredRun.artifacts.final, 'renders/final.mp4');
    assert.equal(scoredRun.artifacts.contactSheet, 'reports/contact-sheet.jpg');
    assert.equal(scoredRun.artifacts.scorecard, 'reports/scorecard.json');
    assert.ok(scoredRun.durations.currentRunElapsedMs >= 0);
    assert.ok(scoredRun.durations.cumulativeStageDurationMs > 0);
    assert.ok(scoredRun.durations.renderStageDurationMs > 0);
    assert.deepEqual(Object.keys(scoredRun.versions.stageContracts).sort(), ['capture', 'creative', 'draft', 'final', 'media', 'preflight', 'qa', 'voice']);
    assert.equal(
      (JSON.parse(await readFile(historyFile, 'utf8')) as { operatorNote?: string }).operatorNote,
      'preserve this evidence',
    );
    await writeJson(path.join(fixture.project, 'reports/scorecard.json'), {
      schemaVersion: '1.0',
      projectId: fixture.input.projectId,
      status: 'PASS',
      finalVideoSha256: '0'.repeat(64),
      manualCorrectionMinutes: 1,
    });
    await runProject(fixture.project, true, true);
    const staleScorecardRun = JSON.parse(await readFile(report, 'utf8')) as {
      benchmarkStatus: string | null;
      manualCorrectionMinutes: number | null;
    };
    assert.equal(staleScorecardRun.benchmarkStatus, null);
    assert.equal(staleScorecardRun.manualCorrectionMinutes, null);
  } finally {
    restore();
  }
});

test('the first playable draft timestamp survives an explicit rerender', async () => {
  const fixture = await makeProject({ creative: true });
  const restore = installCommandRunnerForTests(async (_executable, args) => {
    if (args[1] === 'render') {
      const output = args[args.indexOf('--output') + 1]!;
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, 'valid fake draft');
    }
    if (args.includes('-show_streams')) {
      return fakeResult(args, 0, JSON.stringify({
        format: { duration: fixture.spec.output.targetDurationSec },
        streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30/1' }],
      }));
    }
    return fakeResult(args, 0);
  });
  try {
    await renderProject(fixture.project, 'draft', false, true);
    const historyFile = path.join(fixture.project, 'reports/run-history.json');
    const history = JSON.parse(await readFile(historyFile, 'utf8')) as { firstPlayableDraftAt: string };
    await writeJson(historyFile, { ...history, operatorNote: 'keep' });
    await renderProject(fixture.project, 'draft', false, true);
    assert.deepEqual(JSON.parse(await readFile(historyFile, 'utf8')), { ...history, operatorNote: 'keep' });
  } finally {
    restore();
  }
});

test('an undeclared local asset dependency invalidates source and render fingerprints', async () => {
  const fixture = await makeProject({ creative: true });
  await seedFullyCachedRun(fixture);
  await writeFile(path.join(fixture.project, 'assets/runtime.js'), 'new local dependency');
  const restore = installCommandRunnerForTests(async (_executable, args) =>
    fakeResult(args, args[1] === 'lint' ? 2 : 0, '', args[1] === 'lint' ? 'lint reran' : ''),
  );
  try {
    await assert.rejects(runProject(fixture.project, true, true), /HyperFrames lint failed/);
  } finally {
    restore();
  }
});

test('changing the reviewed HyperFrames warning evidence invalidates cached QA', async () => {
  const fixture = await makeProject({ creative: true });
  await seedFullyCachedRun(fixture);
  await writeJson(path.join(fixture.project, 'reports/lint-warning-review.json'), { reviews: [] });
  const restore = installCommandRunnerForTests(async (_executable, args) =>
    fakeResult(args, args[1] === 'lint' ? 2 : 0, '{}', args[1] === 'lint' ? 'lint reran' : ''),
  );
  try {
    await assert.rejects(runProject(fixture.project, true, true), /HyperFrames lint failed/);
  } finally {
    restore();
  }
});

test('resume reruns a stage when a cached output exists but its bytes changed', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'epvs output integrity '));
  const output = path.join(project, 'artifact.txt');
  let calls = 0;
  const operation = async () => {
    calls += 1;
    await writeFile(output, `version-${calls}`);
    return { outputs: [output] };
  };

  await runStage(project, 'artifact', 'same-input', true, operation);
  await writeFile(output, 'tampered');
  await runStage(project, 'artifact', 'same-input', true, operation);

  assert.equal(calls, 2);
  assert.equal(await readFile(output, 'utf8'), 'version-2');
});

test('run state stores project-relative outputs while runStage returns usable absolute paths', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'epvs relative state '));
  const output = path.join(project, 'reports/artifact.json');
  await mkdir(path.dirname(output), { recursive: true });
  const first = await runStage(project, 'report', 'hash', true, async () => {
    await writeFile(output, '{}');
    return { outputs: [output] };
  });
  const persisted = await readState(project);

  assert.deepEqual(persisted.stages.report?.result?.outputs, ['reports/artifact.json']);
  assert.equal(JSON.stringify(persisted).includes(project), false);
  assert.deepEqual(first.result.outputs, [output]);
  const cached = await runStage(project, 'report', 'hash', true, async () => {
    throw new Error('must stay cached');
  });
  assert.deepEqual(cached.result.outputs, [output]);
});

test('runStage refuses concurrent stages in one project and recovers after the owner exits', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'epvs exclusive project '));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = runStage(project, 'first', 'one', false, async () => {
    await held;
    return { outputs: [] };
  });
  while ((await readState(project)).stages.first?.status !== 'RUNNING') await new Promise((resolve) => setTimeout(resolve, 5));

  await assert.rejects(
    runStage(project, 'second', 'two', false, async () => ({ outputs: [] })),
    /already running/i,
  );
  release();
  await first;

  await runStage(project, 'second', 'two', false, async () => ({ outputs: [] }));
  assert.equal((await readState(project)).stages.second?.status, 'PASS');
});

test('runStage recovers a lock left by a dead process', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'epvs stale lock '));
  await writeJson(path.join(project, '.pipeline.lock'), {
    pid: 2_147_483_647,
    token: 'abandoned',
    createdAt: '2026-09-09T00:00:00.000Z',
  });
  await runStage(project, 'recovered', 'hash', false, async () => ({ outputs: [] }));
  assert.equal((await readState(project)).stages.recovered?.status, 'PASS');
});

test('explicit process tool paths override repository-local defaults', async () => {
  const old = process.env.HYPERFRAMES_FFMPEG_PATH;
  const explicit = path.join(tmpdir(), 'explicit ffmpeg.exe');
  process.env.HYPERFRAMES_FFMPEG_PATH = explicit;
  try {
    assert.equal((await environment()).HYPERFRAMES_FFMPEG_PATH, explicit);
  } finally {
    if (old === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
    else process.env.HYPERFRAMES_FFMPEG_PATH = old;
  }
});

test('changing supplied asset bytes invalidates the capture stage', async () => {
  const fixture = await makeProject();
  await withPortableMediaTools(async () => {
    await assert.rejects(runProject(fixture.project, true, true), /creative stage/i);
    const first = await readState(fixture.project);
    await writeFile(fixture.asset, 'image-version-two');
    await assert.rejects(runProject(fixture.project, true, true), /creative stage/i);
    const second = await readState(fixture.project);
    assert.notEqual(second.stages.capture?.fingerprint, first.stages.capture?.fingerprint);
  });
});

test('changed product input blocks stale creative artifacts and downstream cached renders', async () => {
  const fixture = await makeProject({ creative: true });
  await seedFullyCachedRun(fixture);
  const changed = structuredClone(fixture.input);
  changed.product.oneLiner = 'A materially changed product promise';
  await writeJson(path.join(fixture.project, 'input/product-input.json'), changed);

  await withPortableMediaTools(async () => {
    await assert.rejects(runProject(fixture.project, true, true), /creative artifacts.*input/i);
  });
  const state = await readState(fixture.project);
  assert.equal(state.stages.creative?.status, 'FAIL');
  assert.equal(state.stages.draft?.startedAt, '2026-09-09T00:00:00.000Z');
  assert.equal(state.stages.final?.startedAt, '2026-09-09T00:00:00.000Z');
});

test('supplied-only run accepts an empty product URL and reaches the creative gate', async () => {
  const fixture = await makeProject({ productUrl: '' });
  await withPortableMediaTools(async () => {
    await assert.rejects(runProject(fixture.project, false, true), /creative stage/i);
    assert.equal((await readState(fixture.project)).stages.capture?.status, 'PASS');
    const report = JSON.parse(await readFile(path.join(fixture.project, 'reports/capture-report.json'), 'utf8')) as {
      sourceUrl: string | null;
      capturedAt: string | null;
      verifiedAt: string;
      captureAttempted: boolean;
      provider: string;
    };
    assert.equal(report.provider, 'supplied-assets');
    assert.equal(report.sourceUrl, null);
    assert.equal(report.capturedAt, null);
    assert.equal(report.captureAttempted, false);
    assert.equal(typeof report.verifiedAt, 'string');
  });
});

test('URL capture records a 60-second timeout and truthful capture report fields', async () => {
  const fixture = await makeProject();
  const restore = installCommandRunnerForTests(async (_executable, args) => {
    const outputIndex = args.indexOf('--output');
    assert.notEqual(outputIndex, -1);
    const captureDir = args[outputIndex + 1]!;
    await mkdir(path.join(captureDir, 'screenshots'), { recursive: true });
    await writeFile(path.join(captureDir, 'screenshots/scroll-000.png'), pngIhdr(1440, 900));
    return fakeResult(args, 0, JSON.stringify({
      url: 'https://example.com/actual',
      httpStatus: 206,
      title: 'Captured title',
      screenshots: 7,
      warnings: ['networkidle2 timed out; continued'],
    }));
  });
  try {
    await captureProject(fixture.project, false);
  } finally {
    restore();
  }

  const commandReport = JSON.parse(
    await readFile(path.join(fixture.project, 'reports/commands/capture.json'), 'utf8'),
  ) as { command: string[] };
  assert.deepEqual(commandReport.command.slice(commandReport.command.indexOf('--timeout'), commandReport.command.indexOf('--timeout') + 2), ['--timeout', '60000']);
  const report = JSON.parse(await readFile(path.join(fixture.project, 'reports/capture-report.json'), 'utf8')) as {
    capturedAt: string | null;
    verifiedAt: string;
    captureAttempted: boolean;
    provider: string;
    captureCli: {
      evidenceSource: string;
      url: string;
      httpStatus: number;
      title: string;
      screenshots: number;
      warnings: string[];
    };
    viewport: { width: number; height: number; evidenceSource: string; kind: string; file: string };
  };
  assert.equal(report.provider, 'hyperframes-capture');
  assert.equal(typeof report.capturedAt, 'string');
  assert.equal(report.captureAttempted, true);
  assert.equal(typeof report.verifiedAt, 'string');
  assert.deepEqual(report.captureCli, {
    evidenceSource: 'hyperframes-cli-stdout',
    url: 'https://example.com/actual',
    httpStatus: 206,
    title: 'Captured title',
    screenshots: 7,
    warnings: ['networkidle2 timed out; continued'],
  });
  assert.deepEqual(report.viewport, {
    evidenceSource: 'png-ihdr',
    kind: 'capture-viewport',
    file: 'capture/screenshots/scroll-000.png',
    width: 1440,
    height: 900,
  });
});

test('capture evidence extraction is pure and reports supplied PNG dimensions without CLI claims', () => {
  const stdout = JSON.stringify({
    url: 'https://example.com/from-cli',
    httpStatus: 200,
    title: 'Upstream title',
    screenshots: 3,
    warnings: ['first', 'second'],
  });
  const actual = extractCaptureEvidence('hyperframes-capture', stdout, [
    { path: 'capture/screenshots/full-page.png', bytes: pngIhdr(1920, 8000) },
    { path: 'capture/screenshots/scroll-000.png', bytes: pngIhdr(1920, 1080) },
  ]);
  assert.equal(actual.captureCli?.url, 'https://example.com/from-cli');
  assert.deepEqual(actual.captureCli?.warnings, ['first', 'second']);
  assert.deepEqual(actual.viewport, {
    evidenceSource: 'png-ihdr',
    kind: 'capture-viewport',
    file: 'capture/screenshots/scroll-000.png',
    width: 1920,
    height: 1080,
  });

  const supplied = extractCaptureEvidence('supplied-assets', stdout, [
    { path: 'assets/Product Shot.png', bytes: pngIhdr(1280, 720) },
  ]);
  assert.equal(supplied.captureCli, null);
  assert.deepEqual(supplied.viewport, {
    evidenceSource: 'png-ihdr',
    kind: 'supplied-asset',
    file: 'assets/Product Shot.png',
    width: 1280,
    height: 720,
  });
});

test('missing FFmpeg and FFprobe fail preflight with a persisted report', async () => {
  const fixture = await makeProject();
  const oldFfmpeg = process.env.HYPERFRAMES_FFMPEG_PATH;
  const oldFfprobe = process.env.HYPERFRAMES_FFPROBE_PATH;
  process.env.HYPERFRAMES_FFMPEG_PATH = path.join(fixture.project, 'missing ffmpeg.exe');
  process.env.HYPERFRAMES_FFPROBE_PATH = path.join(fixture.project, 'missing ffprobe.exe');
  try {
    await assert.rejects(runProject(fixture.project, false, true), /Preflight failed/);
    const report = JSON.parse(await readFile(path.join(fixture.project, 'reports/preflight.json'), 'utf8')) as {
      status: string;
      checks: Array<{ id: string; status: string }>;
    };
    assert.equal(report.status, 'FAIL');
    assert.equal(report.checks.find((check) => check.id === 'ffmpeg')?.status, 'FAIL');
    assert.equal(report.checks.find((check) => check.id === 'ffprobe')?.status, 'FAIL');
  } finally {
    if (oldFfmpeg === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
    else process.env.HYPERFRAMES_FFMPEG_PATH = oldFfmpeg;
    if (oldFfprobe === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH;
    else process.env.HYPERFRAMES_FFPROBE_PATH = oldFfprobe;
  }
});

test('HyperFrames lint failure prevents render from starting', async () => {
  const fixture = await makeProject({ creative: true });
  const restore = installCommandRunnerForTests(async (_executable, args) => {
    const subcommand = args[1];
    return fakeResult(args, subcommand === 'lint' ? 2 : 0, '', subcommand === 'lint' ? 'lint failure' : '');
  });

  try {
    await assert.rejects(renderProject(fixture.project, 'draft', false), /HyperFrames lint failed/);
  } finally {
    restore();
  }

  assert.equal(await readFile(path.join(fixture.project, 'reports/commands/hyperframes-lint.json'), 'utf8').then(() => true), true);
  await assert.rejects(readFile(path.join(fixture.project, 'reports/commands/render-draft.json')), /ENOENT/);
});

test('private-path QA allows HTTPS URLs but rejects Windows absolute paths', async () => {
  const fixture = await makeProject({ creative: true });
  const index = path.join(fixture.project, 'index.html');
  await writeFile(index, `${await readFile(index, 'utf8')}\n<script src="https://cdn.example.com/library.js"></script>`);
  const withHttps = await sourceChecks(fixture.project, fixture.spec);
  assert.equal(withHttps.find((check) => check.id === 'no-private-paths')?.status, 'PASS');

  await writeFile(index, `${await readFile(index, 'utf8')}\n<!-- C:\\Users\\private\\asset.png -->`);
  const withPrivatePath = await sourceChecks(fixture.project, fixture.spec);
  assert.equal(withPrivatePath.find((check) => check.id === 'no-private-paths')?.status, 'FAIL');
});

test('inspect overflow prevents final render from starting', async () => {
  const fixture = await makeProject({ creative: true });
  const restore = installCommandRunnerForTests(async (_executable, args) => {
    const subcommand = args[1];
    return fakeResult(
      args,
      subcommand === 'inspect' ? 2 : 0,
      subcommand === 'lint' ? '{}' : '',
      subcommand === 'inspect' ? 'overflow' : '',
    );
  });

  try {
    await assert.rejects(renderProject(fixture.project, 'high', false), /HyperFrames inspect failed/);
  } finally {
    restore();
  }

  await assert.rejects(readFile(path.join(fixture.project, 'reports/commands/render-high.json')), /ENOENT/);
});

test('a successful render command with mismatched media fails the render gate', async () => {
  const fixture = await makeProject({ creative: true });
  const restore = installCommandRunnerForTests(async (_executable, args) => {
    const subcommand = args[1];
    if (subcommand === 'render') {
      const outputIndex = args.indexOf('--output');
      await mkdir(path.dirname(args[outputIndex + 1]!), { recursive: true });
      await writeFile(args[outputIndex + 1]!, 'rendered-but-wrong');
      return fakeResult(args, 0);
    }
    if (args.includes('-show_streams')) {
      return fakeResult(args, 0, JSON.stringify({
        format: { duration: 1 },
        streams: [{ codec_type: 'video', codec_name: 'h264', width: 320, height: 240, avg_frame_rate: '24/1' }],
      }));
    }
    return fakeResult(args, 0, ['lint', 'inspect'].includes(subcommand ?? '') ? '{}' : '');
  });
  try {
    await assert.rejects(renderProject(fixture.project, 'draft', false), /invalid media/);
  } finally {
    restore();
  }
  const report = JSON.parse(await readFile(path.join(fixture.project, 'reports/draft-media-report.json'), 'utf8')) as {
    status: string;
  };
  assert.equal(report.status, 'FAIL');
  await assert.rejects(readFile(path.join(fixture.project, 'reports/render-draft-report.json')), /ENOENT/);
});

async function seedThroughCreative(fixture: ProjectFixture): Promise<void> {
  const state = await seedFullyCachedRun(fixture);
  for (const stage of ['voice', 'qa', 'draft', 'final', 'media']) delete state.stages[stage];
  await writeJson(path.join(fixture.project, 'run-state.json'), state);
}

test('unavailable local narration runtime records a none recommendation and fails without fake success', async () => {
  const fixture = await makeProject({ creative: true });
  fixture.spec.audio.narrationMode = 'hyperframes';
  fixture.spec.scenes.forEach((scene) => { scene.voiceover = '真实旁白'; });
  await writeJson(path.join(fixture.project, 'video-spec.json'), fixture.spec);
  await seedThroughCreative(fixture);
  const restore = installCommandRunnerForTests(async (_executable, args) => {
    const subcommand = args[1];
    if (subcommand === 'doctor') {
      return fakeResult(args, 0, JSON.stringify({ checks: [
        { name: 'TTS (Kokoro)', ok: false },
        { name: 'whisper-cpp', ok: false },
      ] }));
    }
    if (subcommand === 'tts' && args.includes('--list')) {
      return fakeResult(args, 0, JSON.stringify([
        { id: 'zf_xiaobei', language: 'zh', defaultLang: 'zh' },
      ]));
    }
    return fakeResult(args, 0);
  });
  try {
    await assert.rejects(runProject(fixture.project, true, true), /narration runtime.*use narrationMode=none/i);
  } finally {
    restore();
  }
  const report = JSON.parse(await readFile(path.join(fixture.project, 'reports/voice-report.json'), 'utf8')) as {
    status: string;
    recommendedMode: string;
    generatedAudio: boolean;
  };
  assert.equal(report.status, 'FAIL');
  assert.equal(report.recommendedMode, 'none');
  assert.equal(report.generatedAudio, false);
  assert.equal((await readState(fixture.project)).stages.voice?.status, 'FAIL');
});

test('malformed narration discovery output still records an actionable failure report', async () => {
  const fixture = await makeProject({ creative: true });
  fixture.spec.audio.narrationMode = 'hyperframes';
  fixture.spec.scenes.forEach((scene) => { scene.voiceover = '真实旁白'; });
  await writeJson(path.join(fixture.project, 'video-spec.json'), fixture.spec);
  await seedThroughCreative(fixture);
  const restore = installCommandRunnerForTests(async (_executable, args) => {
    if (args[1] === 'doctor') return fakeResult(args, 0, 'not json');
    if (args[1] === 'tts' && args.includes('--list')) return fakeResult(args, 0, '[]');
    return fakeResult(args, 0);
  });
  try {
    await assert.rejects(runProject(fixture.project, true, true), /invalid JSON/);
  } finally {
    restore();
  }
  const report = JSON.parse(await readFile(path.join(fixture.project, 'reports/voice-report.json'), 'utf8')) as {
    status: string;
    recommendedMode: string;
    generatedAudio: boolean;
    error: string;
  };
  assert.equal(report.status, 'FAIL');
  assert.equal(report.recommendedMode, 'none');
  assert.equal(report.generatedAudio, false);
  assert.match(report.error, /invalid JSON/);
});

test('available local narration runtime generates audio, transcribes it and validates timing', async () => {
  const fixture = await makeProject({ creative: true });
  fixture.spec.audio.narrationMode = 'hyperframes';
  fixture.spec.scenes.forEach((scene) => { scene.voiceover = '真实旁白'; });
  await writeJson(path.join(fixture.project, 'video-spec.json'), fixture.spec);
  await seedThroughCreative(fixture);
  const restore = installCommandRunnerForTests(async (_executable, args) => {
    const subcommand = args[1];
    if (subcommand === 'doctor') {
      return fakeResult(args, 0, JSON.stringify({ checks: [
        { name: 'TTS (Kokoro)', ok: true },
        { name: 'whisper-cpp', ok: true },
      ] }));
    }
    if (subcommand === 'tts' && args.includes('--list')) {
      return fakeResult(args, 0, JSON.stringify([
        { id: 'zf_xiaobei', language: 'zh', defaultLang: 'zh' },
      ]));
    }
    if (subcommand === 'tts') {
      const outputIndex = args.indexOf('--output');
      await writeFile(args[outputIndex + 1]!, 'generated wav');
      return fakeResult(args, 0, JSON.stringify({ ok: true }));
    }
    if (subcommand === 'transcribe') {
      await writeJson(path.join(fixture.project, 'transcript.json'), [
        { text: '真实', start: 0, end: 20 },
        { text: '旁白', start: 20, end: 44.5 },
      ]);
      return fakeResult(args, 0, JSON.stringify({ ok: true }));
    }
    if (args.includes('-show_streams')) {
      return fakeResult(args, 0, JSON.stringify({
        format: { duration: 45 },
        streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le' }],
      }));
    }
    if (subcommand === 'lint') return fakeResult(args, 2, '', 'stop after voice');
    return fakeResult(args, 0);
  });
  try {
    await assert.rejects(runProject(fixture.project, true, true), /Source\/input QA failed/);
  } finally {
    restore();
  }
  const report = JSON.parse(await readFile(path.join(fixture.project, 'reports/voice-report.json'), 'utf8')) as {
    status: string;
    generatedAudio: boolean;
    voice: string;
  };
  assert.equal(report.status, 'PASS');
  assert.equal(report.generatedAudio, true);
  assert.equal(report.voice, 'zf_xiaobei');
  assert.equal((await readState(fixture.project)).stages.voice?.status, 'PASS');
});

test('measured phrase narration binds hashes and blocks a composition without its audio track', async () => {
  const fixture = await makeProject({ creative: true });
  const audio = path.join(fixture.project, 'assets/narration.wav');
  await writeFile(audio, 'measured 45 second narration fixture');
  const audioAsset = {
    id: 'narration',
    type: 'audio' as const,
    path: 'assets/narration.wav',
    sourceUrl: 'https://huggingface.co/hexgrad/Kokoro-82M',
    license: 'authorized' as const,
    required: true,
    fallbackAssetId: null,
  };
  fixture.input.assets.push(audioAsset);
  fixture.input.audio.narrationMode = 'external-audio';
  fixture.input.audio.externalAudioAssetId = audioAsset.id;
  fixture.spec.assets.push(audioAsset);
  fixture.spec.audio = structuredClone(fixture.input.audio);
  fixture.spec.scenes.forEach((scene, index) => { scene.voiceover = `第${index + 1}场旁白。`; });
  await writeJson(path.join(fixture.project, 'input/product-input.json'), fixture.input);
  await writeJson(path.join(fixture.project, 'video-spec.json'), fixture.spec);
  const cues = fixture.spec.scenes.map(scene => ({
    sceneId: scene.id,
    text: scene.voiceover,
    start: scene.actualStartSec! + 0.2,
    end: scene.actualStartSec! + 2.2,
  }));
  await writeJson(path.join(fixture.project, 'transcript.json'), cues.map(({ text, start, end }) => ({ text, start, end })));
  await writeJson(path.join(fixture.project, 'reports/narration-cues.json'), {
    schemaVersion: '1.0',
    timingSource: 'tts-segment-duration',
    audioSha256: digest(await readFile(audio)),
    generator: {
      backend: 'kokoro-onnx',
      backendVersion: '0.6.1',
      model: 'kokoro-v1.1-zh',
      frontend: 'misaki',
      frontendVersion: '0.9.4',
      voice: 'zf_001',
    },
    cues,
  });
  await seedThroughCreative(fixture);
  const restore = installCommandRunnerForTests(async (_executable, args) => {
    if (args.includes('-show_streams')) {
      return fakeResult(args, 0, JSON.stringify({
        format: { duration: 45 },
        streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le', duration: 45 }],
      }));
    }
    return fakeResult(args, 0);
  });
  try {
    await assert.rejects(runProject(fixture.project, true, true), /Source\/input QA failed/);
  } finally {
    restore();
  }
  const report = JSON.parse(await readFile(path.join(fixture.project, 'reports/voice-report.json'), 'utf8')) as {
    status: string;
    transcript: string;
    cues: string;
    audioSha256: string;
    transcriptSha256: string;
    cuesSha256: string;
    timingSource: string;
    transcriptGranularity: string;
    transcriptSource: string;
    asrStatus: string;
    backend: string;
    backendVersion: string;
  };
  assert.equal(report.status, 'PASS');
  assert.equal(report.transcript, 'transcript.json');
  assert.equal(report.cues, 'reports/narration-cues.json');
  assert.equal(report.audioSha256, digest(await readFile(audio)));
  assert.equal(report.transcriptSha256, digest(await readFile(path.join(fixture.project, 'transcript.json'))));
  assert.equal(report.cuesSha256, digest(await readFile(path.join(fixture.project, 'reports/narration-cues.json'))));
  assert.equal(report.timingSource, 'tts-segment-duration');
  assert.equal(report.transcriptGranularity, 'phrase');
  assert.equal(report.transcriptSource, 'measured-tts-segments');
  assert.equal(report.asrStatus, 'NOT_RUN');
  assert.equal(report.backend, 'kokoro-onnx');
  assert.equal(report.backendVersion, '0.6.1');
  await readFile(path.join(fixture.project, 'reports/commands/ffprobe-narration.json'));
  await assert.rejects(readFile(path.join(fixture.project, 'reports/commands/ffprobe.json')), /ENOENT/);
  assert.equal((await readState(fixture.project)).stages.voice?.status, 'PASS');
  assert.equal((await readState(fixture.project)).stages.qa?.status, 'FAIL');
});

function fakeResult(commandArgs: string[], exitCode: number, stdout = '', stderr = ''): CommandResult {
  return { command: ['fake', ...commandArgs], exitCode, stdout, stderr, durationMs: 1 };
}

test('media verification rejects mismatched output and applies none/external audio requirements', async () => {
  const fixture = await makeProject({ creative: true });
  const mediaFile = path.join(fixture.project, 'mismatched output.mp4');
  const env = await environment();
  const generated = await command(env.HYPERFRAMES_FFMPEG_PATH!, [
    '-hide_banner',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=320x240:r=24:d=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    '-y',
    mediaFile,
  ]);
  assert.equal(generated.exitCode, 0, generated.stderr);

  await withPortableMediaTools(async () => {
    const none = await verifyMedia(mediaFile, fixture.project, fixture.spec);
    assert.equal(none.find((check) => check.id === 'media.resolution')?.status, 'FAIL');
    assert.equal(none.find((check) => check.id === 'media.fps')?.status, 'FAIL');
    assert.equal(none.find((check) => check.id === 'media.duration')?.status, 'FAIL');
    assert.equal(none.find((check) => check.id === 'media.audio-stream')?.status, 'SKIPPED_WITH_REASON');

    const externalSpec = structuredClone(fixture.spec);
    externalSpec.audio.narrationMode = 'external-audio';
    const external = await verifyMedia(mediaFile, fixture.project, externalSpec);
    assert.equal(external.find((check) => check.id === 'media.audio-stream')?.status, 'FAIL');
  });
});
