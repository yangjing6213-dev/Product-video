// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { freezeBrandAssets, loadBrandCatalog, resolveProjectAsset, verifyFrozenBrandAssets, writeExclusiveSnapshot } from '../../src/assets/library.ts';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function fixture(reviewStatus = 'APPROVED') {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'EPVS 中文 库 ')));
  const originalPath = 'assets/brand/enhe/ip/originals/角色 图片.svg';
  await mkdir(path.dirname(path.join(root, originalPath)), { recursive: true });
  const bytes = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="30" fill="#004cff"/></svg>';
  await writeFile(path.join(root, originalPath), bytes);
  const asset = { assetId: 'enhe-ip-camera', contentVersion: 'v1', sha256: hash(bytes), originalPath, preparedPath: null, preparedHash: null,
    previewPath: null, reviewStatus, mediaType: 'image/svg+xml', width: 80, height: 80, hasTransparency: true,
    layering: 'flat', role: 'creator', tags: ['creation'], expression: null, pose: 'camera', embeddedText: [],
    recommendedUses: ['result'], restrictedUses: [], rightsNote: 'Local project use only', provenance: { kind: 'user-supplied', runId: 'fixture', sourceRelativePath: '角色 图片.svg' } };
  const catalog = { schemaVersion: '1.0', libraryVersion: 'library-1', assets: [asset] };
  const file = path.join(root, 'assets/brand/enhe/ip/catalog.json');
  await writeFile(file, JSON.stringify(catalog));
  return { root, asset, catalog, file, bytes, job: path.join(root, 'projects', 'film') };
}

