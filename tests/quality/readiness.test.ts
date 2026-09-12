// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { validVideoSpec } from '../fixtures/input.ts';
import type { CheckResult } from '../../src/contracts.ts';
import { digest } from '../../src/pipeline/stage-state.ts';
import { ACTIVE_GENERATOR_POLICY } from '../../src/quality/policy.ts';
import { freezeCreativePlan, recordHumanDecision, type CreativePlan } from '../../src/quality/plan.ts';
import { verifyReleaseEvidence } from '../../src/quality/readiness.ts';

const contacts = {
  name: 'Fixture Author',
  items: [
    { label: 'GitHub', value: 'fixture-github' },
    { label: 'X / Twitter', value: '@fixture' },
    { label: '网站', value: 'fixture.example' },
    { label: '微信', value: 'fixture-wechat' },
    { label: '邮箱', value: 'fixture@example.com' },
  ],
};

function pass(id: string): CheckResult {
  return { id, status: 'PASS', message: `${id} fixture evidence` };
}

function requiredQaChecks(sceneIds: string[]) {
  const checks = [
    ...['policy', 'cta', 'spoken-cta', 'ending', 'author-contacts', 'subtitles', 'product-identity', 'prerequisites']
      .map((id) => pass(`generator.${id}`)),
    pass('browser.resources'),
    pass('narration.evidence'),
    ...['audio-element', 'audio-duration', 'caption-source'].map((id) => pass(`narration.${id}`)),
    ...['audio', 'structure', 'timing'].map((id) => pass(`browser.narration.${id}`)),
    ...['midpoint', 'boundaries', 'reverse-seek', 'lines', 'safe-area', 'ui-overlap']
      .map((id) => pass(`browser.narration.cue-0.${id}`)),
  ];
  const browser = ['caption-lines', 'caption-safe-area', 'logo-safe-area', 'text-overflow', 'minimum-type', 'images',
    'caption-ui-overlap', 'caption-background', 'small-player-type', 'brand-palette', 'font'];
  for (const sceneId of sceneIds) {
    checks.push(...browser.map((id) => pass(`browser.${sceneId}.${id}`)));
    checks.push(...['real-subject', 'observed-state', 'reverse-seek'].map((id) => pass(`motion.${sceneId}.${id}`)));
  }
  const endingId = sceneIds.at(-1)!;
  checks.push(...['primary-cta', 'author-contacts', 'contact-reading-time'].map((id) => pass(`browser.${endingId}.${id}`)));
  return checks;
}

