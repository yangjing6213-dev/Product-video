// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { digest, exists } from '../pipeline/stage-state.ts';

export const BRAND_CATALOG = 'assets/brand/enhe/ip/catalog.json';
export interface BrandAsset {
  assetId: string; contentVersion: string; sha256: string; originalPath: string;
  preparedPath: string | null; preparedHash: string | null; previewPath: string | null;
  reviewStatus: 'UNREVIEWED' | 'APPROVED' | 'EXCLUDED';
  mediaType: string; width: number | null; height: number | null; hasTransparency: boolean | null;
  layering: string; role: string | null; tags: string[]; expression: string | null; pose: string | null;
  embeddedText: string[]; recommendedUses: string[]; restrictedUses: string[];
  rightsNote: string; provenance: Record<string, unknown>;
}
export interface BrandCatalog { schemaVersion: '1.0'; libraryVersion: string; assets: BrandAsset[] }
export interface BrandSelection {
  selections: Array<{ assetId: string; contentVersion: string; sha256: string; purpose: string }>;
  omissionReason?: string;
}
export interface FrozenBrandAsset {
  assetId: string; contentVersion: string; sha256: string; purpose: string;
  frozenPath: string; jobPath: string; sourcePath: string; mediaType: string;
}
export interface FrozenBrandManifest {
  schemaVersion: '1.0'; libraryVersion: string; catalogSha256: string; selection: BrandSelection;
  assets: FrozenBrandAsset[];
}
const SHA = /^[0-9a-f]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/** Flush the complete snapshot before an atomic, no-overwrite publication. */
export async function writeExclusiveSnapshot(file: string, bytes: string | Uint8Array): Promise<void> {
  const temporary = `${file}.${randomUUID()}.pending`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  try { await link(temporary, file); }
  finally { await unlink(temporary); }
}