test('new brand tasks reject unreviewed assets and pin an explicit reviewed content version', async () => {
  const f = await fixture('UNREVIEWED');
  try {
    await assert.rejects(freezeBrandAssets(f.root, f.job, { selections: [{ assetId: f.asset.assetId, contentVersion: 'v1', sha256: f.asset.sha256, purpose: 'creation result' }] }), /APPROVED/);
    f.catalog.assets[0]!.reviewStatus = 'APPROVED';
    await writeFile(f.file, JSON.stringify(f.catalog));
    await assert.rejects(freezeBrandAssets(f.root, f.job, { selections: [{ assetId: f.asset.assetId, contentVersion: 'v2', sha256: f.asset.sha256, purpose: 'result' }] }), /version|hash/i);
    const frozen = await freezeBrandAssets(f.root, f.job, { selections: [{ assetId: f.asset.assetId, contentVersion: 'v1', sha256: f.asset.sha256, purpose: 'creation result' }] });
    assert.equal(frozen.assets.length, 1);
    assert.equal(await readFile(path.join(f.root, frozen.assets[0]!.frozenPath), 'utf8'), f.bytes);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('resume uses frozen bytes even after library changes or removal; new selection cannot overwrite them', async () => {
  const f = await fixture();
  try {
    const selection = { selections: [{ assetId: f.asset.assetId, contentVersion: 'v1', sha256: f.asset.sha256, purpose: 'result' }] };
    const first = await freezeBrandAssets(f.root, f.job, selection);
    const before = await readFile(path.join(f.job, 'frozen-brand-assets.json'));
    await writeFile(path.join(f.root, f.asset.originalPath), 'new unapproved version');
    await rm(f.file);
    const resumed = await freezeBrandAssets(f.root, f.job, selection);
    assert.deepEqual(resumed, first);
    assert.deepEqual(await readFile(path.join(f.job, 'frozen-brand-assets.json')), before);
    assert.equal((await verifyFrozenBrandAssets(f.root, f.job)).assets.length, 1);
    await assert.rejects(freezeBrandAssets(f.root, f.job, { selections: [{ ...selection.selections[0]!, contentVersion: 'v2' }] }), /new variant|different/i);
    await writeFile(path.join(f.root, first.assets[0]!.frozenPath), 'tampered');
    await assert.rejects(verifyFrozenBrandAssets(f.root, f.job), /hash|changed/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('relative assets reject traversal, absolute paths and junction escape', async () => {
  const f = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), 'EPVS outside '));
  try {
    for (const candidate of ['../secret', 'C:\\Users\\secret.png', '/etc/passwd', '..\\escape', 'assets/../../escape', 'assets/a:stream']) {
      await assert.rejects(resolveProjectAsset(f.root, candidate), /relative|outside|unsafe|traversal/i);
    }
    await writeFile(path.join(outside, 'outside.svg'), 'private');
    await symlink(outside, path.join(f.root, 'linked'), 'junction');
    await assert.rejects(resolveProjectAsset(f.root, 'linked/outside.svg'), /link|outside/i);
    assert.equal(await resolveProjectAsset(f.root, f.asset.originalPath.replaceAll('/', '\\')), path.join(f.root, f.asset.originalPath));
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('catalog rejects duplicate identities and source bytes drifting from the approved hash', async () => {
  const f = await fixture();
  try {
    f.catalog.assets.push({ ...f.asset });
    await writeFile(f.file, JSON.stringify(f.catalog));
    await assert.rejects(loadBrandCatalog(f.root), /duplicate/i);
    f.catalog.assets.pop();
    await writeFile(f.file, JSON.stringify(f.catalog));
    await writeFile(path.join(f.root, f.asset.originalPath), 'changed');
    await assert.rejects(freezeBrandAssets(f.root, f.job, { selections: [{ assetId: f.asset.assetId, contentVersion: 'v1', sha256: f.asset.sha256, purpose: 'result' }] }), /hash|changed/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('an intentional no-IP decision still reads the project catalog and records the reason', async () => {
  const f = await fixture();
  try {
    await assert.rejects(freezeBrandAssets(f.root, f.job, { selections: [] }), /reason/i);
    const result = await freezeBrandAssets(f.root, f.job, { selections: [], omissionReason: 'This technical product demonstration has no semantic need for an IP character.' });
    assert.deepEqual(result.assets, []);
    assert.equal(result.libraryVersion, 'library-1');
    assert.match(result.selection.omissionReason!, /technical product/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('approval and catalog digest bind the same bytes when a review changes during freezing', async t => {
  const f = await fixture();
  const originalRead = fs.promises.readFile;
  const approvedBytes = await originalRead(f.file);
  const selection = { selections: [{ assetId: f.asset.assetId, contentVersion: 'v1', sha256: f.asset.sha256, purpose: 'result' }] };
  let catalogReads = 0;
  t.mock.method(fs.promises, 'readFile', async (...args: Parameters<typeof readFile>) => {
    const bytes = await originalRead(...args);
    if (path.resolve(String(args[0])) === f.file && ++catalogReads === 1) {
      f.catalog.libraryVersion = 'review-revoked';
      f.catalog.assets[0]!.reviewStatus = 'EXCLUDED';
      await writeFile(f.file, JSON.stringify(f.catalog));
    }
    return bytes;
  });
  syncBuiltinESMExports();
  try {
    const frozen = await freezeBrandAssets(f.root, f.job, selection);
    assert.equal(catalogReads, 1);
    assert.equal(frozen.libraryVersion, 'library-1');
    assert.equal(frozen.catalogSha256, hash(approvedBytes));
    t.mock.restoreAll(); syncBuiltinESMExports();
    await assert.rejects(freezeBrandAssets(f.root, path.join(f.root, 'projects', 'new-film'), selection), /APPROVED/);
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    assert.equal(path.dirname(f.root), await realpath(tmpdir()));
    await rm(f.root, { recursive: true, force: true });
  }
});

test('an interrupted pending snapshot never publishes partial bytes and can be retried', async t => {
  const f = await fixture();
  const destination = path.join(f.root, 'snapshot.json');
  const originalOpen = fs.promises.open;
  let interrupted = false;
  t.mock.method(fs.promises, 'open', async (...args: Parameters<typeof fs.promises.open>) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).startsWith(`${destination}.`) && !interrupted) {
      interrupted = true;
      const originalWrite = handle.writeFile.bind(handle);
      t.mock.method(handle, 'writeFile', async () => {
        await originalWrite('{"partial":');
        throw Object.assign(new Error('fixture interrupted pending write'), { code: 'EIO' });
      });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(writeExclusiveSnapshot(destination, '{"complete":true}\n'), /interrupted pending write/);
    assert.equal(interrupted, true);
    await assert.rejects(readFile(destination), { code: 'ENOENT' });
    t.mock.restoreAll(); syncBuiltinESMExports();
    await writeExclusiveSnapshot(destination, '{"complete":true}\n');
    assert.equal(await readFile(destination, 'utf8'), '{"complete":true}\n');
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    assert.equal(path.dirname(f.root), await realpath(tmpdir()));
    await rm(f.root, { recursive: true, force: true });
  }
});

test('exclusive snapshot publication preserves an already existing destination', async () => {
  const f = await fixture();
  const destination = path.join(f.root, 'snapshot.json');
  try {
    await writeFile(destination, 'existing user snapshot');
    await assert.rejects(writeExclusiveSnapshot(destination, 'replacement'), { code: 'EEXIST' });
    assert.equal(await readFile(destination, 'utf8'), 'existing user snapshot');
  } finally {
    assert.equal(path.dirname(f.root), await realpath(tmpdir()));
    await rm(f.root, { recursive: true, force: true });
  }
});