async function fixture(t: TestContext) {
  const base = path.resolve('.cache/generator-quality-003/readiness');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'release '));
  t.after(async () => {
    assert.equal(path.dirname(root), base);
    await rm(root, { recursive: true });
  });
  const projectId = 'release-readiness';
  const projectRelative = `projects/${projectId}`;
  const project = path.join(root, projectRelative);
  await mkdir(path.join(project, 'reports'), { recursive: true });
  await mkdir(path.join(project, 'renders'), { recursive: true });
  await mkdir(path.join(project, 'assets/brand-frozen'), { recursive: true });
  await mkdir(path.join(root, 'inputs'), { recursive: true });
  await writeFile(path.join(root, 'inputs/font.woff2'), 'font bytes');
  await writeFile(path.join(root, 'inputs/voice.wav'), 'voice bytes');
  await writeFile(path.join(root, 'inputs/alignment.json'), '{"cues":[]}');
  await writeFile(path.join(project, 'assets/brand-frozen/ip.png'), 'brand bytes');
  const selection = { assetId: 'fixture-ip', contentVersion: 'v1', sha256: digest('brand bytes'), purpose: 'Fixture identity' };
  const manifest = `${JSON.stringify({ schemaVersion: '1.0', libraryVersion: 'fixture-v1', catalogSha256: digest('catalog'),
    selection: { selections: [selection] }, assets: [{ ...selection, jobPath: 'assets/brand-frozen/ip.png',
      frozenPath: `${projectRelative}/assets/brand-frozen/ip.png`, sourcePath: 'assets/brand/enhe/ip/originals/ip.png', mediaType: 'image/png' }] }, null, 2)}\n`;
  await writeFile(path.join(project, 'frozen-brand-assets.json'), manifest);

  const spec = structuredClone(validVideoSpec);
  spec.projectId = projectId;
  spec.generatorPolicy = structuredClone(ACTIVE_GENERATOR_POLICY);
  spec.authorContacts = contacts;
  spec.product.cta = { label: ACTIVE_GENERATOR_POLICY.marketing.screenAction, url: ACTIVE_GENERATOR_POLICY.marketing.url };
  spec.narrative.cta = ACTIVE_GENERATOR_POLICY.marketing.screenAction;
  spec.captions.style = ACTIVE_GENERATOR_POLICY.subtitles;
  spec.scenes[0]!.onScreenText = [spec.product.name];
  spec.scenes.at(-1)!.onScreenText = [ACTIVE_GENERATOR_POLICY.marketing.screenAction, ACTIVE_GENERATOR_POLICY.marketing.displayDomain];
  spec.scenes.at(-1)!.voiceover = ACTIVE_GENERATOR_POLICY.marketing.spokenAction;
  spec.audio = { ...spec.audio, narrationMode: 'external-audio', externalAudioAssetId: 'fixture-voice' };
  spec.assets.push({ id: 'fixture-voice', type: 'audio', path: 'assets/narration.wav', sourceUrl: '', license: 'authorized', required: true, fallbackAssetId: null });
  await writeFile(path.join(project, 'video-spec.json'), `${JSON.stringify(spec, null, 2)}\n`);
  await writeFile(path.join(project, 'index.html'), '<!doctype html><main>fixture</main>');
  await writeFile(path.join(project, 'renders/final.mp4'), 'final video bytes');

  const plan: CreativePlan = {
    schemaVersion: '1.0', generatorPolicy: structuredClone(ACTIVE_GENERATOR_POLICY), projectId, variantId: 'normal-v1', productId: 'fixture-product',
    brief: 'Synthetic readiness fixture', sources: [{ source: 'fixture source', path: 'inputs/alignment.json', sha256: digest('{"cues":[]}') }],
    design: { style: 'fixture', rationale: { openingReason: 'Fixture opening', productSpecificShots: ['fixture shot'], recentAcceptedComparison: [] } },
    frameRate: 30, width: 1920, height: 1080, durationFrames: 1350,
    shots: [{ id: 'fixture-shot', startFrame: 0, endFrame: 1350, purpose: 'Fixture timeline', motion: 'Fixture motion' }],
    fonts: [{ path: 'inputs/font.woff2', sha256: digest('font bytes'), family: 'Fixture Font', version: 'fixture-v1' }],
    assets: { manifestPath: `${projectRelative}/frozen-brand-assets.json`, sha256: digest(manifest) },
    narration: { status: 'PENDING_REVIEW', provider: 'fixture-local', modelId: 'fixture-model', voiceId: 'fixture-voice',
      textHash: digest('fixture narration'), pronunciationMapHash: digest('{}'), voicePath: 'inputs/voice.wav', voiceHash: digest('voice bytes'),
      alignmentPath: 'inputs/alignment.json', alignmentHash: digest('{"cues":[]}') },
  };
  await freezeCreativePlan(root, project, plan);
  const finalPath = `${projectRelative}/renders/final.mp4`;
  await recordHumanDecision(root, project, { dimension: 'visual', decision: 'ACCEPTED', userInstruction: 'SYNTHETIC TEST FIXTURE: visual accepted', videoPath: finalPath });
  await recordHumanDecision(root, project, { dimension: 'voice', decision: 'ACCEPTED', userInstruction: 'SYNTHETIC TEST FIXTURE: voice accepted' });
  await recordHumanDecision(root, project, { dimension: 'audience', decision: 'ACCEPTED', userInstruction: 'SYNTHETIC TEST FIXTURE: audience accepted', videoPath: finalPath });
  await recordHumanDecision(root, project, { dimension: 'final', decision: 'ACCEPTED', userInstruction: 'SYNTHETIC TEST FIXTURE: final accepted', videoPath: finalPath });

  const qa = { schemaVersion: '1.0', projectId, generatedAt: '2026-09-10T00:00:00.000Z', status: 'PASS', checks: requiredQaChecks(spec.scenes.map((scene) => scene.id)) };
  const media = { status: 'PASS', checks: ['media.video-stream', 'media.resolution', 'media.fps', 'media.duration', 'media.video-codec',
    'media.audio-stream', 'media.audio-codec', 'decode', 'black-frames', 'silence', 'media.audio-binding'].map(pass) };
  const videoSha256 = digest('final video bytes');
  const render = { quality: 'high', output: 'renders/final.mp4', durationMs: 1, exitCode: 0, videoSha256,
    specSha256: digest(await readFile(path.join(project, 'video-spec.json'))), entrySha256: digest(await readFile(path.join(project, 'index.html'))) };
  await writeFile(path.join(project, 'reports/qa-report.json'), `${JSON.stringify(qa, null, 2)}\n`);
  await writeFile(path.join(project, 'reports/high-media-report.json'), `${JSON.stringify(media, null, 2)}\n`);
  await writeFile(path.join(project, 'reports/audio-binding.json'), '{"status":"PASS","asr":"NOT_RUN"}\n');
  await writeFile(path.join(project, 'reports/render-high-report.json'), `${JSON.stringify(render, null, 2)}\n`);
  await writeFile(path.join(project, 'run-state.json'), `${JSON.stringify({ schemaVersion: '1.0', stages: { final: {
    status: 'PASS', fingerprint: digest('final stage'), contractVersion: 1, startedAt: '2026-09-10T00:00:00.000Z', finishedAt: '2026-09-10T00:00:01.000Z', durationMs: 1,
    result: { outputs: ['renders/final.mp4', 'reports/high-media-report.json', 'reports/render-high-report.json'], outputHashes: {
      'renders/final.mp4': videoSha256,
      'reports/high-media-report.json': digest(await readFile(path.join(project, 'reports/high-media-report.json'))),
      'reports/render-high-report.json': digest(await readFile(path.join(project, 'reports/render-high-report.json'))),
    } },
  }, media: {
    status: 'PASS', fingerprint: digest('media stage'), contractVersion: 3, startedAt: '2026-09-10T00:00:01.000Z', finishedAt: '2026-09-10T00:00:02.000Z', durationMs: 1,
    result: { outputs: ['reports/qa-report.json', 'reports/audio-binding.json'], outputHashes: {
      'reports/qa-report.json': digest(await readFile(path.join(project, 'reports/qa-report.json'))),
      'reports/audio-binding.json': digest(await readFile(path.join(project, 'reports/audio-binding.json'))),
    } },
  } } }, null, 2)}\n`);
  return { project, qa, videoSha256 };
}

