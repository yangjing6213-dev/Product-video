import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { initialize, inputFor } from '../../src/pipeline/project.ts';
import { validProductInput } from '../fixtures/input.ts';
import { validVideoSpec } from '../fixtures/input.ts';
import { sourceChecks } from '../../src/pipeline/qa.ts';
import { copyDraftFromVideoSpec } from '../../src/quality/copy.ts';

async function fixture() {
  const base = path.resolve('.cache/generator-quality-003/tests');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, '默认 中文 '));
  await mkdir(path.join(root, 'assets/brand/enhe/ip'), { recursive: true });
  await writeFile(path.join(root, 'assets/brand/enhe/ip/catalog.json'), JSON.stringify({ schemaVersion: '1.0', libraryVersion: 'test-v1', assets: [] }));
  const input: any = { ...structuredClone(validProductInput), assets: [], brandLibrary: { selections: [], omissionReason: 'Fixture has no brand character.' } };
  return { root, input, file: path.join(root, 'brief.json') };
}

test('normal init fills the ENHE website CTA and ordinary audience without copying the source URL', async () => {
  const { root, input, file } = await fixture();
  input.product.url = 'https://github.com/example/real-source';
  delete input.product.cta; delete input.product.targetAudience; delete input.audio.voice;
  await writeFile(file, JSON.stringify(input));
  const project = await initialize(file, root);
  const actual: any = await inputFor(project);
  assert.equal(actual.product.cta.url, 'https://www.enhe-tech.com.cn');
  assert.equal(actual.product.url, input.product.url);
  assert.deepEqual(actual.product.targetAudience, ['普通 AI 用户']);
  assert.equal(actual.generatorPolicy.authorEnding, 'contacts-secondary');
  assert.equal(actual.generatorPolicy.voiceAcceptance, 'REQUIRED');
  assert.equal(actual.audio.voice, '');
  assert.equal(actual.captions.style, 'transparent');
});

test('normal new init replaces an old repository CTA but keeps source facts and example identity', async () => {
  const { root, input, file } = await fixture();
  input.product.url = 'https://github.com/example/product';
  input.product.cta = { label: '去GitHub查看完整方案', url: input.product.url };
  input.product.form = 'Codex Skill';
  input.product.prerequisites = ['需要在支持 Skill 的 Codex 中使用'];
  input.product.example = { name: '案例项目', explanation: '仅为演示素材，不是正在推广的产品' };
  await writeFile(file, JSON.stringify(input));
  const actual: any = await inputFor(await initialize(file, root));
  assert.equal(actual.product.cta.url, 'https://www.enhe-tech.com.cn');
  assert.equal(actual.product.name, input.product.name);
  assert.equal(actual.product.example.name, '案例项目');
  assert.deepEqual(actual.product.prerequisites, input.product.prerequisites);
});

test('normal new init accepts a short portrait variant without center-cropping a horizontal contract', async () => {
  const { root, input, file } = await fixture();
  input.output = { ...input.output, width: 1080, height: 1920, targetDurationSec: 10 };
  await writeFile(file, JSON.stringify(input));
  const actual = await inputFor(await initialize(file, root));
  assert.equal(actual.output.width, 1080);
  assert.equal(actual.output.height, 1920);
  assert.equal(actual.output.targetDurationSec, 10);
});

test('already initialized historical inputs keep their exact policy and CTA on resume', async () => {
  const { root, input, file } = await fixture();
  const project = path.join(root, 'projects', input.projectId);
  await mkdir(path.join(project, 'input'), { recursive: true });
  delete input.brandLibrary;
  const original = JSON.stringify(input, null, 2);
  await writeFile(path.join(project, 'input/product-input.json'), original);
  await writeFile(file, original);
  assert.equal(await initialize(file, root), project);
  assert.equal(await readFile(path.join(project, 'input/product-input.json'), 'utf8'), original);
  assert.equal((await inputFor(project)).product.cta.url, input.product.cta.url);
});

