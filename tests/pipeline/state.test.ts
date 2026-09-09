import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runStage, readState, hashFiles, safeProjectId } from '../../src/pipeline/stage-state.ts';

test('same input resume skips capture and voice; changed content reruns', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'epvs state with spaces '));
  const input = path.join(root, 'input.json');
  await writeFile(input, 'a');
  let capture = 0, voice = 0;
  const execute = async () => {
    const hash = await hashFiles([input]);
    await runStage(root, 'capture', hash, true, async () => { capture++; return { outputs: [] }; });
    await runStage(root, 'voice', hash, true, async () => { voice++; return { outputs: [] }; });
  };
  await execute(); await execute();
  assert.deepEqual([capture, voice], [1, 1]);
  await writeFile(input, 'b'); await execute();
  assert.deepEqual([capture, voice], [2, 2]);
  assert.equal((await readState(root)).stages.capture?.status, 'PASS');
});

test('failure persists FAIL and propagates, preventing following stage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'epvs fail '));
  let rendered = false;
  await assert.rejects(async () => {
    await runStage(root, 'qa', 'hash', true, async () => { throw new Error('overflow'); });
    rendered = true;
  }, /overflow/);
  assert.equal(rendered, false);
  assert.equal((await readState(root)).stages.qa?.status, 'FAIL');
  assert.match(await readFile(path.join(root, 'run-state.json'), 'utf8'), /overflow/);
});

test('missing cached output forces rerun', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'epvs output '));
  let calls = 0;
  const output = path.join(root, 'render.mp4');
  const op = async () => {
    calls += 1;
    await writeFile(output, `render-${calls}`);
    return { outputs: [output], calls };
  };
  await runStage(root, 'final', 'hash', true, op);
  await unlink(output);
  await runStage(root, 'final', 'hash', true, op);
  assert.equal(calls, 2);
});

test('stage contract version changes invalidate cache while legacy records mean baseline version 1', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'epvs stage version '));
  let calls = 0;
  const op = async () => ({ outputs: [], calls: ++calls });
  await runStage(root, 'capture', 'same-input', true, op, 1);
  const legacy = await readState(root);
  delete legacy.stages.capture!.contractVersion;
  await writeFile(path.join(root, 'run-state.json'), `${JSON.stringify(legacy)}\n`);

  await runStage(root, 'capture', 'same-input', true, op, 1);
  assert.equal(calls, 1);
  assert.equal((await readState(root)).stages.capture?.contractVersion, 1);

  await runStage(root, 'capture', 'same-input', true, op, 2);
  assert.equal(calls, 2);
  assert.equal((await readState(root)).stages.capture?.contractVersion, 2);
});

test('project identifiers cannot escape project directory', () => {
  assert.equal(safeProjectId('brand-studio-01'), 'brand-studio-01');
  for (const value of ['../oops', 'C:\\outside', '.', 'bad/name', '', 'Project', 'project_name', 'project.name', 'a'.repeat(81)]) {
    assert.throws(() => safeProjectId(value));
  }
});
