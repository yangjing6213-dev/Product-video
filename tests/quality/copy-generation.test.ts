// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { freezeCreativePlan, type CreativePlan } from '../../src/quality/plan.ts';
import { freezeCopyDraft, recordCopyDecision } from '../../src/quality/copy.ts';
import { renderQuality } from '../../src/quality/render.ts';
import { renderProject } from '../../src/pipeline/run.ts';
import { installCommandRunnerForTests } from '../../src/pipeline/tools.ts';
import { digest, hashFiles } from '../../src/pipeline/stage-state.ts';
import { validProductInput, validVideoSpec } from '../fixtures/input.ts';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function fixture(t: TestContext, quality: boolean, bindCopy = true, mismatchedAudio = false, mixedAudio = false) {
  const root = path.join(repository, '.cache', `copy-generation-test-${randomUUID()}`);
  const project = path.join(root, 'projects/sample');
  await mkdir(path.join(project, 'input'), { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(root), path.join(repository, '.cache')); assert.match(path.basename(root), /^copy-generation-test-/);
    await rm(root, { recursive: true });
  });
  const spec = { ...structuredClone(validVideoSpec), projectId: 'sample' };
  await writeFile(path.join(project, 'input/product-input.json'), JSON.stringify({ ...structuredClone(validProductInput), projectId: 'sample' }));
  await writeFile(path.join(project, 'video-spec.json'), JSON.stringify(spec));
  await writeFile(path.join(project, 'DESIGN.md'), '# Real fixture design');
  await writeFile(path.join(project, 'index.html'), `<div data-composition-id="main" data-duration="10">Reviewed words</div>${mismatchedAudio ? '<audio src="voice-b.wav"></audio>' : ''}`);
  if (!quality) return { root, project, spec };
  const manifest = { schemaVersion: '1.0', libraryVersion: 'v1', catalogSha256: digest('catalog'), selection: { selections: [], omissionReason: 'Text gate fixture' }, assets: [] };
  const manifestText = JSON.stringify(manifest); await writeFile(path.join(project, 'frozen-brand-assets.json'), manifestText);
  await writeFile(path.join(project, 'font.woff2'), 'test font');
  const narration = mismatchedAudio || mixedAudio ? ['已确认旁白。'] : [];
  const copy = await freezeCopyDraft(root, project, { schemaVersion: '1.0', projectId: 'sample', productId: 'sample-product', revision: 'COPY-v1', narration, onScreenText: ['Reviewed words'], subtitles: narration, cta: 'See the real project' });
  const plan = { schemaVersion: '1.0', projectId: 'sample', productId: 'sample-product', variantId: 'variant-a', brief: 'Real product demo',
    sources: [{ source: 'composition-entry', path: 'projects/sample/index.html', sha256: digest(await readFile(path.join(project, 'index.html'))) }],
    design: { style: 'studio', rationale: { openingReason: 'Show the real product', productSpecificShots: ['one'], recentAcceptedComparison: [] } },
    frameRate: 30, width: 1920, height: 1080, durationFrames: 300,
    shots: [{ id: 'one', startFrame: 0, endFrame: 300, purpose: 'Explain', motion: 'Focus transfer' }],
    fonts: [{ path: 'projects/sample/font.woff2', sha256: digest('test font'), family: 'Test font', version: '1' }],
    assets: { manifestPath: 'projects/sample/frozen-brand-assets.json', sha256: digest(manifestText) },
    narration: { status: 'PENDING_REVIEW', provider: 'none', modelId: 'none', voiceId: 'none', textHash: digest(''), pronunciationMapHash: digest('{}') },
    ...(bindCopy ? { copy: { sha256: copy.copySha256 } } : {}),
  } as CreativePlan;
  if (mismatchedAudio || mixedAudio) {
    const voiceHash = digest('voice A');
    const alignment = JSON.stringify({ copySha256: copy.copySha256, voiceSha256: voiceHash, cues: [{ text: narration[0], start: 0, end: 1 }] });
    await writeFile(path.join(project, 'voice-a.wav'), 'voice A');
    await writeFile(path.join(project, 'voice-b.wav'), 'voice B');
    await writeFile(path.join(project, 'input/narration.txt'), narration[0]!);
    await writeFile(path.join(project, 'input/alignment.json'), alignment);
    plan.sources.push({ source: 'narration-text', path: 'projects/sample/input/narration.txt', sha256: digest(narration[0]!) });
    Object.assign(plan.narration, { textHash: digest(narration[0]!), voicePath: 'projects/sample/voice-a.wav', voiceHash,
      alignmentPath: 'projects/sample/input/alignment.json', alignmentHash: digest(alignment) });
  }
  if (mixedAudio) {
    await writeFile(path.join(project, 'input/music.wav'), 'fixture music');
    await writeFile(path.join(project, 'input/license.txt'), 'CC0 fixture');
    await writeFile(path.join(project, 'input/mix.wav'), 'fixture premix');
    plan.audioMix = { schemaVersion: '1.0', voiceSha256: plan.narration.voiceHash!,
      music: { path: 'projects/sample/input/music.wav', sha256: digest('fixture music'), licenseId: 'CC0-1.0', licensePath: 'projects/sample/input/license.txt', licenseSha256: digest('CC0 fixture') },
      mixPath: 'projects/sample/input/mix.wav', mixSha256: digest('fixture premix'), durationSec: 10, voiceOffsetSec: 0, voiceGainDb: 0,
      musicOffsetSec: 0, musicGainDb: -20, fadeInSec: 0.2, fadeOutSec: 1 };
    const html = `<div data-composition-id="main" data-duration="10">Reviewed words</div><audio src="assets/quality-frozen/${plan.audioMix.mixSha256}.wav" data-start="0" data-duration="10" data-volume="1"></audio>`;
    await writeFile(path.join(project, 'index.html'), html);
    plan.sources[0]!.sha256 = digest(html);
  }
  const resolved = await freezeCreativePlan(root, project, plan);
  return { root, project, spec, copy, resolved };
}

