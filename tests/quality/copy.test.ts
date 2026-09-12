// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rm, cp, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { freezeCopyDraft, readCopyDraft, recordCopyDecision, assessCopyReview, assertCopyApproved, type CopyDraft } from '../../src/quality/copy.ts';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function fixture(t: TestContext) {
  const root = path.join(repository, '.cache', `copy-test-${randomUUID()}`);
  const project = path.join(root, 'projects', 'sample');
  await mkdir(project, { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(root), path.join(repository, '.cache'));
    assert.match(path.basename(root), /^copy-test-/);
    await rm(root, { recursive: true });
  });
  const draft: CopyDraft = { schemaVersion: '1.0', projectId: 'sample', productId: 'real-product', revision: 'COPY-v1',
    narration: ['写了半天，读者还是一脸问号？', '先看清单，再动笔。'],
    onScreenText: ['先确认，再绘制', 'Enhe（恩禾）'], subtitles: ['写了半天，读者还是一脸问号？', '先看清单，再动笔。'],
    cta: '去项目主页看看。' };
  return { root, project, draft };
}

test('new copy is unapproved and a missing decision prevents generation', async t => {
  const f = await fixture(t);
  assert.equal((await assessCopyReview(f.root, f.project)).status, 'NOT_RUN');
  await freezeCopyDraft(f.root, f.project, f.draft);
  assert.equal((await assessCopyReview(f.root, f.project)).decision, 'NOT_RUN');
  await assert.rejects(assertCopyApproved(f.root, f.project), /copy.*approval/i);
  assert.deepEqual(await readdir(f.project), ['copy-script.json']);
});

test('copy freeze is repeatable and cannot replace another version', async t => {
  const f = await fixture(t);
  const first = await freezeCopyDraft(f.root, f.project, f.draft);
  const bytes = await readFile(path.join(f.project, 'copy-script.json'));
  assert.deepEqual(await freezeCopyDraft(f.root, f.project, f.draft), first);
  await assert.rejects(freezeCopyDraft(f.root, f.project, { ...f.draft, revision: 'COPY-v2' }), /new.*variant|existing/i);
  assert.deepEqual(await readFile(path.join(f.project, 'copy-script.json')), bytes);
});

test('approval binds all reviewed text and preserves append-only rejection history', async t => {
  const f = await fixture(t); const copy = await freezeCopyDraft(f.root, f.project, f.draft);
  const accepted = await recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: copy.copySha256, userInstruction: '我确认 COPY-v1 的旁白、屏幕文字、字幕和行动提示。' });
  assert.equal(accepted.reviewerType, 'USER');
  assert.equal((await assertCopyApproved(f.root, f.project, { projectId: 'sample', copySha256: copy.copySha256 })).copySha256, copy.copySha256);
  const firstFile = (await readdir(path.join(f.project, 'copy-approvals')))[0]!;
  const firstBytes = await readFile(path.join(f.project, 'copy-approvals', firstFile));
  await recordCopyDecision(f.root, f.project, { decision: 'REJECTED', copySha256: copy.copySha256, userInstruction: '这版文案请调整。' });
  assert.equal((await assessCopyReview(f.root, f.project)).decision, 'REJECTED');
  await assert.rejects(assertCopyApproved(f.root, f.project), /copy.*approval/i);
  assert.equal((await readdir(path.join(f.project, 'copy-approvals'))).length, 2);
  assert.deepEqual(await readFile(path.join(f.project, 'copy-approvals', firstFile)), firstBytes);
});

test('empty instructions or a different reviewed hash cannot create approval', async t => {
  const f = await fixture(t); const copy = await freezeCopyDraft(f.root, f.project, f.draft);
  await assert.rejects(recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: copy.copySha256, userInstruction: ' ' }), /user instruction/i);
  await assert.rejects(recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: '0'.repeat(64), userInstruction: '认可。' }), /hash|reviewed/i);
  assert.deepEqual(await readdir(f.project), ['copy-script.json']);
});

for (const changed of ['narration', 'onScreenText', 'subtitles', 'cta'] as const) {
  test(`a changed ${changed} cannot reuse approval`, async t => {
    const f = await fixture(t); const copy = await freezeCopyDraft(f.root, f.project, f.draft);
    await recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: copy.copySha256, userInstruction: '我认可此版文案。' });
    const different = changed === 'cta' ? '不同的行动提示' : ['不同文字'];
    await assert.rejects(assertCopyApproved(f.root, f.project, { [changed]: different }), /copy.*differs|changed/i);
  });
}

