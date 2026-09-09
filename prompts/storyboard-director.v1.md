---
id: storyboard-director.v1
version: 1.0.0
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

## Output contract

Write `STORYBOARD.md` and schema-valid `video-spec.json`. Each storyboard beat must include:

- purpose and versioned recipe ID;
- narration or explicit `NONE`;
- on-screen text;
- asset IDs and evidence references;
- hero frame, camera/crop, entrance motion, transition, caption region, optional sound cue, and fallback;
- planned duration and, after real audio exists, actual start/end timing.

Include an asset audit table covering every referenced ID. The opening must show the product name or core result within three seconds. Every boundary needs a supported transition or the documented crossfade fallback. Preserve visible content through the last frame, and validate `video-spec.json` before composition work begins.
