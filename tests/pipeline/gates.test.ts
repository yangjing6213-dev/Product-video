import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureWithFallback, requireCreative, selectNarration } from '../../src/pipeline/gates.ts';

test('URL capture succeeds without invoking supplied fallback', async () => {
  const result = await captureWithFallback(async () => ['hero.png'], async () => { throw Error('must not fallback'); });
  assert.equal(result.provider, 'hyperframes-capture');
  assert.deepEqual(result.files, ['hero.png']);
});
test('URL capture failure uses supplied assets and keeps reason', async () => {
  const result = await captureWithFallback(async () => { throw Error('navigation timed out'); }, async () => ['supplied.png']);
  assert.equal(result.provider, 'supplied-assets');
  assert.match(result.reason!, /navigation timed out/);
});
test('failed capture and no supplied assets stops pipeline', async () => {
  await assert.rejects(captureWithFallback(async () => { throw Error('offline'); }, async () => []), /No usable supplied assets/);
});
test('creative generation is gated on all authored artifacts', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'epvs creative '));
  await writeFile(path.join(project, 'DESIGN.md'), '# Brand');
  await assert.rejects(requireCreative(project), /SCRIPT.md/);
});
test('unavailable TTS never claims generated voice; external audio requires actual file', async () => {
  assert.equal(selectNarration('none', false, false).mode, 'none');
  assert.equal(selectNarration('hyperframes', false, false).status, 'SKIPPED_WITH_REASON');
  assert.throws(() => selectNarration('external-audio', false, false), /audio/);
});
