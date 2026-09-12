// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSpec, type Asset, type Scene, type VideoSpec } from '../../src/contracts.ts';
import { composeVideo } from '../../src/quality/composition.ts';
import { workflowText, type SceneWorkflow } from '../../src/quality/workflow.ts';
import type { MotionAsset, SceneAction } from '../../src/quality/motion.ts';
import { validVideoSpec } from '../fixtures/input.ts';

type LayeredAsset = Asset & MotionAsset;
type ActionScene = Scene & { action: SceneAction };
type ActionVideoSpec = VideoSpec & {
  assets: LayeredAsset[];
  scenes: ActionScene[];
  authorContacts?: { name: string; items: Array<{ label: string; value: string; url?: string }> };
};

function sampleSpec(width: 1920 | 1080 = 1920): ActionVideoSpec {
  const spec = structuredClone(validVideoSpec) as unknown as ActionVideoSpec;
  spec.projectId = 'generic-product-motion';
  spec.product = {
    ...spec.product,
    name: 'BrandLoom',
    oneLiner: '让一套真实素材形成一致的品牌表达',
    form: 'Codex Skill',
    prerequisites: ['在支持 Skill 的 Codex 中使用'],
    example: { name: 'ENHE Product Video', explanation: '仅作为真实示例项目展示' },
    cta: { label: '旧来源链接不得进入成片', url: 'https://github.com/example/source' },
  };
  spec.generatorPolicy = {
    version: 'EPVS-GENERATOR-QUALITY-003.v1', audience: 'ordinary-ai-users',
    marketing: {
      brand: '恩禾 ENHE AI', url: 'https://www.enhe-tech.com.cn', displayDomain: 'www.enhe-tech.com.cn',
      screenAction: '访问恩禾官网，了解产品与使用方式。', spokenAction: '更多 AI 工具和使用方法，到恩禾官网看看。',
    },
    authorEnding: 'contacts-secondary', voiceAcceptance: 'REQUIRED', subtitles: 'transparent', ipCharacters: 'off', rulesSha256: 'a'.repeat(64),
  } as ActionVideoSpec['generatorPolicy'];
  spec.authorContacts = {
    name: 'Example Author',
    items: [
      { label: 'GitHub', value: 'example-dev' },
      { label: 'X / Twitter', value: '@example_ai' },
      { label: '网站', value: 'example.test', url: 'https://example.test' },
      { label: '微信', value: 'example-wechat' },
      { label: '邮箱', value: 'author@example.test' },
    ],
  };
  spec.output = { ...spec.output, width, height: width === 1920 ? 1080 : 1920, targetDurationSec: 12 };
  spec.assets = [
    { id: spec.brand.logoAssetId, type: 'logo', path: 'assets/brand/enhe-logo.png', sourceUrl: 'owned-brand-library', license: 'owned', required: true, fallbackAssetId: null },
    {
      id: 'cover-base', type: 'image', path: 'assets/cover/base-v1.png', sourceUrl: 'case-manifest-v1.json', license: 'owned', required: true, fallbackAssetId: null,
      width: 1774, height: 887,
      layers: [
        { id: 'title', assetId: 'cover-title', bounds: [132, 250, 1035, 512], role: 'title' },
        { id: 'logo', assetId: 'cover-logo', bounds: [121, 90, 362, 135], role: 'logo' },
      ],
    },
    { id: 'cover-title', type: 'image', path: 'assets/cover/title-tight.png', sourceUrl: 'case-manifest-v1.json', license: 'owned', required: true, fallbackAssetId: null },
    { id: 'cover-logo', type: 'logo', path: 'assets/cover/logo-tight.png', sourceUrl: 'case-manifest-v1.json', license: 'owned', required: true, fallbackAssetId: null },
  ];
  const baseAction: SceneAction = {
    intent: '看清真实底图、标题和标志的组成关系', primitive: 'layer-assemble',
    subject: { assetId: 'cover-base', layerIds: ['title', 'logo'] },
    beforeState: '真实摄影底图独立可见', afterState: '真实标题和标志回到批准位置',
    startFrame: 15, endFrame: 75, holdFrames: 45, syncCueId: 'cue-0', direction: 'left',
  };
  spec.scenes = [
    {
      ...spec.scenes[0]!, id: 'proof', goal: baseAction.intent, plannedDurationSec: 6, actualStartSec: 0, actualEndSec: 6,
      onScreenText: ['一张底图，分开检查标题与标志'], assetRefs: ['cover-base', 'cover-title', 'cover-logo'], action: baseAction,
    },
    {
      ...spec.scenes[1]!, id: 'signoff', goal: '保留真实成果并给出唯一官网入口', plannedDurationSec: 6, actualStartSec: 6, actualEndSec: 12,
      onScreenText: ['完成后的真实封面', '访问恩禾官网，了解产品与使用方式。', 'www.enhe-tech.com.cn'], assetRefs: ['cover-base'],
      action: { ...baseAction, primitive: 'reading-hold', subject: { assetId: 'cover-base' }, startFrame: 0, endFrame: 30, holdFrames: 120, syncCueId: 'cue-1' },
    },
  ];
  return spec;
}

