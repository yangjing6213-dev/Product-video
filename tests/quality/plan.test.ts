// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, readdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { digest } from '../../src/pipeline/stage-state.ts';
import { freezeCreativePlan, resumeCreativePlan, recordHumanDecision, assessAcceptance, type CreativePlan } from '../../src/quality/plan.ts';
import { freezeCopyDraft } from '../../src/quality/copy.ts';
import { ACTIVE_GENERATOR_POLICY } from '../../src/quality/policy.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'epvs-quality-plan-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('epvs-quality-plan-'));
    await rm(root, { recursive: true });
  });
  const projectRelative = 'projects/中文 样片';
  const project = path.join(root, projectRelative);
  await mkdir(path.join(project, 'assets/brand-frozen'), { recursive: true });
  await mkdir(path.join(root, 'inputs'));
  for (const [name, data] of Object.entries({ 'font.woff2': 'font bytes', 'voice.wav': 'wave bytes', 'alignment.json': '{"start":0}', 'fact.txt': 'verified product fact' })) {
    await writeFile(path.join(root, 'inputs', name), data);
  }
  await writeFile(path.join(project, 'assets/brand-frozen/ip.png'), 'IP bytes');
  const selected = { assetId: 'enhe-ip', contentVersion: 'v1', sha256: digest('IP bytes'), purpose: '片尾引导' };
  const manifest = { schemaVersion: '1.0', libraryVersion: 'v1', catalogSha256: digest('catalog'),
    selection: { selections: [selected] }, assets: [{ ...selected, jobPath: 'assets/brand-frozen/ip.png',
      frozenPath: `${projectRelative}/assets/brand-frozen/ip.png`, sourcePath: 'assets/brand/enhe/ip/originals/ip.png', mediaType: 'image/png' }] };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(project, 'frozen-brand-assets.json'), manifestText);
  await mkdir(path.join(project, 'renders'));
  await writeFile(path.join(project, 'renders/sample.mp4'), 'render version 1');
  const plan: CreativePlan = {
    schemaVersion: '1.0', projectId: 'pilot', variantId: 'direction-a', productId: 'product-a',
    brief: '让用户看清产品动作与结果', sources: [{ source: 'user supplied fact', path: 'inputs/fact.txt', sha256: digest('verified product fact') }],
    design: { style: 'editorial', rationale: { openingReason: '先展示真实结果', productSpecificShots: ['proof'], recentAcceptedComparison: [] } },
    frameRate: 30, width: 1920, height: 1080, durationFrames: 300,
    shots: [{ id: 'proof', startFrame: 0, endFrame: 210, purpose: '真实操作与结果', motion: '结果层级交接' },
      { id: 'author', startFrame: 200, endFrame: 300, purpose: '分层作者署名', motion: '结果边框延伸为签名' }],
    fonts: [{ path: 'inputs/font.woff2', sha256: digest('font bytes'), family: 'Sample font', version: '1' }],
    assets: { manifestPath: `${projectRelative}/frozen-brand-assets.json`, sha256: digest(manifestText) },
    narration: { status: 'PENDING_REVIEW', provider: 'local-import', modelId: 'user-audio', voiceId: 'candidate',
      textHash: digest('旁白'), pronunciationMapHash: digest('{}'), voicePath: 'inputs/voice.wav', voiceHash: digest('wave bytes'),
      alignmentPath: 'inputs/alignment.json', alignmentHash: digest('{"start":0}') },
  };
  return { root, project, projectRelative, plan, videoPath: `${projectRelative}/renders/sample.mp4` };
}

test('freezing creates immutable local snapshots and an identical repeated plan preserves bytes', async t => {
  const f = await fixture(t);
  const resolved = await freezeCreativePlan(f.root, f.project, f.plan);
  const before = await readFile(path.join(f.project, 'resolved-creative-plan.json'));
  assert.ok(resolved.fonts[0]!.path.startsWith(`${f.projectRelative}/assets/quality-frozen/`));
  assert.notEqual(resolved.narration.voicePath, f.plan.narration.voicePath);
  await writeFile(path.join(f.root, 'inputs/font.woff2'), 'updated library font');
  await writeFile(path.join(f.root, 'inputs/voice.wav'), 'updated library voice');
  await freezeCreativePlan(f.root, f.project, f.plan);
  assert.deepEqual(await readFile(path.join(f.project, 'resolved-creative-plan.json')), before);
  assert.equal((await resumeCreativePlan(f.root, f.project)).fonts[0]!.sha256, digest('font bytes'));
});