test('release evidence passes only when QA, render, run state and all approval artifacts bind the same final video', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await verifyReleaseEvidence(f.project), { engineering: 'PASS', artifactAcceptance: 'PASS', issues: [], videoSha256: f.videoSha256 });
});

test('a forged top-level QA PASS cannot hide a failing or missing required check', async (t) => {
  const f = await fixture(t);
  f.qa.checks.find((check) => check.id === 'generator.cta')!.status = 'FAIL';
  await writeFile(path.join(f.project, 'reports/qa-report.json'), `${JSON.stringify(f.qa, null, 2)}\n`);
  const failed = await verifyReleaseEvidence(f.project);
  assert.equal(failed.engineering, 'FAIL');
  assert.ok(failed.issues.some((issue) => /qa.*fail|generator\.cta/i.test(issue)), failed.issues.join('\n'));

  f.qa.checks = f.qa.checks.filter((check) => check.id !== 'motion.scene-03.observed-state');
  f.qa.checks.find((check) => check.id === 'generator.cta')!.status = 'PASS';
  await writeFile(path.join(f.project, 'reports/qa-report.json'), `${JSON.stringify(f.qa, null, 2)}\n`);
  const missing = await verifyReleaseEvidence(f.project);
  assert.equal(missing.engineering, 'FAIL');
  assert.ok(missing.issues.some((issue) => issue.includes('motion.scene-03.observed-state')), missing.issues.join('\n'));
});

