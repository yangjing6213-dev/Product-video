import type { ProductInput, VideoSpec } from '../../src/contracts.ts';

export const validProductInput: ProductInput = {
  schemaVersion: '1.0',
  projectId: 'cognitive-anchor-sketcher-promo',
  product: {
    name: 'Cognitive Anchor Sketcher',
    url: 'https://example.com/product',
    oneLiner: '把文章中的认知动作画出来',
    targetAudience: ['研究者', '内容创作者'],
    primaryProblem: '长文的推理结构难以快速理解',
    valueProposition: '把抽象论证转化为可读的视觉结构',
    features: [
      {
        name: '认知动作提取',
        benefit: '快速定位文章的推理步骤',
        evidenceAssetIds: ['hero-shot'],
      },
    ],
    proofPoints: [],
    cta: {
      label: '查看项目',
      url: 'https://example.com/product',
    },
  },
  brand: {
    logoAssetId: 'brand-logo',
    colors: ['#0A0A0A', '#F5F5F5', '#28C2FF'],
    fontFamilies: ['Inter', 'Microsoft YaHei'],
    motionTone: 'technical',
    canvas: 'dark',
    mustAvoid: ['未经证实的数据'],
  },
  assets: [
    {
      id: 'brand-logo',
      type: 'logo',
      path: 'assets/Brand Logo.svg',
      sourceUrl: 'https://example.com/brand/logo.svg',
      license: 'owned',
      required: true,
      fallbackAssetId: null,
    },
    {
      id: 'hero-shot',
      type: 'screenshot',
      path: 'assets/Hero Screen.png',
      sourceUrl: 'https://example.com/product',
      license: 'authorized',
      required: true,
      fallbackAssetId: 'brand-logo',
    },
  ],
  output: {
    locale: 'zh-CN',
    width: 1920,
    height: 1080,
    fps: 30,
    targetDurationSec: 45,
    quality: 'standard',
  },
  audio: {
    narrationMode: 'none',
    voice: '',
    externalAudioAssetId: null,
    musicAssetId: null,
  },
  captions: {
    enabled: true,
    maxLines: 2,
    safeAreaPercent: 7,
    style: 'brand-minimal',
  },
};

export const validVideoSpec: VideoSpec = {
  ...structuredClone(validProductInput),
  recipeVersion: 'product-promo.v1',
  promptVersions: {
    design: 'design.v1',
    script: 'script.v1',
    storyboard: 'storyboard.v1',
  },
  narrative: {
    coreMessage: '把文章中的认知动作画出来',
    cta: '查看项目',
  },
  scenes: Array.from({ length: 5 }, (_, index) => {
    const start = index * 9;
    return {
      id: `scene-${String(index + 1).padStart(2, '0')}`,
      recipe: index === 0 ? 'hero-hook.v1' : 'feature.v1',
      goal: index === 0 ? '在前 3 秒明确产品和结果' : `讲清功能 ${index}`,
      plannedDurationSec: 9,
      actualStartSec: start,
      actualEndSec: start + 9,
      voiceover: '',
      onScreenText:
        index === 0 ? ['Cognitive Anchor Sketcher', '把文章中的认知动作画出来'] : [`功能 ${index}`],
      assetRefs: index === 0 ? ['hero-shot'] : ['brand-logo'],
      compositionFile: `compositions/scene-${String(index + 1).padStart(2, '0')}.html`,
      motionDirection: '由下向上淡入',
      transition: {
        type: 'crossfade' as const,
        durationSec: 0.5,
      },
      fallback: {
        onMissingAsset: 'use-brand-card' as const,
        onUnsupportedEffect: 'use-css-reveal' as const,
      },
      caption: index === 0 ? '把文章中的认知动作画出来' : `功能 ${index}`,
      heroFrameSec: start + 1,
    };
  }),
  qa: {
    checks: ['schema', 'assets', 'captions', 'media'],
  },
  provenance: {
    sourceUrls: ['https://example.com/product'],
    generatedAt: '2026-09-09T00:00:00.000Z',
  },
};