test('current generator audience review is separate and no field can manufacture human acceptance', async t => {
  const f = await fixture(t);
  Object.assign(f.plan, { generatorPolicy: structuredClone(ACTIVE_GENERATOR_POLICY) });
  await freezeCreativePlan(f.root, f.project, f.plan);
  const before: any = await assessAcceptance(f.root, f.project);
  assert.equal(before.audienceReview?.status, 'NOT_RUN');
  await recordHumanDecision(f.root, f.project, { dimension: 'audience' as any, decision: 'ACCEPTED', userInstruction: 'Fixture-only comprehension review, not a real project approval', videoPath: f.videoPath });
  const after: any = await assessAcceptance(f.root, f.project);
  assert.equal(after.audienceReview.status, 'PASS');
  assert.equal(after.voiceReview.status, 'NOT_RUN');
  assert.equal(after.visualReview.status, 'NOT_RUN');
  assert.equal(after.userAcceptance.status, 'NOT_RUN');
});

test('a quality plan copy reference binds the complete frozen copy and product identity', async t => {
  const f = await fixture(t);
  const copy = await freezeCopyDraft(f.root, f.project, { schemaVersion: '1.0', projectId: f.plan.projectId, productId: f.plan.productId,
    revision: 'COPY-v1', narration: ['旁白'], onScreenText: ['真实功能'], subtitles: ['旁白'], cta: '查看项目' });
  await writeFile(path.join(f.root, 'inputs/approved-narration.txt'), '旁白');
  f.plan.sources.push({ source: 'approved-narration', path: 'inputs/approved-narration.txt', sha256: digest('旁白') });
  const alignment = JSON.stringify({ copySha256: copy.copySha256, voiceSha256: f.plan.narration.voiceHash, cues: [{ text: '旁白', start: 0, end: 1 }] });
  await writeFile(path.join(f.root, 'inputs/alignment.json'), alignment);
  f.plan.narration.alignmentHash = digest(alignment);
  f.plan.copy = { sha256: '0'.repeat(64) };
  await assert.rejects(freezeCreativePlan(f.root, f.project, f.plan), /copy hash/i);
  f.plan.copy.sha256 = copy.copySha256;
  await assert.rejects(freezeCreativePlan(f.root, f.project, { ...f.plan, productId: 'another-product' }), /identity/i);
  assert.equal((await freezeCreativePlan(f.root, f.project, f.plan)).copy?.sha256, copy.copySha256);
});

for (const changed of ['narration', 'subtitles', 'voice-binding'] as const) {
  test(`quality copy binding rejects ${changed} that disagrees with approved words or audio`, async t => {
    const f = await fixture(t);
    const copy = await freezeCopyDraft(f.root, f.project, { schemaVersion: '1.0', projectId: f.plan.projectId, productId: f.plan.productId,
      revision: 'COPY-v1', narration: ['旁白'], onScreenText: ['真实功能'], subtitles: ['旁白'], cta: '查看项目' });
    f.plan.copy = { sha256: copy.copySha256 };
    const words = changed === 'narration' ? '未经认可的旁白' : '旁白';
    await writeFile(path.join(f.root, 'inputs/narration.txt'), words);
    f.plan.narration.textHash = digest(words);
    f.plan.sources.push({ source: 'narration', path: 'inputs/narration.txt', sha256: digest(words) });
    const alignment = JSON.stringify({ copySha256: copy.copySha256,
      voiceSha256: changed === 'voice-binding' ? digest('other audio') : f.plan.narration.voiceHash,
      cues: [{ text: changed === 'subtitles' ? '未经认可的字幕' : '旁白', start: 0, end: 1 }] });
    await writeFile(path.join(f.root, 'inputs/alignment.json'), alignment);
    f.plan.narration.alignmentHash = digest(alignment);
    await assert.rejects(freezeCreativePlan(f.root, f.project, f.plan), /approved narration|subtitle|voice.*hash|copy.*alignment/i);
  });
}

