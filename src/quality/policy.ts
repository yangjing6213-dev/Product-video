// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { digest } from '../pipeline/stage-state.ts';
import { isDeepStrictEqual } from 'node:util';
import type { CheckResult, VideoSpec } from '../contracts.ts';

export interface GeneratorPolicy {
  version: string;
  audience: 'ordinary-ai-users';
  marketing: { brand: string; url: string; displayDomain: string; screenAction: string; spokenAction: string };
  authorEnding: 'brand-signoff' | 'contacts-secondary';
  voiceAcceptance: 'REQUIRED';
  subtitles: 'transparent';
  ipCharacters: 'off';
  rulesSha256: string;
}

const policy = (file: string): GeneratorPolicy => {
  const bytes = readFileSync(new URL(`../../recipes/policies/${file}`, import.meta.url));
  return { ...JSON.parse(bytes.toString('utf8')), rulesSha256: digest(bytes) } as GeneratorPolicy;
};
export const LEGACY_GENERATOR_POLICY_V1 = policy('generator-quality.v1.json');
export const LEGACY_GENERATOR_POLICY_V2 = policy('generator-quality.v2.json');
export const ACTIVE_GENERATOR_POLICY = policy('generator-quality.v3.json');

export function trustedGeneratorPolicy(value: unknown): GeneratorPolicy | undefined {
  return [ACTIVE_GENERATOR_POLICY, LEGACY_GENERATOR_POLICY_V2, LEGACY_GENERATOR_POLICY_V1].find(item => isDeepStrictEqual(value, item));
}

export function isActiveGeneratorPolicy(value: unknown): value is GeneratorPolicy {
  return isDeepStrictEqual(value, ACTIVE_GENERATOR_POLICY);
}

/** Applied only to a new task. Stored historical inputs are never implicitly upgraded. */
export function resolveGeneratorInput(value: unknown, authorContacts?: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const input = structuredClone(value) as Record<string, any>;
  if (!input.product || !input.audio || !input.captions) return input;
  if (input.generatorPolicy && !isDeepStrictEqual(input.generatorPolicy, ACTIVE_GENERATOR_POLICY)) {
    throw new Error('New tasks require the active generator policy; preserve old plans and create an explicit new variant');
  }
  input.generatorPolicy = structuredClone(ACTIVE_GENERATOR_POLICY);
  if (input.brand) input.brand.presentation ??= 'workflow';
  if (input.brand) input.brand.visualStyle ??= 'editorial-v2';
  input.audio.deliveryMode ??= 'natural';
  if (authorContacts !== undefined) {
    if (input.authorContacts !== undefined && !isDeepStrictEqual(input.authorContacts, authorContacts)) throw new Error('Author contacts differ from the complete authorized local profile; preserve the existing profile and explicitly review a new contact variant');
    input.authorContacts = structuredClone(authorContacts);
  }
  input.product.targetAudience ??= ['普通 AI 用户'];
  if (input.product.targetAudience.length === 0) input.product.targetAudience = ['普通 AI 用户'];
  input.product.cta = { label: ACTIVE_GENERATOR_POLICY.marketing.screenAction, url: ACTIVE_GENERATOR_POLICY.marketing.url };
  input.audio.voice ??= '';
  input.captions.style = ACTIVE_GENERATOR_POLICY.subtitles;
  return input;
}

/** Logical/source checks are evidence of consistency, never of visual or vocal quality. */
export function checkGeneratorSpec(spec: VideoSpec, expectedPolicy: GeneratorPolicy = ACTIVE_GENERATOR_POLICY): CheckResult[] {
  if (!spec.generatorPolicy) return [];
  const policy = spec.generatorPolicy;
  const expected = trustedGeneratorPolicy(expectedPolicy);
  const marketing = expected?.marketing ?? ACTIVE_GENERATOR_POLICY.marketing;
  const check = (id: string, pass: boolean, message: string): CheckResult => ({ id: `generator.${id}`, status: pass ? 'PASS' : 'FAIL', message });
  const screens = spec.scenes.flatMap(scene => scene.onScreenText).join('\n');
  const last = spec.scenes.at(-1);
  const signoff = last?.authorPosterAssetId && !last.voiceover.trim() && !last.caption?.trim() ? spec.scenes.at(-2) : last;
  const ending = signoff?.onScreenText.join('\n') ?? '';
  const narration = spec.scenes.map(scene => scene.voiceover).filter(Boolean);
  const oldOutlet = /github|twitter|@[a-z0-9_]+|微信|邮箱|关于作者|作者与联系|作者履历/i;
  const cta = [spec.narrative.cta, spec.product.cta.label, ending].join('\n');
  return [
    check('policy', Boolean(expected && isDeepStrictEqual(policy, expected)), 'The declared generator policy and full rules hash must match a trusted expected policy.'),
    check('cta', spec.product.cta.url === marketing.url && cta.includes('恩禾官网') && ending.includes(marketing.displayDomain) && !oldOutlet.test(cta), 'Marketing URL, final screen domain and authored CTA must use the ENHE homepage; product source URLs remain internal facts.'),
    check('spoken-cta', narration.length === 0 || ((narration.at(-1)?.endsWith(marketing.spokenAction) ?? false) && !/github|仓库|https?:\/\/|www\./i.test(narration.join(''))), 'The final spoken segment must end with the complete policy-approved ENHE homepage action; never read the source repository or spell the website address.'),
    check('ending', !oldOutlet.test(ending), 'The product signoff is the ENHE homepage; authorized author contacts follow separately in their block or the selected silent poster.'),
    check('author-contacts', Boolean(spec.authorContacts?.name && spec.authorContacts.items.length === 5 && ['GitHub', 'X / Twitter', '网站', '微信', '邮箱'].every(label => spec.authorContacts!.items.filter(item => item.label === label && item.value.trim()).length === 1)), 'The current ending policy retains five distinct authorized contacts: GitHub, X / Twitter, website, WeChat and email.'),
    check('subtitles', spec.captions.style === 'transparent', 'Captions have no background; actual rendered style is verified separately.'),
    check('product-identity', screens.includes(spec.product.name) && (!spec.product.example || screens.includes(spec.product.example.name) && /示例|案例|演示项目|以.{1,30}为例/.test(screens)), 'The promoted product is named; a different demonstration project is explicitly identified as an example.'),
    check('prerequisites', (spec.product.prerequisites ?? []).every(text => screens.includes(text) || narration.join('').includes(text)), 'Required usage prerequisites must be stated visibly or audibly, without pretending to be a one-click web tool.'),
  ];
}
