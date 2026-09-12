---
id: composition-builder.v1
version: 1.1.0
artifact: HyperFrames compositions
---

# HyperFrames composition prompt

Build the HTML compositions from the approved `DESIGN.md`, storyboard, and schema-valid video specification. The HTML is the visual source of truth. Use real brand assets and the recorded evidence; never replace missing identity with a generic gradient, unrelated stock media, or fabricated product UI.

Current generatorPolicy tasks author structured `Scene.action` and invoke the common `video compose` entry. Real asset IDs, true layer bounds, actual before/after states, purpose and frame intervals must reach the renderer. No product-name branches or private whole-film templates. Follow the active generator guide: transparent captions, declared display/body fonts, original Logo without IP, ENHE website primary CTA and the full five-item authorized secondary contact block. Use actual portrait or landscape layout, never a center crop. Keep a contact scene visible for at least six seconds and verify its actual reading quality.

## Inputs

- `DESIGN.md`
- `STORYBOARD.md`
- `video-spec.json`
- `assets/assets-manifest.json`
- selected versioned recipes
- current local HyperFrames CLI help and the scaffold generated for this project

## Build rules

- Establish the final static layout before entrance animation.
- Give each clip a unique ID and explicit start, duration, and track index according to the installed HyperFrames contract.
- Keep timelines paused, finite, synchronous, and registered as required by the installed version. Do not use random values, wall-clock values, or infinite repeats.
- Use flex/grid and padding for content; reserve absolute positioning for decoration.
- Keep title, body, data, UI, and captions readable at 1920x1080. Captions occupy at most two lines and avoid focal UI and CTA regions.
- Give screenshots a purposeful crop, pan, zoom, mask, or focus cue without enlarging a low-resolution source beyond 2x.
- Keep video elements muted and playsinline; use a separate audio element and do not script media playback or seeking.

## Output contract

Create the project composition files referenced by `video-spec.json` and update no unrelated source. Record every used asset ID and recipe version. The build is ready for QA only after the actual local CLI reports successful lint, validation, and inspection; preserve those JSON reports and exit codes rather than summarizing assumed success.

If an effect is unsupported, use a CSS reveal or crossfade. If an asset is missing or unauthorized, apply the declared fallback or stop before final rendering.
