// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { resolveGeneratorInput } from '../../src/quality/policy.ts';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import type { VideoSpec } from '../../src/contracts.ts';
import { initialize } from '../../src/pipeline/project.ts';
import { runProject } from '../../src/pipeline/run.ts';
import {
  ACTIVE_GENERATOR_POLICY,
  LEGACY_GENERATOR_POLICY_V1,
  checkGeneratorSpec,
  trustedGeneratorPolicy,
} from '../../src/quality/policy.ts';
import { validProductInput, validVideoSpec } from '../fixtures/input.ts';

const NEW_SPOKEN_ACTION = '需要更多 AI 工具，进入恩禾官网搜索，让每一个普通人，都能轻松驾驭AI，把想法变成现实，把效率变成价值。';
const OLD_SPOKEN_ACTION = '更多 AI 工具和使用方法，到恩禾官网看看。';

const contacts = {
  name: 'Fixture Author',
  items: [
    { label: 'GitHub', value: 'fixture-github' },
    { label: 'X / Twitter', value: '@fixture' },
    { label: '网站', value: 'fixture.example' },
    { label: '微信', value: 'fixture-wechat' },
    { label: '邮箱', value: 'fixture@example.com' },
  ],
};

function generatorSpec(): VideoSpec {
  const spec = structuredClone(validVideoSpec);
  spec.generatorPolicy = structuredClone(ACTIVE_GENERATOR_POLICY);
  spec.authorContacts = structuredClone(contacts);
  spec.product.cta = { label: ACTIVE_GENERATOR_POLICY.marketing.screenAction, url: ACTIVE_GENERATOR_POLICY.marketing.url };
  spec.narrative.cta = ACTIVE_GENERATOR_POLICY.marketing.screenAction;
  spec.captions.style = ACTIVE_GENERATOR_POLICY.subtitles;
  spec.scenes[0]!.onScreenText = [spec.product.name];
  spec.scenes.at(-1)!.onScreenText = [ACTIVE_GENERATOR_POLICY.marketing.screenAction, ACTIVE_GENERATOR_POLICY.marketing.displayDomain];
  spec.scenes.at(-1)!.voiceover = NEW_SPOKEN_ACTION;
  return spec;
}

test('active v3 preserves the immutable trusted v1 policy and requires the complete spoken action at the ending', () => {
  assert.equal(ACTIVE_GENERATOR_POLICY.version, 'EPVS-GENERATOR-QUALITY-003.v3');
  assert.equal(ACTIVE_GENERATOR_POLICY.marketing.spokenAction, NEW_SPOKEN_ACTION);
  assert.equal(LEGACY_GENERATOR_POLICY_V1.version, 'EPVS-GENERATOR-QUALITY-003.v1');
  assert.equal(LEGACY_GENERATOR_POLICY_V1.marketing.spokenAction, OLD_SPOKEN_ACTION);
  assert.equal(LEGACY_GENERATOR_POLICY_V1.rulesSha256, '1b1c6601bf9366185decba8b1e2ee6a3fbc6913d1e9e6767c161a76699634631');
  assert.deepEqual(trustedGeneratorPolicy(LEGACY_GENERATOR_POLICY_V1), LEGACY_GENERATOR_POLICY_V1);

  const spec = generatorSpec();
  assert.equal(checkGeneratorSpec(spec).find(check => check.id === 'generator.spoken-cta')?.status, 'PASS');
  spec.scenes.at(-1)!.voiceover = `前面保留一句。${NEW_SPOKEN_ACTION}`;
  assert.equal(checkGeneratorSpec(spec).find(check => check.id === 'generator.spoken-cta')?.status, 'PASS');
  spec.scenes.at(-1)!.voiceover = '需要更多 AI 工具，到恩禾官网看看。';
  assert.equal(checkGeneratorSpec(spec).find(check => check.id === 'generator.spoken-cta')?.status, 'FAIL');
});

test('trusted v1 can satisfy its own historical checks but cannot satisfy the current release policy', () => {
  const spec = generatorSpec();
  spec.generatorPolicy = structuredClone(LEGACY_GENERATOR_POLICY_V1);
  spec.scenes.at(-1)!.voiceover = OLD_SPOKEN_ACTION;
  assert.equal(checkGeneratorSpec(spec, LEGACY_GENERATOR_POLICY_V1).find(check => check.id === 'generator.policy')?.status, 'PASS');
  assert.equal(checkGeneratorSpec(spec, LEGACY_GENERATOR_POLICY_V1).find(check => check.id === 'generator.spoken-cta')?.status, 'PASS');
  assert.equal(checkGeneratorSpec(spec).find(check => check.id === 'generator.policy')?.status, 'FAIL');

  assert.equal(trustedGeneratorPolicy({ ...LEGACY_GENERATOR_POLICY_V1, rulesSha256: '0'.repeat(64) }), undefined);
  assert.equal(trustedGeneratorPolicy({ ...ACTIVE_GENERATOR_POLICY, version: 'unknown-policy' }), undefined);
});