const narration = {
  path: 'input/narration.wav',
  cues: [
    { id: 'cue-0', sceneId: 'proof', text: '标题和标志，分别检查。', start: 0.5, end: 3.4 },
    { id: 'cue-1', sceneId: 'signoff', text: '更多内容，到恩禾官网看看。', start: 7, end: 10.5 },
  ],
};

test('composition renders real layered evidence, distinct product/example identity and a primary website CTA', () => {
  const html = composeVideo(sampleSpec(), {
    gsapPath: 'assets/gsap.min.js',
    fonts: [{ family: 'Source Han Sans CN', path: 'assets/SourceHanSansCN-Regular.otf', weight: 400 }],
    narration,
  });

  assert.match(html, /data-composition-id="main" data-start="0" data-duration="12" data-width="1920" data-height="1080"/);
  assert.match(html, /class="composition landscape"/);
  assert.match(html, /<section id="proof-clip" class="clip scene-clip" data-start="0" data-duration="6" data-track-index="0"><div id="proof" class="scene"/);
  assert.match(html, /data-asset-id="cover-base"/);
  assert.match(html, /src="assets\/cover\/base-v1\.png"/);
  assert.match(html, /data-layer-id="title"[^>]+src="assets\/cover\/title-tight\.png"/);
  assert.match(html, /data-layer-role="logo"/);
  assert.equal(html.match(/class="clip logo safe-area"/g)?.length, 2);
  assert.match(html, /id="proof-brand-logo" class="clip logo safe-area"[^>]*data-start="0" data-duration="6" data-track-index="1"/);
  assert.match(html, /id="proof-cover-base" class="clip evidence-media evidence-base"/);
  assert.match(html, /BrandLoom/);
  assert.match(html, /演示项目：ENHE Product Video/);
  assert.match(html, /仅作为真实示例项目展示/);
  assert.equal(html.match(/演示项目：ENHE Product Video/g)?.length, 1);
  assert.equal(html.match(/仅作为真实示例项目展示/g)?.length, 1);
  assert.match(html, /访问恩禾官网，了解产品与使用方式。/);
  assert.match(html, /www\.enhe-tech\.com\.cn/);
  assert.equal(html.match(/访问恩禾官网，了解产品与使用方式。/g)?.length, 1);
  assert.equal(html.match(/www\.enhe-tech\.com\.cn/g)?.length, 1);
  assert.match(html, /data-scene-goal="看清真实底图、标题和标志的组成关系"/);
  assert.doesNotMatch(html, /class="scene-purpose"/);
  assert.doesNotMatch(html, /tl\.(?:set|to|fromTo)\("#proof-clip"/);
  assert.doesNotMatch(html, /github\.com\/example\/source/);
});

test('final scene keeps all supplied author contacts as secondary readable content', () => {
  const html = composeVideo(sampleSpec(), { gsapPath: 'assets/gsap.min.js', fonts: [], narration });
  assert.match(html, /class="contact-block safe-area" data-text-role="body"/);
  assert.match(html, /class="contact-name safe-area">Example Author/);
  for (const value of ['example-dev', '@example_ai', 'example.test', 'example-wechat', 'author@example.test']) assert.match(html, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(html.match(/<li class="safe-area">/g)?.length, 5);
  assert.match(html, /class="primary-cta"/);
});

test('a product-name heading remains while a repeated body copy is omitted because the header already shows it', () => {
  const spec = sampleSpec();
  spec.scenes[0]!.onScreenText = ['BrandLoom', 'BrandLoom', '一套真实素材'];
  const output = composeVideo(spec, { gsapPath: 'assets/gsap.min.js', fonts: [], narration });
  assert.equal(output.match(/<h2>BrandLoom<\/h2>/g)?.length, 1);
  assert.doesNotMatch(output, /<p class="screen-copy" data-text-role="body">BrandLoom<\/p>/);
  assert.match(output, /<p class="product-name" data-text-role="label">BrandLoom<\/p>/);
});

test('before-after evidence follows semantic relatedAssetIds order even when assetRefs are reversed', () => {
  const spec = sampleSpec();
  spec.assets.push(
    { id: 'before-state', type: 'image', path: 'assets/before.png', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null },
    { id: 'after-state', type: 'image', path: 'assets/after.png', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null },
    { id: 'context', type: 'image', path: 'assets/context.png', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null },
  );
  spec.scenes[0]!.assetRefs = ['after-state', 'context', 'before-state'];
  spec.scenes[0]!.action = {
    ...spec.scenes[0]!.action, primitive: 'before-after', subject: { assetId: 'before-state' }, relatedAssetIds: ['before-state', 'after-state'],
  };
  const output = composeVideo(spec, { gsapPath: 'assets/gsap.min.js', fonts: [], narration });
  const context = output.indexOf('data-asset-id="context"');
  const before = output.indexOf('data-asset-id="before-state"');
  const after = output.indexOf('data-asset-id="after-state"');
  assert.ok(context >= 0 && context < before && before < after, 'context, before and after must paint in semantic order');
});

test('composition preserves narration cue structure and deterministic seek behavior', () => {
  const html = composeVideo(sampleSpec(), { gsapPath: 'assets/gsap.min.js', fonts: [], narration });
  assert.match(html, /<audio id="narration" class="clip" src="input\/narration\.wav" data-start="0" data-duration="12"/);
  assert.match(html, /<audio id="narration"[^>]*data-track-index="1000"/);
  assert.match(html, /id="narration-caption-0" class="caption narration-caption"[^>]*data-caption-start="0\.5" data-caption-end="3\.4"/);
  assert.match(html, /id="narration-caption-1" class="caption narration-caption"[^>]*data-caption-start="7" data-caption-end="10\.5"/);
  assert.match(html, /const NARRATION_CUES=\[/);
  assert.match(html, /window\.NARRATION_CUES=NARRATION_CUES/);
  assert.match(html, /"sceneId":"proof","text":"标题和标志，分别检查。","start":0\.5,"end":3\.4/);
  assert.match(html, /window\.__timelines=\{main:tl\}/);
  assert.doesNotMatch(html, /repeat\s*:\s*-1|Math\.random|Date\.now|https?:\/\/[^<\s"']+\.js/);
});

test('composition uses measured narration duration while retaining a longer visual and music ending', () => {
  const spec = sampleSpec();
  spec.assets.push({ id: 'music-bed', type: 'audio', path: 'assets/music-bed.wav', sourceUrl: 'local-preprocessed-mix', license: 'authorized', required: true, fallbackAssetId: null });
  spec.audio.musicAssetId = 'music-bed';
  const output = composeVideo(spec, { gsapPath: 'assets/gsap.min.js', fonts: [], narration: { ...narration, durationSec: 11.687 } });
  assert.match(output, /<audio id="narration"[^>]*data-duration="11\.687"/);
  assert.match(output, /data-composition-id="main" data-start="0" data-duration="12"/);
  assert.match(output, /<audio id="music"[^>]*data-duration="12"/);
  assert.match(output, /data-caption-end="10\.5"/);
});

test('composition binds the declared display font to titles and emits preprocessed music as a second audio track', () => {
  const spec = sampleSpec();
  spec.brand.fontFamilies = ['Source Han Sans CN', 'Smiley Sans'];
  spec.assets.push({ id: 'music-bed', type: 'audio', path: 'assets/music-bed.wav', sourceUrl: 'local-preprocessed-mix', license: 'authorized', required: true, fallbackAssetId: null });
  spec.audio.musicAssetId = 'music-bed';
  const output = composeVideo(spec, {
    gsapPath: 'assets/gsap.min.js',
    fonts: [
      { family: 'Source Han Sans CN', path: 'assets/SourceHanSansCN-Regular.otf', weight: 400 },
      { family: 'Smiley Sans', path: 'assets/SmileySans.woff2', weight: 400 },
    ],
    narration,
  });
  assert.match(output, /h1,h2,h3\{font-family:"Smiley Sans",sans-serif/);
  assert.match(output, /<audio id="music" class="clip" src="assets\/music-bed\.wav" data-start="0" data-duration="12" data-track-index="1001" data-volume="1"><\/audio>/);
});

test('an optional real scene background stays behind the evidence stage instead of becoming a second card', () => {
  const spec = sampleSpec();
  spec.assets.push({ id: 'workspace-background', type: 'image', path: 'assets/workspace.jpg', sourceUrl: 'authorized-local-scene', license: 'authorized', required: true, fallbackAssetId: null });
  spec.scenes[0]!.backgroundAssetId = 'workspace-background';
  spec.scenes[0]!.assetRefs.push('workspace-background');
  const output = composeVideo(spec, { gsapPath: 'assets/gsap.min.js', fonts: [], narration });
  assert.match(output, /<img id="proof-background" class="clip scene-background" data-background-asset-id="workspace-background" data-asset-id="workspace-background" src="assets\/workspace\.jpg"/);
  assert.equal(output.match(/data-background-asset-id="workspace-background"/g)?.length, 1);
  assert.doesNotMatch(output, /class="clip evidence-media" data-asset-id="workspace-background"/);
  assert.match(output, /\.evidence-stage\{[^}]*box-shadow:/);
  assert.match(output, /\.landscape \.has-contacts \.evidence-stage\{align-self:center;height:auto\}/);
  assert.doesNotMatch(output, /\.evidence-stage:before/);
});

test('portrait output uses an independent stage layout instead of center-cropping landscape coordinates', () => {
  const html = composeVideo(sampleSpec(1080), { gsapPath: 'assets/gsap.min.js', fonts: [], narration });
  assert.match(html, /class="composition portrait"/);
  assert.match(html, /width:1080px;height:1920px/);
  assert.match(html, /\.portrait \.scene-content\{grid-template-columns:1fr;grid-template-rows:auto minmax\(0,\.82fr\) minmax\(0,1\.18fr\)/);
  assert.doesNotMatch(html, /scale\([^)]*0\.5625|translateX\(-420px\)/);
});

test('workflow presentation renders a full-stage card flow and consumes approved card copy exactly once', () => {
  const spec = sampleSpec() as ReturnType<typeof sampleSpec> & {
    brand: ReturnType<typeof sampleSpec>['brand'] & { presentation?: 'workflow' };
    scenes: Array<ReturnType<typeof sampleSpec>['scenes'][number] & { workflow?: SceneWorkflow }>;
  };
  spec.brand.presentation = 'workflow';
  const workflow: SceneWorkflow = {
    layout: 'horizontal-3',
    cards: [
      { id: 'copy', previewAssetId: 'cover-base', title: '步骤一', sentence: '真实短句一', fields: [{ label: '字段', value: '值一' }], focusFrame: 10, completeFrame: 50 },
      { id: 'type', previewAssetId: 'preview-two', title: '步骤二', sentence: '真实短句二', fields: [{ label: '字段', value: '值二' }], focusFrame: 60, completeFrame: 100 },
      { id: 'logo', previewAssetId: 'preview-three', title: '步骤三', sentence: '真实短句三', fields: [{ label: '字段', value: '值三' }], focusFrame: 110, completeFrame: 150 },
    ],
  };
  spec.assets.push(
    { id: 'preview-two', type: 'screenshot', path: 'assets/two.png', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null },
    { id: 'preview-three', type: 'logo', path: 'assets/three.png', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null },
  );
  spec.scenes[0]!.workflow = workflow;
  spec.scenes[0]!.assetRefs = ['cover-base', 'cover-title', 'cover-logo', 'preview-two', 'preview-three'];
  spec.scenes[0]!.onScreenText = [spec.product.name, ...workflowText(workflow)];
  spec.scenes[0]!.action = {
    ...spec.scenes[0]!.action!, primitive: 'workflow-progress', subject: { assetId: 'cover-base' },
    relatedAssetIds: workflow.cards.map(card => card.previewAssetId), startFrame: 0, endFrame: 160, holdFrames: 20,
  };

  const output = composeVideo(spec, { gsapPath: 'assets/gsap.min.js', fonts: [], narration });
  const proof = output.slice(output.indexOf('id="proof"'), output.indexOf('</section>'));
  assert.match(output, /class="composition landscape presentation-workflow"/);
  assert.match(proof, /class="workflow-stage horizontal-3"/);
  assert.equal(proof.match(/class="workflow-card /g)?.length, 3);
  assert.equal(proof.match(/>步骤一</g)?.length, 1);
  assert.doesNotMatch(proof, /class="copy-column"/);
  assert.match(proof, /data-workflow-card-id="logo"[\s\S]*data-asset-id="preview-three"/);
});

test('workflow presentation centers ordinary result scenes even when they have no card workflow', () => {
  const spec = sampleSpec() as ReturnType<typeof sampleSpec> & { brand: ReturnType<typeof sampleSpec>['brand'] & { presentation?: 'workflow' } };
  spec.brand.presentation = 'workflow';
  const output = composeVideo(spec, { gsapPath: 'assets/gsap.min.js', fonts: [], narration });
  assert.match(output, /class="composition landscape presentation-workflow"/);
  assert.match(output, /id="proof" class="scene centered-result"/);
  assert.match(output, /\.presentation-workflow \.centered-result \.scene-content\{/);
});

function posterSpec(): ActionVideoSpec {
  const spec = sampleSpec();
  spec.assets.push({ id: 'author-poster', type: 'image', path: 'assets/author-poster.png', sourceUrl: 'owned-test-fixture', license: 'owned', required: true, fallbackAssetId: null, width: 1500, height: 1000 });
  const ending = spec.scenes.at(-1)!;
  ending.authorPosterAssetId = 'author-poster';
  ending.assetRefs.push('author-poster');
  ending.voiceover = '';
  ending.caption = '';
  ending.heroFrameSec = 9;
  ending.action = { ...ending.action!, subject: { assetId: 'author-poster' }, syncCueId: undefined };
  return spec;
}

test('declared author-region image crops carry only image-level intentional-overflow annotations', () => {
  const spec=posterSpec();spec.brand.visualStyle='editorial-v1';
  spec.assets.find(asset=>asset.id==='author-poster')!.authorRegions={portrait:[0,0,700,1000],information:[750,100,1450,900]};
  const output=composeVideo(spec,{gsapPath:'assets/gsap.min.js',fonts:[],narration:{...narration,cues:[narration.cues[0]!]}});
  for(const role of ['portrait','information'])assert.match(output,new RegExp(`<img id="signoff-${role}"[^>]*data-layout-allow-overflow`));
  assert.doesNotMatch(output,/<figure[^>]*data-layout-allow-overflow/);
  assert.doesNotMatch(output,/<(?:p|h2|li)[^>]*data-layout-allow-overflow/);
});

test('a declared whole author poster replaces layered ending content while preserving earlier scenes', () => {
  const spec = posterSpec();
  const output = composeVideo(spec, { gsapPath: 'assets/gsap.min.js', fonts: [], narration: { ...narration, cues: [narration.cues[0]!] } });
  const ending = output.slice(output.indexOf('<section id="signoff-clip"'), output.indexOf('</section>', output.indexOf('<section id="signoff-clip"')));
  assert.match(ending, /class="scene author-poster-scene"/);
  assert.equal(ending.match(/src="assets\/author-poster\.png"/g)?.length, 2);
  assert.match(ending, /class="clip author-poster-image" data-asset-id="author-poster"/);
  assert.doesNotMatch(ending, /brand-header|contact-block|copy-column|data-layer-id|cover\/|<h2>|<p[ >]/);
  assert.match(output, /id="proof-brand-logo"/);
  assert.match(output, /data-layer-id="title"/);
  assert.match(output, /data-caption-start="0\.5" data-caption-end="3\.4"/);
  assert.doesNotMatch(output, /class="caption narration-caption"[^>]*data-scene-id="signoff"/);
});

test('whole author poster schema accepts the explicit asset reference and rejects unsafe IDs', () => {
  const spec = posterSpec();
  spec.scenes[0]!.heroFrameSec = 2;
  assert.doesNotThrow(() => validateSpec(spec));
  spec.scenes.at(-1)!.authorPosterAssetId = '../private.png';
  assert.throws(() => validateSpec(spec), /authorPosterAssetId/);
});

test('whole author posters reject narration and incompatible scenes instead of silently hiding content', () => {
  const options = { gsapPath: 'assets/gsap.min.js', fonts: [], narration: { ...narration, cues: [narration.cues[0]!] } };
  assert.throws(() => composeVideo(posterSpec(), { ...options, narration }), /author poster.*narration/i);
  for (const field of ['voiceover', 'caption'] as const) {
    const spec = posterSpec();
    spec.scenes.at(-1)![field] = 'Still needs to be narrated or captioned';
    assert.throws(() => composeVideo(spec, options), /author poster.*silent/i);
  }
  const nonFinal = posterSpec();
  nonFinal.scenes.push({ ...nonFinal.scenes[0]!, id: 'after-poster', actualStartSec: 12, actualEndSec: 18 });
  assert.throws(() => composeVideo(nonFinal, options), /author poster.*final/i);
  const animated = posterSpec();
  animated.scenes.at(-1)!.action!.primitive = 'object-handoff';
  assert.throws(() => composeVideo(animated, options), /author poster.*reading-hold/i);
  const missing = posterSpec();
  missing.scenes.at(-1)!.authorPosterAssetId = 'missing';
  assert.throws(() => composeVideo(missing, options), /author poster.*declared image/i);
});

for (const [sceneCount, workflow] of [[2, false], [3, false], [2, true], [3, true]] as const) {
  test(workflow ? `${sceneCount}-scene workflow directly before the whole author poster requires a separate product CTA scene` : `${sceneCount}-scene films keep the approved website CTA in the last product scene before a whole author poster`, () => {
    const spec = posterSpec();
    if (sceneCount === 3) {
      const productEnding = sampleSpec().scenes[1]!;
      productEnding.id = 'product-ending';
      productEnding.action!.syncCueId = undefined;
      spec.scenes.splice(1, 0, productEnding);
      spec.scenes.at(-1)!.actualStartSec = 12;
      spec.scenes.at(-1)!.actualEndSec = 18;
    }
    const productEnding = spec.scenes.at(-2)!;
    productEnding.onScreenText = ['保留已批准的产品结尾', spec.generatorPolicy!.marketing.screenAction, spec.generatorPolicy!.marketing.displayDomain];
    if (workflow) {
      productEnding.assetRefs = ['cover-base', 'cover-title', 'cover-logo'];
      productEnding.workflow = { layout: 'horizontal-3', cards: productEnding.assetRefs.map((assetId, index) => ({ id: `card-${index}`, previewAssetId: assetId, title: `检查 ${index}`, sentence: '使用已批准素材', fields: [{ label: '结果', value: '已确认' }], focusFrame: index * 40, completeFrame: index * 40 + 30 })) };
      productEnding.onScreenText.push(...workflowText(productEnding.workflow));
      productEnding.action = { ...productEnding.action!, primitive: 'workflow-progress', relatedAssetIds: productEnding.assetRefs, startFrame: 0, endFrame: 120, holdFrames: 60 };
    }
    const options = { gsapPath: 'assets/gsap.min.js', fonts: [], narration: { ...narration, cues: [narration.cues[0]!] } };
    if (workflow) {
      assert.throws(() => composeVideo(spec, options), /author poster.*separate.*CTA.*workflow/i);
      return;
    }
    const output = composeVideo(spec, options);
    const start = output.indexOf(`<section id="${productEnding.id}-clip"`);
    const ending = output.slice(start, output.indexOf('</section>', start));
    assert.match(ending, /<h2>保留已批准的产品结尾<\/h2>/);
    assert.match(ending, /<p class="primary-cta">访问恩禾官网，了解产品与使用方式。<\/p>/);
    assert.match(ending, /<p class="display-domain" data-text-role="body">www\.enhe-tech\.com\.cn<\/p>/);
    assert.equal(output.match(/class="primary-cta"/g)?.length, 1);
    assert.equal(output.match(/访问恩禾官网，了解产品与使用方式。/g)?.length, 1);
    assert.equal(output.match(/www\.enhe-tech\.com\.cn/g)?.length, 1);
    assert.doesNotMatch(ending, /class="contact-block|class="contact-name|has-contacts/);
  });
}

test('a standalone whole author poster does not introduce a separate website CTA', () => {
  const spec = posterSpec();
  spec.scenes.splice(0, 1);
  spec.scenes[0]!.actualStartSec = 0;
  spec.scenes[0]!.actualEndSec = 6;
  const output = composeVideo(spec, { gsapPath: 'assets/gsap.min.js', fonts: [] });
  assert.match(output, /class="scene author-poster-scene"/);
  assert.doesNotMatch(output, /class="primary-cta"|class="display-domain"|class="contact-block/);
});