test('source QA rejects an old author/GitHub ending even when a new input has the website default', async () => {
  const { root, input, file } = await fixture();
  await writeFile(file, JSON.stringify(input));
  const project = await initialize(file, root);
  const canonical = await inputFor(project);
  const spec = { ...structuredClone(validVideoSpec), ...canonical, scenes: structuredClone(validVideoSpec.scenes) };
  spec.scenes.at(-1)!.onScreenText = ['关于作者', 'GitHub', '微信', 'name@example.com'];
  spec.narrative.cta = '到GitHub查看完整方案';
  await writeFile(path.join(project, 'DESIGN.md'), input.brand.colors.join(' '));
  await writeFile(path.join(project, 'index.html'), '<main>关于作者 GitHub name@example.com</main>');
  const checks = await sourceChecks(project, spec);
  assert.equal(checks.find(c => c.id === 'generator.cta')?.status, 'FAIL');
  assert.equal(checks.find(c => c.id === 'generator.ending')?.status, 'FAIL');
});

test('render media checks accept an intentional 10-second current portrait sample', async () => {
  const { root, input, file } = await fixture();
  input.output = { ...input.output, width: 1080, height: 1920, targetDurationSec: 10 };
  await writeFile(file, JSON.stringify(input));
  const canonical = await inputFor(await initialize(file, root));
  const spec = { ...structuredClone(validVideoSpec), ...canonical };
  const { checkMedia } = await import('../../src/qa/checks.ts');
  const checks = checkMedia({format:{duration:10},streams:[{codec_type:'video',codec_name:'h264',width:1080,height:1920,avg_frame_rate:'30/1'}]},spec);
  assert.equal(checks.find(c=>c.id==='media.duration')?.status,'PASS');
});

test('new tasks freeze the complete local author contacts as secondary reviewed screen text', async () => {
  const { root, input, file } = await fixture();
  const contacts = { name: '测试作者', items: [
    { label: 'GitHub', value: 'example-author', url: 'https://github.com/example-author' },
    { label: 'X / Twitter', value: '@example_author', url: 'https://x.com/example_author' },
    { label: '网站', value: 'www.enhe-tech.com.cn', url: 'https://www.enhe-tech.com.cn' },
    { label: '微信', value: 'test-wechat' }, { label: '邮箱', value: 'author@example.com' },
  ] };
  await mkdir(path.join(root, 'assets/brand/enhe/author'), { recursive: true });
  const profile = path.join(root, 'assets/brand/enhe/author/contact-profile.json');
  await writeFile(profile, JSON.stringify(contacts));
  await writeFile(file, JSON.stringify(input));
  const project = await initialize(file, root);
  const canonical = await inputFor(project);
  assert.deepEqual(canonical.authorContacts, contacts);
  const spec = { ...structuredClone(validVideoSpec), ...canonical };
  spec.narrative.cta = '访问恩禾官网，了解产品与使用方式。';
  spec.scenes.at(-1)!.onScreenText = [spec.narrative.cta, 'www.enhe-tech.com.cn'];
  const draft = copyDraftFromVideoSpec(spec, 'v2');
  for (const item of contacts.items) assert.ok(draft.onScreenText.some(line => line.includes(item.label) && line.includes(item.value)), item.label);
  const { checkGeneratorSpec } = await import('../../src/quality/policy.ts');
  const checks = checkGeneratorSpec(spec);
  assert.equal(checks.find(c => c.id === 'generator.cta')?.status, 'PASS');
  assert.equal(checks.find(c => c.id === 'generator.ending')?.status, 'PASS');
  await writeFile(profile, JSON.stringify({ name: 'Changed', items: [{ label: '邮箱', value: 'changed@example.com' }] }));
  await initialize(file, root);
  assert.deepEqual((await inputFor(project)).authorContacts, contacts, 'resume must retain the frozen original contacts');
});