export function normalizedRelativePath(value: string): string {
  if (typeof value !== 'string' || !value || /[:\0]/.test(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error('Asset path must be a safe project-relative path');
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Unsafe traversal in project asset path');
  return normalized;
}

/** Check every existing path component: a junction inside the root is still not an asset. */
export async function resolveProjectAsset(root: string, relative: string, allowMissing = false): Promise<string> {
  const normalized = normalizedRelativePath(relative);
  const base = await realpath(root);
  let current = base;
  for (const part of normalized.split('/')) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error('Asset links and junctions are not allowed');
      const resolved = await realpath(current);
      const inside = path.relative(base, resolved);
      if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) throw new Error('Asset resolves outside project root');
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  return current;
}

function checkSelection(selection: BrandSelection): void {
  if (!selection || !Array.isArray(selection.selections)) throw new Error('A deliberate brand-library selection is required');
  if (!selection.selections.length && !selection.omissionReason?.trim()) throw new Error('A semantic omission reason is required when no IP is selected');
  const used = new Set<string>();
  for (const item of selection.selections) {
    if (!ID.test(item.assetId) || used.has(item.assetId) || !item.contentVersion || !SHA.test(item.sha256) || !item.purpose?.trim()) {
      throw new Error('Invalid or duplicate pinned brand selection');
    }
    used.add(item.assetId);
  }
}

async function readCatalogSnapshot(root: string): Promise<{ catalog: BrandCatalog; sha256: string }> {
  const file = await resolveProjectAsset(root, BRAND_CATALOG);
  const bytes = await readFile(file);
  const catalog = JSON.parse(bytes.toString('utf8')) as BrandCatalog;
  if (catalog.schemaVersion !== '1.0' || !catalog.libraryVersion || !Array.isArray(catalog.assets)) throw new Error('Invalid brand catalog');
  const used = new Set<string>();
  for (const asset of catalog.assets) {
    if (!ID.test(asset.assetId) || used.has(asset.assetId)) throw new Error('Invalid or duplicate catalog asset identity');
    used.add(asset.assetId);
    if (!SHA.test(asset.sha256) || !asset.contentVersion || !['UNREVIEWED', 'APPROVED', 'EXCLUDED'].includes(asset.reviewStatus)) throw new Error(`Invalid catalog version/review: ${asset.assetId}`);
    normalizedRelativePath(asset.originalPath);
    if (asset.preparedPath) {
      normalizedRelativePath(asset.preparedPath);
      if (!asset.preparedHash || !SHA.test(asset.preparedHash)) throw new Error('Prepared asset needs its own content hash');
    } else if (asset.preparedHash) throw new Error('Prepared hash has no prepared path');
    if (asset.previewPath) normalizedRelativePath(asset.previewPath);
  }
  return { catalog, sha256: digest(bytes) };
}
export async function loadBrandCatalog(root: string): Promise<BrandCatalog> { return (await readCatalogSnapshot(root)).catalog; }

export async function verifyFrozenBrandAssets(root: string, project: string): Promise<FrozenBrandManifest> {
  const projectRelative = normalizedRelativePath(path.relative(root, project));
  const manifestFile = await resolveProjectAsset(root, `${projectRelative}/frozen-brand-assets.json`);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as FrozenBrandManifest;
  if (manifest.schemaVersion !== '1.0' || !SHA.test(manifest.catalogSha256) || !Array.isArray(manifest.assets)) throw new Error('Invalid frozen brand manifest');
  checkSelection(manifest.selection);
  if (manifest.assets.length !== manifest.selection.selections.length) throw new Error('Frozen asset selection changed');
  for (const [index, asset] of manifest.assets.entries()) {
    const selected = manifest.selection.selections[index]!;
    if (asset.assetId !== selected.assetId || asset.contentVersion !== selected.contentVersion || asset.sha256 !== selected.sha256 || asset.purpose !== selected.purpose) {
      throw new Error('Frozen brand selection or version changed');
    }
    const jobPath = normalizedRelativePath(asset.jobPath);
    if (asset.frozenPath !== `${projectRelative}/${jobPath}` || !jobPath.startsWith('assets/brand-frozen/')) throw new Error('Frozen asset path is outside its job snapshot');
    const frozen = await resolveProjectAsset(root, asset.frozenPath);
    if (digest(await readFile(frozen)) !== asset.sha256) throw new Error(`Frozen asset hash changed: ${asset.assetId}`);
  }
  return manifest;
}

export async function freezeBrandAssets(root: string, project: string, selection: BrandSelection): Promise<FrozenBrandManifest> {
  checkSelection(selection);
  const projectRelative = normalizedRelativePath(path.relative(root, project));
  const output = await resolveProjectAsset(root, `${projectRelative}/frozen-brand-assets.json`, true);
  if (await exists(output)) {
    const current = await verifyFrozenBrandAssets(root, project);
    if (JSON.stringify(current.selection) !== JSON.stringify(selection)) throw new Error('Different brand selection requires a new variant/project; existing snapshot is preserved');
    return current;
  }
  const { catalog, sha256: catalogSha256 } = await readCatalogSnapshot(root);
  const planned: Array<{ asset: BrandAsset; source: string; item: BrandSelection['selections'][number]; hash: string; jobPath: string }> = [];
  for (const item of selection.selections) {
    const asset = catalog.assets.find(entry => entry.assetId === item.assetId);
    if (!asset || asset.reviewStatus !== 'APPROVED') throw new Error(`Brand asset must be APPROVED: ${item.assetId}`);
    const selectedHash = asset.preparedPath ? asset.preparedHash! : asset.sha256;
    if (asset.contentVersion !== item.contentVersion || selectedHash !== item.sha256) throw new Error(`Pinned brand version/hash changed: ${item.assetId}`);
    const source = await resolveProjectAsset(root, asset.preparedPath ?? asset.originalPath);
    if (digest(await readFile(source)) !== selectedHash) throw new Error(`Approved source hash changed: ${item.assetId}`);
    const extension = path.extname(source).toLowerCase();
    if (!/^\.[a-z0-9]{1,10}$/.test(extension)) throw new Error('Selected render asset needs a supported file extension');
    planned.push({ asset, source, item, hash: selectedHash, jobPath: `assets/brand-frozen/${item.assetId}-${selectedHash.slice(0,16)}${extension}` });
  }
  const frozen: FrozenBrandManifest = { schemaVersion: '1.0', libraryVersion: catalog.libraryVersion,
    catalogSha256, selection: structuredClone(selection), assets: [] };
  for (const entry of planned) {
    const frozenPath = `${projectRelative}/${entry.jobPath}`;
    const target = await resolveProjectAsset(root, frozenPath, true);
    await mkdir(path.dirname(target), { recursive: true });
    if (await exists(target)) {
      if (digest(await readFile(target)) !== entry.hash) throw new Error('Conflicting frozen asset is preserved; use a new variant');
    } else {
      const bytes = await readFile(entry.source);
      if (digest(bytes) !== entry.hash) throw new Error('Source changed before snapshot publication');
      await writeExclusiveSnapshot(target, bytes);
    }
    if (digest(await readFile(target)) !== entry.hash) throw new Error('Frozen asset hash mismatch after copy');
    frozen.assets.push({ ...entry.item, frozenPath, jobPath: entry.jobPath, sourcePath: entry.asset.preparedPath ?? entry.asset.originalPath, mediaType: entry.asset.mediaType });
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeExclusiveSnapshot(output, `${JSON.stringify(frozen, null, 2)}\n`);
  return verifyFrozenBrandAssets(root, project);
}