test('quality rendering without copy approval stops before tool calls and output creation', async t => {
  const f = await fixture(t, true); const called: string[][] = [];
  const restore = installCommandRunnerForTests(async (_exe, args) => { called.push(args); throw new Error('NO_REAL_MEDIA'); }); t.after(restore);
  await assert.rejects(renderQuality(f.root, f.project, 'unapproved'), /copy.*approval/i);
  assert.equal(called.length, 0);
  assert.ok(!(await readdir(f.project)).includes('renders'));
});

test('quality rendering with current copy approval reaches the renderer without generating real media in this test', async t => {
  const f = await fixture(t, true); const called: string[][] = [];
  await recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: f.copy!.copySha256, userInstruction: 'TEST FIXTURE ONLY: accepted copy' });
  const restore = installCommandRunnerForTests(async (_exe, args) => { called.push(args); throw new Error('NO_REAL_MEDIA'); }); t.after(restore);
  await assert.rejects(renderQuality(f.root, f.project, 'approved'), /NO_REAL_MEDIA/);
  assert.equal(called.length, 1);
  assert.ok(called[0]!.includes('lint'));
});

test('existing quality video cache stays readable without inventing retrospective copy approval', async t => {
  const f = await fixture(t, true, false); let calls = 0;
  await mkdir(path.join(f.project, 'renders')); await mkdir(path.join(f.project, 'reports'));
  const video = path.join(f.project, 'renders/old.mp4'); await writeFile(video, 'existing immutable media fixture');
  await writeFile(path.join(f.project, 'reports/quality-render-old.json'), JSON.stringify({ status: 'PASS', planSha256: f.resolved!.resolvedPlanSha256, videoSha256: digest(await readFile(video)) }));
  const restore = installCommandRunnerForTests(async () => { calls++; throw new Error('NO_REAL_MEDIA'); }); t.after(restore);
  assert.equal(await renderQuality(f.root, f.project, 'old', true), video);
  assert.equal(calls, 0);
  assert.ok(!(await readdir(f.project)).includes('copy-approvals'));
});

test('quality render blocks a correctly frozen HTML file that plays another voice before any rendering tool', async t => {
  const f = await fixture(t, true, true, true); let calls = 0;
  await recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: f.copy!.copySha256, userInstruction: 'TEST FIXTURE ONLY: approved narration A' });
  const restore = installCommandRunnerForTests(async () => { calls++; throw new Error('NO_REAL_MEDIA'); }); t.after(restore);
  await assert.rejects(renderQuality(f.root, f.project, 'wrong-audio'), /audio binding/i);
  assert.equal(calls, 0);
  assert.ok(!(await readdir(f.project)).includes('renders'));
});