test('a different creative plan or variant cannot overwrite an existing task', async t => {
  const f = await fixture(t);
  await freezeCreativePlan(f.root, f.project, f.plan);
  const before = await readFile(path.join(f.project, 'resolved-creative-plan.json'));
  await assert.rejects(freezeCreativePlan(f.root, f.project, { ...f.plan, brief: 'another story' }), /new variant|existing plan/i);
  await assert.rejects(freezeCreativePlan(f.root, f.project, { ...f.plan, variantId: 'direction-b' }), /new variant|existing plan/i);
  assert.deepEqual(await readFile(path.join(f.project, 'resolved-creative-plan.json')), before);
});

test('editing a frozen plan cannot be silently resumed or accepted as the original authored plan', async t => {
  const f = await fixture(t);
  const plan = await freezeCreativePlan(f.root, f.project, f.plan);
  plan.brief = 'changed after freezing';
  await writeFile(path.join(f.project, 'resolved-creative-plan.json'), JSON.stringify(plan));
  await assert.rejects(resumeCreativePlan(f.root, f.project), /plan.*hash|plan.*changed/i);
  await assert.rejects(freezeCreativePlan(f.root, f.project, f.plan), /plan.*hash|plan.*changed/i);
});

test('copying only the frozen task to another Chinese space root resumes without its source library', async t => {
  const f = await fixture(t);
  await freezeCreativePlan(f.root, f.project, f.plan);
  const movedRoot = path.join(f.root, '新 项目');
  const movedProject = path.join(movedRoot, f.projectRelative);
  await mkdir(path.dirname(movedProject), { recursive: true });
  await cp(f.project, movedProject, { recursive: true, errorOnExist: true, force: false });
  assert.equal((await resumeCreativePlan(movedRoot, movedProject)).variantId, 'direction-a');
});

for (const kind of ['asset', 'font', 'voice', 'alignment', 'source'] as const) {
  test(`resume rejects changed frozen ${kind} bytes`, async t => {
    const f = await fixture(t);
    const plan = await freezeCreativePlan(f.root, f.project, f.plan);
    const files = { asset: `${f.projectRelative}/assets/brand-frozen/ip.png`, font: plan.fonts[0]!.path,
      voice: plan.narration.voicePath!, alignment: plan.narration.alignmentPath!, source: plan.sources[0]!.path! };
    await writeFile(path.join(f.root, files[kind]), 'changed after freezing');
    await assert.rejects(resumeCreativePlan(f.root, f.project), /hash|changed/i);
  });
}

test('missing user decisions never become visual, voice or final approval even when plan says approved', async t => {
  const f = await fixture(t);
  f.plan.narration.status = 'APPROVED';
  await freezeCreativePlan(f.root, f.project, f.plan);
  const result = await assessAcceptance(f.root, f.project);
  assert.equal(result.visualReview.status, 'NOT_RUN');
  assert.equal(result.voiceReview.status, 'NOT_RUN');
  assert.equal(result.userAcceptance.status, 'NOT_RUN');
  await assert.rejects(recordHumanDecision(f.root, f.project, { dimension: 'visual', decision: 'ACCEPTED', userInstruction: ' ', videoPath: f.videoPath }), /user instruction/i);
});

test('visual acceptance alone does not approve voice or final and decisions append without replacing history', async t => {
  const f = await fixture(t);
  await freezeCreativePlan(f.root, f.project, f.plan);
  await recordHumanDecision(f.root, f.project, { dimension: 'visual', decision: 'ACCEPTED', userInstruction: '我认可这版画面。', videoPath: f.videoPath });
  let result = await assessAcceptance(f.root, f.project);
  assert.equal(result.visualReview.status, 'PASS');
  assert.equal(result.voiceReview.status, 'NOT_RUN');
  assert.equal(result.userAcceptance.status, 'NOT_RUN');
  await assert.rejects(recordHumanDecision(f.root, f.project, { dimension: 'final', decision: 'ACCEPTED', userInstruction: '确认。', videoPath: f.videoPath }), /visual and voice/i);
  const before = await readdir(path.join(f.project, 'approvals'));
  const original = await readFile(path.join(f.project, 'approvals', before[0]!));
  await recordHumanDecision(f.root, f.project, { dimension: 'visual', decision: 'REJECTED', userInstruction: '请修改画面。', videoPath: f.videoPath });
  result = await assessAcceptance(f.root, f.project);
  assert.equal(result.visualReview.status, 'PARTIAL');
  assert.equal(result.visualReview.decision, 'REJECTED');
  assert.equal((await readdir(path.join(f.project, 'approvals'))).length, 2);
  assert.deepEqual(await readFile(path.join(f.project, 'approvals', before[0]!)), original);
});