test('a separate silent poster preserves the preceding homepage CTA without allowing a missing CTA', async () => {
  const { ACTIVE_GENERATOR_POLICY, checkGeneratorSpec } = await import('../../src/quality/policy.ts');
  const spec = structuredClone(validVideoSpec);
  spec.generatorPolicy = ACTIVE_GENERATOR_POLICY;
  spec.product.cta = { label: ACTIVE_GENERATOR_POLICY.marketing.screenAction, url: ACTIVE_GENERATOR_POLICY.marketing.url };
  spec.narrative.cta = spec.product.cta.label;
  spec.scenes.at(-1)!.onScreenText = [spec.product.cta.label, ACTIVE_GENERATOR_POLICY.marketing.displayDomain];
  spec.scenes.push({ ...spec.scenes.at(-1)!, id: 'poster', authorPosterAssetId: 'author-poster', voiceover: '', caption: '', onScreenText: ['关于作者', 'GitHub', '微信'] });
  const status = () => checkGeneratorSpec(spec).find(c => c.id === 'generator.cta')!.status;
  assert.equal(status(), 'PASS');
  spec.scenes.at(-2)!.onScreenText = ['缺失官网'];
  assert.equal(status(), 'FAIL');
  spec.scenes.at(-2)!.onScreenText = [spec.product.cta.label, ACTIVE_GENERATOR_POLICY.marketing.displayDomain, '去 GitHub'];
  assert.equal(status(), 'FAIL');
  spec.scenes.at(-2)!.onScreenText.pop();
  spec.scenes.at(-1)!.voiceover = '未经审核的作者旁白';
  assert.equal(status(), 'FAIL');
});

test('partial and duplicate contacts cannot masquerade as the complete secondary ending', async () => {
  const { validateInput } = await import('../../src/contracts.ts');
  const { ACTIVE_GENERATOR_POLICY, checkGeneratorSpec, resolveGeneratorInput } = await import('../../src/quality/policy.ts');
  const contacts = { name: 'Fixture author', items: [
    { label: 'GitHub', value: 'example' }, { label: 'X / Twitter', value: '@example' },
    { label: '网站', value: 'example.com' }, { label: '微信', value: 'example-wechat' }, { label: '邮箱', value: 'test@example.com' },
  ] };
  const input = { ...structuredClone(validProductInput), generatorPolicy: ACTIVE_GENERATOR_POLICY, authorContacts: contacts };
  validateInput(input);
  const partial = { ...input, authorContacts: { ...contacts, items: contacts.items.slice(-1) } };
  assert.throws(() => validateInput(partial));
  assert.throws(() => resolveGeneratorInput(partial, contacts), /complete authorized local profile/);
  assert.throws(() => validateInput({ ...input, authorContacts: { ...contacts, items: Array(5).fill(contacts.items[0]) } }));
  const spec = { ...structuredClone(validVideoSpec), ...partial };
  assert.equal(checkGeneratorSpec(spec).find(check => check.id === 'generator.author-contacts')?.status, 'FAIL');
});

test('an explicitly labeled demonstration project counts as a product example', async () => {
  const { ACTIVE_GENERATOR_POLICY, checkGeneratorSpec } = await import('../../src/quality/policy.ts');
  const spec = { ...structuredClone(validVideoSpec), generatorPolicy: ACTIVE_GENERATOR_POLICY };
  spec.product.example = { name: 'Demo Brand', explanation: 'A distinct demonstration project' };
  spec.scenes[0].onScreenText = [spec.product.name, '演示项目：Demo Brand'];
  assert.equal(checkGeneratorSpec(spec).find(check => check.id === 'generator.product-identity')?.status, 'PASS');
  spec.scenes[0].onScreenText = [spec.product.name, 'Demo Brand'];
  assert.equal(checkGeneratorSpec(spec).find(check => check.id === 'generator.product-identity')?.status, 'FAIL');
});

test('historical declared brand-signoff policy can resume unchanged but fails the current quality gate', async () => {
  const { root, input, file } = await fixture();
  const { ACTIVE_GENERATOR_POLICY, checkGeneratorSpec } = await import('../../src/quality/policy.ts');
  input.generatorPolicy = { ...ACTIVE_GENERATOR_POLICY, authorEnding: 'brand-signoff', rulesSha256: '0'.repeat(64) };
  delete input.brandLibrary;
  const project = path.join(root, 'projects', input.projectId);
  await mkdir(path.join(project, 'input'), { recursive: true });
  const original = JSON.stringify(input);
  await writeFile(path.join(project, 'input/product-input.json'), original);
  await writeFile(file, original);
  assert.equal(await initialize(file, root), project);
  assert.equal(await readFile(path.join(project, 'input/product-input.json'), 'utf8'), original);
  assert.equal(checkGeneratorSpec({ ...structuredClone(validVideoSpec), ...input }).find(check => check.id === 'generator.policy')?.status, 'FAIL');
});