test('a legacy quality plan without a copy binding cannot generate another video', async t => {
  const f = await fixture(t, true, false); let calls = 0;
  await recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: f.copy!.copySha256, userInstruction: 'TEST FIXTURE ONLY: copy approved' });
  const restore = installCommandRunnerForTests(async () => { calls++; throw new Error('NO_REAL_MEDIA'); }); t.after(restore);
  await assert.rejects(renderQuality(f.root, f.project, 'new'), /copy.*binding/i);
  assert.equal(calls, 0);
});

test('the legacy render entry also blocks an unapproved video before renderer invocation', async t => {
  const f = await fixture(t, false); let calls = 0;
  const restore = installCommandRunnerForTests(async () => { calls++; throw new Error('NO_REAL_MEDIA'); }); t.after(restore);
  await assert.rejects(renderProject(f.project, 'draft', false, true), /copy.*approval/i);
  assert.equal(calls, 0);
  assert.ok(!(await readdir(f.project)).includes('renders'));
});

test('the old pipeline can read an identical cached video without retrospective copy approval', async t => {
  const f = await fixture(t, false); let calls = 0;
  await mkdir(path.join(f.project, 'renders')); await mkdir(path.join(f.project, 'reports'));
  const video = path.join(f.project, 'renders/draft.mp4'); await writeFile(video, 'old video fixture');
  const fingerprint = await hashFiles(['video-spec.json', 'DESIGN.md', 'index.html'].map(file => path.join(f.project, file)), { quality: 'draft', version: 'hyperframes-0.8.33', fps: 30 });
  await writeFile(path.join(f.project, 'run-state.json'), JSON.stringify({ schemaVersion: '1.0', stages: { draft: { status: 'PASS', contractVersion: 1, fingerprint,
    finishedAt: '2026-09-09T00:00:00.000Z', result: { outputs: ['renders/draft.mp4'], outputHashes: { 'renders/draft.mp4': digest(await readFile(video)) } } } } }));
  await writeFile(path.join(f.project, 'reports/run-history.json'), JSON.stringify({ firstPlayableDraftAt: '2026-09-09T00:00:00.000Z' }));
  const before = await readFile(video);
  const restore = installCommandRunnerForTests(async () => { calls++; throw new Error('NO_REAL_MEDIA'); }); t.after(restore);
  assert.equal(await renderProject(f.project, 'draft', true, true), video);
  assert.deepEqual(await readFile(video), before);
  assert.equal(calls, 0);
  assert.ok(!(await readdir(f.project)).includes('copy-approvals'));
});

for (const phase of ['preflight', 'render'] as const) {
  for (const changed of ['copy-revoked', 'frozen-mix-changed'] as const) {
    test(`${changed} during ${phase} cannot enter rendering or publish a PASS report`, async t => {
      const f = await fixture(t, true, true, false, true); let reachedRender = false;
      await recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: f.copy!.copySha256, userInstruction: 'TEST FIXTURE ONLY: accepted copy' });
      const restore = installCommandRunnerForTests(async (executable, args) => {
        const isRender = args.includes('render');
        if (isRender) {
          reachedRender = true;
          const output = args[args.indexOf('--output') + 1]!;
          await writeFile(output, 'simulated render output fixture');
        }
        if ((phase === 'preflight' && args.includes('lint')) || (phase === 'render' && isRender)) {
          if (changed === 'copy-revoked') await recordCopyDecision(f.root, f.project, { decision: 'REJECTED', copySha256: f.copy!.copySha256, userInstruction: 'TEST FIXTURE ONLY: revoked during work' });
          else await writeFile(path.join(f.root, f.resolved!.audioMix!.mixPath), 'changed frozen audio during work');
        }
        const stdout = args.includes('-show_streams') ? JSON.stringify({ streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30/1' }], format: { duration: '10' } })
          : args.includes('lint') || args.includes('inspect') ? JSON.stringify({ errorCount: 0, warningCount: 0 }) : '';
        return { command: [executable, ...args], exitCode: 0, stdout, stderr: '', durationMs: 0 };
      }); t.after(restore);
      await assert.rejects(renderQuality(f.root, f.project, 'changed-input'), /copy approval|hash changed|plan changed/i);
      assert.equal(reachedRender, phase === 'render');
      assert.ok(!(await readdir(path.join(f.project, 'reports'))).includes('quality-render-changed-input.json'));
    });
  }
}
