---
id: storyboard-director.v1
version: 1.2.0
artifact: STORYBOARD.md and video-spec.json
---

# Storyboard direction prompt

Translate the verified script and design direction into 5–8 scenes. Give each scene one communication goal and select a versioned recipe because its input requirements match the available evidence. Do not force the default sequence when the product evidence calls for a different supported scene choice.

## Inputs

- `DESIGN.md`
- `SCRIPT.md`
- `PRODUCT-SUMMARY.md`
- `input/product-input.json`
- `assets/assets-manifest.json`
- `recipes/*.v1.json`
- `schemas/video-spec.schema.json`

Before assigning an asset, verify its ID, path, source, and license. An unknown-license asset cannot be planned for final. Social proof may be used only when its exact evidence and authorization are recorded.

New tasks inherit the versioned `brand.visualStyle: editorial-v2`; historical specifications retain their existing style. Design a photographic hero or an evidence-led workflow stage with a clear input/focal-step/result progression. Choose the three supported workflow forms by the actual story, not by product name. Use real previews, not empty bars; reserve enough room for all approved words at the existing small-player readability sizes. Remove repeated company/product labels and never shrink text to hide an overflow. Focus and connector motion must explain a change in content. Review actual frames, including reverse seeks, card clipping, image safe crops and captions. A complete contact poster may use explicitly reviewed original-pixel `authorRegions` only when reframing is authorized; do not guess crop coordinates or treat a candidate crop as approved.

## Output contract

Write `STORYBOARD.md` and schema-valid `video-spec.json`. Each storyboard beat must include:

- purpose and versioned recipe ID;
- narration or explicit `NONE`;
- on-screen text;
- asset IDs and evidence references;
- hero frame, camera/crop, entrance motion, transition, caption region, optional sound cue, and fallback;
- planned duration and, after real audio exists, actual start/end timing.

Include an asset audit table covering every referenced ID. The opening must show the product name or core result within three seconds. Every boundary needs a supported transition or the documented crossfade fallback. Preserve visible content through the last frame, and validate `video-spec.json` before composition work begins.

Current refinement: align the header logo and main title at the left edge. Subtitles alone use 30.8px (70% of 44px); keep other type minimums. Use bold card titles, readable sentences and quieter metadata. Reveal evidence along the flow direction with synchronized connectors and stable card positions. The visible CTA is “访问恩禾官网，获取更多AI工具和解决方案。”; keep accepted narration unchanged. A trusted screen-only policy revision can reuse identical voice evidence, with source/target approvals and all audible rules still strictly checked.
