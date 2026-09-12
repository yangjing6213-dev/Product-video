// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateInput, validateSpec, type VideoSpec } from '../../src/contracts.ts';
import { copyDraftFromVideoSpec } from '../../src/quality/copy.ts';
import { resolveGeneratorInput } from '../../src/quality/policy.ts';
import { validProductInput, validVideoSpec } from '../fixtures/input.ts';

function workflowSpec(): VideoSpec {
  const spec: any = structuredClone(validVideoSpec);
  spec.brand.presentation = 'workflow';
  spec.audio.deliveryMode = 'natural';
  spec.scenes[0].workflow = { layout: 'horizontal-3', cards: ['article', 'judgment', 'plan'].map((id, index) => ({
    id, previewAssetId: 'hero-shot', title: ['文章', '关键判断', '画面清单'][index],
    sentence: ['收藏不等于学会', '合上资料，自己试一次', '先确认配图方案'][index],
    fields: [{ label: '重点', value: ['保存入口', '检验理解', '确认方案'][index] }],
    focusFrame: 10 + index * 35, completeFrame: 40 + index * 35,
  })) };
  return spec;
}

test('new task defaults inherit workflow presentation and deliberate vocal delivery without mutating a supplied historical brief', () => {
  const original: any = structuredClone(validProductInput);
  const resolved: any = resolveGeneratorInput(original);
  assert.equal(resolved.brand.presentation, 'workflow');
  assert.equal(resolved.brand.visualStyle, 'editorial-v2');
  assert.equal(resolved.audio.deliveryMode, 'natural');
  assert.equal(original.brand.presentation, undefined);
  assert.equal(original.brand.visualStyle, undefined);
  assert.equal(original.audio.deliveryMode, undefined);
  assert.doesNotThrow(() => validateInput(resolved));
  assert.equal(resolved.product.cta.url, 'https://www.enhe-tech.com.cn');
});

test('visual style is explicit, versioned and optional in historical specifications', () => {
  const spec: any = workflowSpec();
  assert.doesNotThrow(() => validateSpec(spec));
  spec.brand.visualStyle = 'editorial-v1';
  assert.doesNotThrow(() => validateSpec(spec));
  spec.brand.visualStyle = 'random-latest';
  assert.throws(() => validateSpec(spec), /visualStyle/);
});

test('schema permits the three explicit workflow layouts and rejects unknown delivery modes and loose card data', () => {
  const spec: any = workflowSpec();
  assert.doesNotThrow(() => validateSpec(spec));
  spec.audio.deliveryMode = 'celebrity-clone';
  assert.throws(() => validateSpec(spec), /deliveryMode/);
  spec.audio.deliveryMode = 'presenter';
  spec.scenes[0].workflow.cards[0].placeholder = true;
  assert.throws(() => validateSpec(spec), /additional properties/);
  delete spec.scenes[0].workflow.cards[0].placeholder;
  spec.scenes[0].workflow.layout = 'freeform-graph';
  assert.throws(() => validateSpec(spec), /layout/);
});

test('visible workflow content cannot escape the existing full-copy approval contract', () => {
  const spec: any = workflowSpec();
  assert.throws(() => copyDraftFromVideoSpec(spec, 'flow-v1'), /workflow.*copy|copy.*workflow/i);
  const words = spec.scenes[0].workflow.cards.flatMap((card: any) => [card.title, card.sentence, ...card.fields.map((field: any) => `${field.label}：${field.value}`)]);
  spec.scenes[0].onScreenText.push(...words);
  const copy = copyDraftFromVideoSpec(spec, 'flow-v1');
  assert.ok(words.every((word: string) => copy.onScreenText.includes(word)));
  spec.scenes[0].workflow.cards[0].sentence = '未经确认的承诺';
  assert.throws(() => copyDraftFromVideoSpec(spec, 'flow-v1'), /workflow.*copy|copy.*workflow/i);
});

test('workflow schema enforces the exact card count for each supported layout', () => {
  for (const layout of ['vertical-3', 'horizontal-3', 'feature-row-4']) {
    const spec = workflowSpec();
    const workflow = spec.scenes[0]!.workflow!;
    workflow.layout = layout as typeof workflow.layout;
    if (layout === 'feature-row-4') workflow.cards.push({ ...workflow.cards[0]!, id: 'fourth' });
    assert.doesNotThrow(() => validateSpec(spec));
    if (layout === 'feature-row-4') workflow.cards.pop();
    else workflow.cards.push({ ...workflow.cards[0]!, id: 'extra' });
    assert.throws(() => validateSpec(spec), /cards/);
  }
});