for (const changed of ['video', 'voice', 'plan'] as const) {
  test(`accepted decisions become stale after ${changed} changes`, async t => {
    const f = await fixture(t);
    const plan = await freezeCreativePlan(f.root, f.project, f.plan);
    await recordHumanDecision(f.root, f.project, { dimension: 'visual', decision: 'ACCEPTED', userInstruction: '画面通过。', videoPath: f.videoPath });
    await recordHumanDecision(f.root, f.project, { dimension: 'voice', decision: 'ACCEPTED', userInstruction: '声音通过。' });
    await recordHumanDecision(f.root, f.project, { dimension: 'final', decision: 'ACCEPTED', userInstruction: '我接受此版最终样片。', videoPath: f.videoPath });
    assert.equal((await assessAcceptance(f.root, f.project)).userAcceptance.status, 'PASS');
    if (changed === 'video') await writeFile(path.join(f.root, f.videoPath), 'changed video');
    if (changed === 'voice') await writeFile(path.join(f.root, plan.narration.voicePath!), 'changed audio');
    if (changed === 'plan') {
      plan.brief = 'silently replaced brief';
      await writeFile(path.join(f.project, 'resolved-creative-plan.json'), JSON.stringify(plan));
    }
    const result = await assessAcceptance(f.root, f.project);
    assert.equal(result.userAcceptance.status, 'NOT_RUN');
    assert.equal(result.userAcceptance.decision, 'STALE');
    assert.equal((await readdir(path.join(f.project, 'approvals'))).length, 3);
  });
}

test('silent M1 visual samples are allowed but cannot get voice or final acceptance', async t => {
  const f = await fixture(t);
  delete f.plan.narration.voicePath; delete f.plan.narration.voiceHash;
  delete f.plan.narration.alignmentPath; delete f.plan.narration.alignmentHash;
  await freezeCreativePlan(f.root, f.project, f.plan);
  await recordHumanDecision(f.root, f.project, { dimension: 'visual', decision: 'ACCEPTED', userInstruction: '接受视觉方向。', videoPath: f.videoPath });
  await assert.rejects(recordHumanDecision(f.root, f.project, { dimension: 'voice', decision: 'ACCEPTED', userInstruction: '接受声音。' }), /voice/i);
  assert.equal((await assessAcceptance(f.root, f.project)).userAcceptance.status, 'NOT_RUN');
});

test('unsafe font paths, source hashes and uncovered timelines are rejected before freezing', async t => {
  const f = await fixture(t);
  for (const value of ['../font.woff2', '/font.woff2', 'C:\\font.woff2', 'https://example.com/font.woff2']) {
    const plan = structuredClone(f.plan); plan.fonts[0]!.path = value;
    await assert.rejects(freezeCreativePlan(f.root, f.project, plan), /path|traversal/i);
  }
  const wrongHash = structuredClone(f.plan); wrongHash.fonts[0]!.sha256 = digest('not the font');
  await assert.rejects(freezeCreativePlan(f.root, f.project, wrongHash), /hash/i);
  const gap = structuredClone(f.plan); gap.shots[1]!.startFrame = 220;
  await assert.rejects(freezeCreativePlan(f.root, f.project, gap), /gap|coverage/i);
  assert.ok(!(await readdir(f.project)).includes('resolved-creative-plan.json'));
});

test('junctions cannot introduce an outside font or redirect approval writes', async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside'); await mkdir(outside);
  await writeFile(path.join(outside, 'font.woff2'), 'font bytes');
  await symlink(outside, path.join(f.root, 'font-link'), 'junction');
  const bad = structuredClone(f.plan); bad.fonts[0]!.path = 'font-link/font.woff2';
  await assert.rejects(freezeCreativePlan(f.root, f.project, bad), /link|junction/i);
  await freezeCreativePlan(f.root, f.project, f.plan);
  await symlink(outside, path.join(f.project, 'approvals'), 'junction');
  await assert.rejects(recordHumanDecision(f.root, f.project, { dimension: 'visual', decision: 'ACCEPTED', userInstruction: '画面通过。', videoPath: f.videoPath }), /link|junction/i);
  assert.deepEqual(await readdir(outside), ['font.woff2']);
});

