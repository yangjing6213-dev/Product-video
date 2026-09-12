import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initialize } from '../../src/pipeline/project.ts';
import { validProductInput } from '../fixtures/input.ts';

test('new jobs require a deliberate catalog selection; legacy jobs keep their snapshots', async () => {
  const root = await mkdtemp(path.join(tmpdir(), '品牌 项目 '));
  const input = { ...structuredClone(validProductInput), assets: [], projectId: 'brand-init-fixture' };
  const file = path.join(root, 'input.json');
  await writeFile(file, JSON.stringify(input));
  await assert.rejects(initialize(file, root), /brandLibrary/);
  const selection = { selections: [], omissionReason: 'Product-only technical fixture; no IP use.' };
  await writeFile(file, JSON.stringify({ ...input, brandLibrary: selection }));
  await assert.rejects(initialize(file, root), /ENOENT/);
  await mkdir(path.join(root, 'assets/brand/enhe/ip'), { recursive: true });
  await writeFile(path.join(root, 'assets/brand/enhe/ip/catalog.json'), JSON.stringify({ schemaVersion: '1.0', libraryVersion: 'test-v1', assets: [] }));
  const project = await initialize(file, root);
  const snapshot = await readFile(path.join(project, 'frozen-brand-assets.json'), 'utf8');
  assert.equal(JSON.parse(snapshot).selection.omissionReason, selection.omissionReason);
  await writeFile(path.join(root, 'assets/brand/enhe/ip/catalog.json'), 'unavailable updated catalog');
  assert.equal(await initialize(file, root), project);
  assert.equal(await readFile(path.join(project, 'frozen-brand-assets.json'), 'utf8'), snapshot);
});