test('an existing trusted v1 input without presenter defaults resumes byte-for-byte instead of being upgraded', async (t) => {
  const base = path.resolve('.cache/generator-quality-003/policy-migration');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'v1-resume-'));
  t.after(async () => {
    assert.equal(path.dirname(root), base);
    assert.match(path.basename(root), /^v1-resume-/);
    await rm(root, { recursive: true });
  });
  await mkdir(path.join(root, 'assets/brand/enhe/ip'), { recursive: true });
  await writeFile(path.join(root, 'assets/brand/enhe/ip/catalog.json'), JSON.stringify({ schemaVersion: '1.0', libraryVersion: 'fixture-v1', assets: [] }));

  const frozen: any = structuredClone(validProductInput);
  frozen.projectId = 'trusted-v1-fieldless';
  frozen.assets = [];
  frozen.brandLibrary = { selections: [], omissionReason: 'Synthetic fixture has no brand character.' };
  frozen.generatorPolicy = structuredClone(LEGACY_GENERATOR_POLICY_V1);
  delete frozen.brand.presentation;
  delete frozen.audio.deliveryMode;
  const original = `${JSON.stringify(frozen, null, 2)}\n`;
  const project = path.join(root, 'projects', frozen.projectId);
  await mkdir(path.join(project, 'input'), { recursive: true });
  await writeFile(path.join(project, 'input/product-input.json'), original);
  const brief = path.join(root, 'brief.json');
  await writeFile(brief, original);

  assert.equal(await initialize(brief, root), project);
  assert.equal(await readFile(path.join(project, 'input/product-input.json'), 'utf8'), original);
});

test('initialize rejects an existing input with an unknown or modified generator policy', async (t) => {
  const base = path.resolve('.cache/generator-quality-003/policy-migration');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'unknown-policy-'));
  t.after(async () => {
    assert.equal(path.dirname(root), base);
    assert.match(path.basename(root), /^unknown-policy-/);
    await rm(root, { recursive: true });
  });
  const frozen: any = structuredClone(validProductInput);
  frozen.projectId = 'unknown-policy';
  frozen.assets = [];
  frozen.generatorPolicy = { ...ACTIVE_GENERATOR_POLICY, rulesSha256: '0'.repeat(64) };
  const original = `${JSON.stringify(frozen, null, 2)}\n`;
  const project = path.join(root, 'projects', frozen.projectId);
  await mkdir(path.join(project, 'input'), { recursive: true });
  await writeFile(path.join(project, 'input/product-input.json'), original);
  const brief = path.join(root, 'brief.json');
  await writeFile(brief, original);

  await assert.rejects(initialize(brief, root), /unknown|modified|policy/i);
  assert.equal(await readFile(path.join(project, 'input/product-input.json'), 'utf8'), original);
});

test('an existing active-policy task without visualStyle remains byte-identical on init', async (t) => {
  const base = path.resolve('.cache/generator-quality-003/policy-migration');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'v2-visual-'));
  t.after(async () => { assert.equal(path.dirname(root), base); assert.match(path.basename(root), /^v2-visual-/); await rm(root, { recursive: true }); });
  const input: any = resolveGeneratorInput(structuredClone(validProductInput));
  input.projectId = 'active-without-visual-style';
  input.assets = [];
  delete input.brandLibrary;
  delete input.brand.visualStyle;
  const project = path.join(root, 'projects', input.projectId);
  await mkdir(path.join(project, 'input'), { recursive: true });
  const original = `${JSON.stringify(input, null, 2)}\n`;
  const brief = path.join(root, 'brief.json');
  await writeFile(brief, original);
  await writeFile(path.join(project, 'input/product-input.json'), original);
  assert.equal(await initialize(brief, root), project);
  assert.equal(await readFile(path.join(project, 'input/product-input.json'), 'utf8'), original);
});

test('a trusted v1 run without its existing frozen plan is rejected before preflight work', async (t) => {
  const base = path.resolve('.cache/generator-quality-003/policy-migration');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'v1-planless-'));
  t.after(async () => {
    assert.equal(path.dirname(root), base);
    assert.match(path.basename(root), /^v1-planless-/);
    await rm(root, { recursive: true });
  });
  const input: any = structuredClone(validProductInput);
  input.projectId = 'trusted-v1-planless';
  input.product.url = '';
  input.assets = [];
  input.generatorPolicy = structuredClone(LEGACY_GENERATOR_POLICY_V1);
  delete input.brandLibrary;
  delete input.brand.presentation;
  delete input.audio.deliveryMode;
  const project = path.join(root, 'projects', input.projectId);
  await mkdir(path.join(project, 'input'), { recursive: true });
  await writeFile(path.join(project, 'input/product-input.json'), `${JSON.stringify(input, null, 2)}\n`);

  await assert.rejects(runProject(project, true, true, 'draft'), /trusted v1.*existing.*plan/i);
  await assert.rejects(access(path.join(project, 'reports/preflight.json')), { code: 'ENOENT' });
});