async function mixedFixture(t: TestContext) {
  const f = await fixture(t);
  for (const [name, bytes] of Object.entries({ 'music.wav': 'music fixture', 'music-license.txt': 'CC0 fixture license', 'mix.wav': 'mixed audio fixture' })) {
    await writeFile(path.join(f.root, 'inputs', name), bytes);
  }
  const audioMix = { schemaVersion: '1.0' as const, voiceSha256: f.plan.narration.voiceHash!,
    music: { path: 'inputs/music.wav', sha256: digest('music fixture'), licenseId: 'CC0-1.0',
      licensePath: 'inputs/music-license.txt', licenseSha256: digest('CC0 fixture license') },
    mixPath: 'inputs/mix.wav', mixSha256: digest('mixed audio fixture'),
    durationSec: 10, voiceOffsetSec: 0.5, voiceGainDb: 0, musicOffsetSec: 0, musicGainDb: -18, fadeInSec: 0.3, fadeOutSec: 1 };
  return { ...f, plan: { ...f.plan, audioMix } };
}

test('mixed audio freezes raw voice, music, license and mix independently and resumes without sources', async t => {
  const f = await mixedFixture(t);
  const resolved = await freezeCreativePlan(f.root, f.project, f.plan) as typeof f.plan;
  for (const file of [resolved.audioMix.music.path, resolved.audioMix.music.licensePath, resolved.audioMix.mixPath]) {
    assert.ok(file.startsWith(`${f.projectRelative}/assets/quality-frozen/`));
  }
  assert.notEqual(resolved.audioMix.mixSha256, resolved.narration.voiceHash);
  const movedRoot = path.join(f.root, '中文 混音复验');
  const movedProject = path.join(movedRoot, f.projectRelative);
  await mkdir(path.dirname(movedProject), { recursive: true });
  await cp(f.project, movedProject, { recursive: true, errorOnExist: true, force: false });
  assert.equal((await resumeCreativePlan(movedRoot, movedProject) as typeof f.plan).audioMix.mixSha256, digest('mixed audio fixture'));
});

for (const changed of ['music', 'license', 'mix'] as const) {
  test(`a changed frozen ${changed} invalidates mixed-film acceptance`, async t => {
    const f = await mixedFixture(t);
    const resolved = await freezeCreativePlan(f.root, f.project, f.plan) as typeof f.plan;
    await recordHumanDecision(f.root, f.project, { dimension: 'visual', decision: 'ACCEPTED', userInstruction: 'Fixture visual approval', videoPath: f.videoPath });
    const voice = await recordHumanDecision(f.root, f.project, { dimension: 'voice', decision: 'ACCEPTED', userInstruction: 'Fixture raw voice approval' });
    assert.equal(voice.voiceSha256, digest('wave bytes'));
    const final = await recordHumanDecision(f.root, f.project, { dimension: 'final', decision: 'ACCEPTED', userInstruction: 'Fixture complete film approval', videoPath: f.videoPath }) as { mixSha256?: string };
    assert.equal(final.mixSha256, digest('mixed audio fixture'));
    const changedPath = { music: resolved.audioMix.music.path, license: resolved.audioMix.music.licensePath, mix: resolved.audioMix.mixPath }[changed];
    await writeFile(path.join(f.root, changedPath), 'mutated fixture');
    assert.equal((await assessAcceptance(f.root, f.project)).userAcceptance.decision, 'STALE');
  });
}

test('mix rejects voice substitution, unknown license, unsafe paths and invalid timing before freezing', async t => {
  const f = await mixedFixture(t);
  const mutations = [
    (p: typeof f.plan) => { p.audioMix.voiceSha256 = digest('other voice'); },
    (p: typeof f.plan) => { p.audioMix.music.licenseId = 'UNKNOWN'; },
    (p: typeof f.plan) => { p.audioMix.music.path = '../music.wav'; },
    (p: typeof f.plan) => { p.audioMix.mixPath = 'C:\\outside.wav'; },
    (p: typeof f.plan) => { p.audioMix.durationSec = 9; },
    (p: typeof f.plan) => { p.audioMix.fadeOutSec = 11; },
    (p: typeof f.plan) => { p.audioMix.musicGainDb = Number.NaN; },
  ];
  for (const mutate of mutations) {
    const plan = structuredClone(f.plan); mutate(plan);
    await assert.rejects(freezeCreativePlan(f.root, f.project, plan), /mix|music|license|path|traversal/i);
  }
});