test('font, scene, timing and voice changes do not alter independent copy approval', async t => {
  const f = await fixture(t); const copy = await freezeCopyDraft(f.root, f.project, f.draft);
  await recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: copy.copySha256, userInstruction: '我认可此版文案。' });
  await writeFile(path.join(f.project, 'DESIGN.md'), '改用真实工作室，保留原IP。');
  await writeFile(path.join(f.project, 'voice-settings.json'), JSON.stringify({ voice: 'zm_011', phrasing: '轻松推荐', durationSec: 37 }));
  assert.equal((await assessCopyReview(f.root, f.project)).status, 'PASS');
  assert.deepEqual(await readCopyDraft(f.root, f.project), copy);
});

test('copy and approval can relocate together but cannot transfer to a different video', async t => {
  const f = await fixture(t); const copy = await freezeCopyDraft(f.root, f.project, f.draft);
  await recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: copy.copySha256, userInstruction: '我认可此版文案。' });
  const relocatedRoot = path.join(f.root, '中文 新根'); const relocated = path.join(relocatedRoot, 'projects/sample');
  await cp(f.project, relocated, { recursive: true, errorOnExist: true, force: false });
  assert.equal((await assessCopyReview(relocatedRoot, relocated)).status, 'PASS');
  const other = path.join(f.root, 'projects/another-video'); await cp(f.project, other, { recursive: true, errorOnExist: true, force: false });
  await assert.rejects(assertCopyApproved(f.root, other), /copy.*approval|identity|project/i);
});

test('changed frozen bytes and malformed approval history fail closed', async t => {
  const f = await fixture(t); const copy = await freezeCopyDraft(f.root, f.project, f.draft);
  await recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: copy.copySha256, userInstruction: '我认可此版文案。' });
  const file = path.join(f.project, 'copy-script.json'); const bytes = await readFile(file);
  await writeFile(file, JSON.stringify({ ...copy, cta: '悄悄替换' }));
  assert.equal((await assessCopyReview(f.root, f.project)).decision, 'STALE');
  await assert.rejects(assertCopyApproved(f.root, f.project), /copy.*approval/i);
  await writeFile(file, bytes);
  await writeFile(path.join(f.project, 'copy-approvals', 'broken.json'), '{');
  assert.equal((await assessCopyReview(f.root, f.project)).decision, 'STALE');
});

test('subtitles cannot introduce unreviewed claims and approval directories cannot be junctions', async t => {
  const f = await fixture(t);
  await assert.rejects(freezeCopyDraft(f.root, f.project, { ...f.draft, subtitles: ['保证提高十倍效率。'] }), /subtitle|narration/i);
  const copy = await freezeCopyDraft(f.root, f.project, f.draft);
  const outside = path.join(f.root, 'outside'); await mkdir(outside);
  await symlink(outside, path.join(f.project, 'copy-approvals'), 'junction');
  await assert.rejects(recordCopyDecision(f.root, f.project, { decision: 'ACCEPTED', copySha256: copy.copySha256, userInstruction: '认可。' }), /link|junction/i);
  assert.deepEqual(await readdir(outside), []);
});

test('the real copy CLI freezes, checks, and records only the explicitly supplied reviewed decision', async t => {
  const f = await fixture(t);
  const run = async (args: string[]) => promisify(execFile)(process.execPath, [path.join(repository, 'src/quality/cli.ts'), ...args,
    '--project-root', f.root, '--project', 'sample'], { cwd: repository, windowsHide: true });
  const input = path.join(f.root, 'reviewed-copy.json'); await writeFile(input, JSON.stringify(f.draft));
  const frozen = JSON.parse((await run(['copy-freeze', '--copy', input])).stdout);
  assert.equal(JSON.parse((await run(['copy-status'])).stdout).status, 'NOT_RUN');
  await assert.rejects(run(['copy-check']), /Copy approval required/);
  const decision = path.join(f.root, 'decision.json');
  await writeFile(decision, JSON.stringify({ decision: 'ACCEPTED', copySha256: frozen.copySha256, userInstruction: 'TEST FIXTURE ONLY: reviewed words approved.' }));
  await run(['copy-review', '--decision', decision]);
  assert.equal(JSON.parse((await run(['copy-check'])).stdout).copySha256, frozen.copySha256);
  assert.equal(JSON.parse((await run(['copy-status'])).stdout).status, 'PASS');
});
