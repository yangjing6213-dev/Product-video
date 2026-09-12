import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { validateInput, validateSpec } from '../contracts.ts';
import type { ProductInput, VideoSpec } from '../contracts.ts';
import { atomicJson, exists, digest, safeProjectId } from './stage-state.ts';
import { REPO } from './tools.ts';
import { freezeBrandAssets, verifyFrozenBrandAssets, resolveProjectAsset } from '../assets/library.ts';
import { isActiveGeneratorPolicy, resolveGeneratorInput, trustedGeneratorPolicy } from '../quality/policy.ts';

export const projectPath = (id: string, root = REPO) => path.join(root, 'projects', safeProjectId(id));
export async function inputFor(project: string): Promise<ProductInput> { return validateInput(JSON.parse(await readFile(path.join(project, 'input/product-input.json'), 'utf8'))); }
export async function specFor(project: string): Promise<VideoSpec> { return validateSpec(JSON.parse(await readFile(path.join(project, 'video-spec.json'), 'utf8'))); }

interface PlannedAsset {
  source: string;
  destination: string;
  relativeDestination: string;
  sourceExists: boolean;
}

function assetPathIdentity(input: ProductInput): ProductInput {
  return {
    ...input,
    assets: input.assets.map((asset) => ({
      ...asset,
      path: `assets/${asset.id}${path.extname(asset.path).toLowerCase()}`,
    })),
  };
}

async function planAssets(input: ProductInput, inputFile: string, project: string): Promise<PlannedAsset[]> {
  const planned: PlannedAsset[] = [];
  const destinations = new Set<string>();
  for (const asset of input.assets) {
    const source = path.resolve(path.dirname(inputFile), asset.path);
    const relativeDestination = `assets/${asset.id}${path.extname(source).toLowerCase()}`;
    const destination = path.join(project, relativeDestination);
    const destinationKey = destination.toLocaleLowerCase();
    if (destinations.has(destinationKey)) throw new Error(`Duplicate asset target: ${asset.id}`);
    destinations.add(destinationKey);
    planned.push({ source, destination, relativeDestination, sourceExists: await exists(source) });
  }
  return planned;
}

export async function initialize(inputFile: string, root = REPO): Promise<string> {
  const submitted = JSON.parse(await readFile(inputFile, 'utf8'));
  const existingPath = projectPath(submitted?.projectId, root);
  const existingInput = await exists(path.join(existingPath, 'input/product-input.json'))
    ? await inputFor(existingPath) : null;
  if (existingInput?.generatorPolicy && existingInput.generatorPolicy.authorEnding !== 'brand-signoff'
      && !trustedGeneratorPolicy(existingInput.generatorPolicy)) {
    throw new Error('Existing generator policy is unknown or modified');
  }
  let contacts = existingInput?.authorContacts;
  if (!existingInput) {
    const contactPath = await resolveProjectAsset(root, 'assets/brand/enhe/author/contact-profile.json', true);
    if (await exists(contactPath)) contacts = JSON.parse(await readFile(contactPath, 'utf8'));
  }
  const input = validateInput(!existingInput || isActiveGeneratorPolicy(existingInput.generatorPolicy)
    ? resolveGeneratorInput(submitted, contacts)
    : submitted);
  // A newly introduced visual default must not upgrade an already frozen active-policy task.
  if (existingInput && !existingInput.brand.visualStyle && !submitted.brand?.visualStyle) delete input.brand.visualStyle;
  const project = projectPath(input.projectId, root);
  const target = path.join(project, 'input/product-input.json');
  const planned = await planAssets(input, inputFile, project);
  const canonicalInput: ProductInput = {
    ...input,
    assets: input.assets.map((asset, index) => ({ ...asset, path: planned[index]!.relativeDestination })),
  };
  if (await exists(target)) {
    const current = await inputFor(project);
    const currentAssets = new Map(current.assets.map((asset) => [asset.id, asset]));
    const metadataMatches = isDeepStrictEqual(assetPathIdentity(current), canonicalInput);
    const assetBytesMatch = (
      await Promise.all(planned.map(async (asset, index) => {
        const currentAsset = currentAssets.get(input.assets[index]!.id);
        if (!currentAsset) return false;
        const currentFile = path.join(project, currentAsset.path);
        if (!asset.sourceExists) return exists(currentFile);
        if (!await exists(currentFile)) return false;
        return digest(await readFile(asset.source)) === digest(await readFile(currentFile));
      }))
    ).every(Boolean);
    if (metadataMatches && assetBytesMatch) {
      if (current.brandLibrary) await freezeBrandAssets(root, project, current.brandLibrary);
      return project;
    }
    throw new Error('Project already exists with different input; use a new projectId to preserve existing data');
  }
  if (!input.brandLibrary) throw new Error('New tasks require brandLibrary selections with pinned approved versions, or a semantic omissionReason');
  for (const [index, asset] of input.assets.entries()) {
    const plan = planned[index]!;
    if (!plan.sourceExists && asset.required && !asset.fallbackAssetId) {
      throw new Error(`Required asset missing: ${asset.id}`);
    }
    if (await exists(plan.destination)) throw new Error(`Asset target already exists: ${asset.id}`);
  }
  await freezeBrandAssets(root, project, input.brandLibrary);
  await mkdir(path.join(project, 'assets'), { recursive: true });
  for (const asset of planned) {
    if (asset.sourceExists) await copyFile(asset.source, asset.destination);
  }
  await atomicJson(target, canonicalInput);
  await writeFile(path.join(project, 'CREATIVE-NEXT.md'), 'Use skills/enhe-product-video/SKILL.md after capture to author DESIGN.md, SCRIPT.md, STORYBOARD.md, video-spec.json and compositions.\n');
  return project;
}
export async function verifyProjectBrand(project: string): Promise<void> {
  const input = await inputFor(project);
  if (!input.brandLibrary) return; // Historical jobs retain their original asset contract.
  const frozen = await verifyFrozenBrandAssets(path.resolve(project, '../..'), project);
  if (JSON.stringify(frozen.selection) !== JSON.stringify(input.brandLibrary)) throw new Error('Task brand selection differs from its frozen manifest');
}
export async function manifest(project: string, input: ProductInput): Promise<string> {
  const assets = [];
  for (const asset of input.assets) {
    const file = path.join(project, asset.path);
    assets.push({ ...asset, sha256: await exists(file) ? digest(await readFile(file)) : null });
  }
  const file = path.join(project, 'assets/assets-manifest.json');
  await atomicJson(file, { schemaVersion: '1.0', projectId: input.projectId, assets });
  return file;
}
