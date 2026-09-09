import { readFileSync } from 'node:fs';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

export type AssetType = 'logo' | 'screenshot' | 'screen-recording' | 'image' | 'audio' | 'font';
export type AssetLicense = 'owned' | 'authorized' | 'unknown';

export interface Asset {
  id: string;
  type: AssetType;
  path: string;
  sourceUrl: string;
  license: AssetLicense;
  required: boolean;
  fallbackAssetId: string | null;
}

export interface ProductDetails {
  name: string;
  url: string;
  oneLiner: string;
  targetAudience: string[];
  primaryProblem: string;
  valueProposition: string;
  features: Array<{
    name: string;
    benefit: string;
    evidenceAssetIds: string[];
  }>;
  proofPoints: string[];
  cta: {
    label: string;
    url: string;
  };
}

export interface BrandSpec {
  logoAssetId: string;
  colors: string[];
  fontFamilies: string[];
  motionTone: string;
  canvas: 'dark' | 'light';
  mustAvoid: string[];
}

export interface OutputSpec {
  locale: string;
  width: 1920;
  height: 1080;
  fps: 30;
  targetDurationSec: number;
  quality: 'draft' | 'standard' | 'high';
}

export interface AudioSpec {
  narrationMode: 'hyperframes' | 'external-audio' | 'none';
  voice: string;
  externalAudioAssetId: string | null;
  musicAssetId: string | null;
}

export interface CaptionSpec {
  enabled: boolean;
  maxLines: number;
  safeAreaPercent: number;
  style: string;
}

export interface ProductInput {
  schemaVersion: '1.0';
  projectId: string;
  product: ProductDetails;
  brand: BrandSpec;
  assets: Asset[];
  output: OutputSpec;
  audio: AudioSpec;
  captions: CaptionSpec;
}

export interface Scene {
  id: string;
  recipe: string;
  goal: string;
  plannedDurationSec: number;
  actualStartSec: number | null;
  actualEndSec: number | null;
  voiceover: string;
  onScreenText: string[];
  assetRefs: string[];
  compositionFile: string;
  motionDirection: string;
  transition: {
    type: 'wipe' | 'reveal' | 'crossfade' | 'shader';
    durationSec: number;
  };
  fallback: {
    onMissingAsset: 'use-brand-card';
    onUnsupportedEffect: 'use-css-reveal';
  };
  caption?: string;
  heroFrameSec?: number;
}

export interface VideoSpec extends ProductInput {
  recipeVersion: string;
  promptVersions: Record<string, string>;
  narrative: {
    coreMessage: string;
    cta: string;
  };
  scenes: Scene[];
  qa: {
    checks: string[];
  };
  provenance: {
    sourceUrls: string[];
    generatedAt: string;
  };
}

export interface CheckResult {
  id: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED_WITH_REASON';
  message: string;
}

export interface QaReport {
  schemaVersion: '1.0';
  projectId: string;
  status: 'PASS' | 'FAIL' | 'PARTIAL';
  generatedAt: string;
  checks: CheckResult[];
  warnings?: string[];
  artifacts?: Record<string, string>;
}

function readSchema(fileName: string): object {
  const schemaUrl = new URL(`../schemas/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(schemaUrl, 'utf8')) as object;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const productInputSchema = readSchema('product-input.schema.json');
ajv.addSchema(productInputSchema);

const inputValidator = requireValidator<ProductInput>('https://enhe.local/schemas/product-input.schema.json');
const specValidator = ajv.compile<VideoSpec>(readSchema('video-spec.schema.json'));
const qaReportValidator = ajv.compile<QaReport>(readSchema('qa-report.schema.json'));

function requireValidator<T>(schemaId: string): ValidateFunction<T> {
  const validator = ajv.getSchema<T>(schemaId);
  if (!validator) {
    throw new Error(`Schema was not registered: ${schemaId}`);
  }
  return validator;
}

function validationError(label: string, validator: ValidateFunction): Error {
  const details = (validator.errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('; ');
  return new Error(`${label} validation failed: ${details}`);
}

export function validateInput(value: unknown): ProductInput {
  if (!inputValidator(value)) {
    throw validationError('Product input', inputValidator);
  }
  return value;
}

export function isProjectRelativePath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)
  ) {
    return false;
  }
  return normalized.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function validateSpec(value: unknown): VideoSpec {
  if (!specValidator(value)) {
    throw validationError('Video spec', specValidator);
  }

  const errors: string[] = [];
  const sceneIds = new Set<string>();
  for (const [index, scene] of value.scenes.entries()) {
    if (sceneIds.has(scene.id)) {
      errors.push(`scene IDs must be unique; duplicate ${scene.id}`);
    }
    sceneIds.add(scene.id);

    if (!isProjectRelativePath(scene.compositionFile)) {
      errors.push(`/scenes/${index}/compositionFile must be a project-relative path`);
    }

    if (
      scene.heroFrameSec !== undefined &&
      scene.actualStartSec !== null &&
      scene.actualEndSec !== null &&
      (scene.heroFrameSec < scene.actualStartSec || scene.heroFrameSec >= scene.actualEndSec)
    ) {
      errors.push(`/scenes/${index}/heroFrameSec must be within actualStartSec and actualEndSec`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Video spec validation failed: ${errors.join('; ')}`);
  }
  return value;
}

export function validateQaReport(value: unknown): void {
  if (!qaReportValidator(value)) {
    throw validationError('QA report', qaReportValidator);
  }
}