test('release evidence requires final PCM audio binding for narrated media', async (t) => {
  const f = await fixture(t);
  const mediaFile = path.join(f.project, 'reports/high-media-report.json');
  const media = JSON.parse(await readFile(mediaFile, 'utf8'));
  media.checks = media.checks.filter((check: CheckResult) => check.id !== 'media.audio-binding');
  await writeFile(mediaFile, `${JSON.stringify(media, null, 2)}\n`);
  const stateFile = path.join(f.project, 'run-state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.stages.final.result.outputHashes['reports/high-media-report.json'] = digest(await readFile(mediaFile));
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const result = await verifyReleaseEvidence(f.project);
  assert.equal(result.engineering, 'FAIL');
  assert.ok(result.issues.some((issue) => issue.includes('media.audio-binding')), result.issues.join('\n'));
});

test('release evidence rejects a final stage hash or audience approval bound to another video', async (t) => {
  const f = await fixture(t);
  const state = JSON.parse(await readFile(path.join(f.project, 'run-state.json'), 'utf8'));
  state.stages.final.result.outputHashes['renders/final.mp4'] = digest('other video');
  await writeFile(path.join(f.project, 'run-state.json'), `${JSON.stringify(state, null, 2)}\n`);
  const staleStage = await verifyReleaseEvidence(f.project);
  assert.equal(staleStage.engineering, 'FAIL');
  assert.ok(staleStage.issues.some((issue) => /final stage.*hash/i.test(issue)), staleStage.issues.join('\n'));

  state.stages.final.result.outputHashes['renders/final.mp4'] = f.videoSha256;
  await writeFile(path.join(f.project, 'run-state.json'), `${JSON.stringify(state, null, 2)}\n`);
  const approvals = await import('node:fs/promises').then(({ readdir }) => readdir(path.join(f.project, 'approvals')));
  for (const name of approvals) {
    const file = path.join(f.project, 'approvals', name);
    const approval = JSON.parse(await readFile(file, 'utf8'));
    if (approval.dimension === 'audience') {
      approval.videoSha256 = digest('other audience video');
      await writeFile(file, `${JSON.stringify(approval, null, 2)}\n`);
    }
  }
  const staleApproval = await verifyReleaseEvidence(f.project);
  assert.equal(staleApproval.engineering, 'PASS');
  assert.equal(staleApproval.artifactAcceptance, 'PARTIAL');
  assert.ok(staleApproval.issues.some((issue) => /audience.*final video/i.test(issue)), staleApproval.issues.join('\n'));
});

test('missing release evidence is NOT_RUN rather than PASS', async (t) => {
  const base = path.resolve('.cache/generator-quality-003/readiness');
  await mkdir(base, { recursive: true });
  const project = await mkdtemp(path.join(base, 'missing '));
  t.after(() => rm(project, { recursive: true }));
  const result = await verifyReleaseEvidence(project);
  assert.equal(result.engineering, 'NOT_RUN');
  assert.equal(result.artifactAcceptance, 'NOT_RUN');
  assert.ok(result.issues.length > 0);
  assert.equal(result.videoSha256, undefined);
});

test('missing human approvals leave verified engineering PASS and artifact acceptance NOT_RUN', async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.project, 'approvals'), { recursive: true });
  const result = await verifyReleaseEvidence(f.project);
  assert.equal(result.engineering, 'PASS');
  assert.equal(result.artifactAcceptance, 'NOT_RUN');
  assert.equal(result.videoSha256, f.videoSha256);
  assert.ok(result.issues.some((issue) => /approval/i.test(issue)), result.issues.join('\n'));
});
