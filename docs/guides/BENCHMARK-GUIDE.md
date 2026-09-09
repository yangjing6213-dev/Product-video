# Benchmark Guide

The three named product projects, their captured files, generated media, private inputs, and licensed assets are evaluation fixtures and are not distributed with the public source. A fresh clone cannot run the three-product example commands directly. Before using benchmark helper scripts, initialize the three project directories from your own inputs according to the [input guide](INPUT-GUIDE.md) and the repository Skill input contract, then supply assets you are authorized to use.

## Fixed products

| ID | Source | Story focus |
|---|---|---|
| `enhe-ai-homepage` | `https://www.enhe-tech.com.cn/` | Brand-level product/platform introduction; hero, primary capabilities, CTA |
| `cognitive-anchor-sketcher` | `https://github.com/yangjing6213-dev/cognitive-anchor-sketcher` | Explain how article cognitive actions become visual; method, real example, GitHub CTA |
| `project-brand-studio` | `https://github.com/yangjing6213-dev/project-brand-studio` | Show project brand/visual output capability; before/after, real outputs, GitHub CTA |

If a page cannot support a complete story, use user-supplied screenshots, README imagery, and brand assets with recorded rights. Do not fill gaps with unknown-source media.

## Common target

- 1920×1080, 30fps, 30–60 seconds, default target 45 seconds
- 5–8 scenes, one primary problem, up to three core features/benefits, one CTA
- Same schemas, recipes, prompts, Skill, CLI, and report contracts for all three products
- Preserve input, creative documents, video spec, compositions, final MP4, contact sheet, QA report, scorecard, and run report

## Run sequence

For each benchmark, create/verify input, capture evidence, let Codex author the creative artifacts and compositions through the repository Skill, then execute the deterministic gates. Use `--resume` after an interrupted or failed run and confirm hash/state evidence before accepting a cache hit.

```powershell
npm run video -- init --input <benchmark-product-input.json>
npm run video -- verify-input --project <projectId>
npm run video -- capture --project <projectId>
npm run video -- capture --project <projectId> --supplied-only
npm run video -- qa --project <projectId>
npm run video -- render --project <projectId> --quality draft
npm run video -- render --project <projectId> --quality high --resume
npm run video -- run --project <projectId> --resume
```

Default capture invokes local HyperFrames `capture` and automatically falls back to supplied assets on failure. Use `--supplied-only` for the explicit supplied-assets path. Direct render accepts `draft` and `high`; `run` executes both. `verify-input`, `capture`, `qa`, `render`, and `run` can reuse matching complete stage outputs with `--resume`; a missing output or byte change forces that stage to rerun. `init` remains idempotent for identical input without the flag. If npm is not on PATH, use `node .tools/npm/bin/npm-cli.js` in place of `npm`.

Record actual commands, exits, timing, paths, and warnings from JSON reports. Direct command details live in `reports/commands/*.json`; render reports use `render-draft-report.json` and `render-high-report.json`, with `render-report.json` copied from a successful high render. `reports/run-history.json` preserves the first playable draft timestamp so correction time is not reset by a later render. Use `npm run video -- help` and the installed HyperFrames `0.8.33` command evidence when they differ from a planning document.

## Scorecard

| Dimension | Points | Hard evidence |
|---|---:|---|
| Clarity | 20 | Product/result in three seconds, one narrative, clear CTA |
| UI/asset readability | 15 | Key UI, text, and outputs readable at 1080p |
| Brand consistency | 15 | Logo, color, type, voice, motion match `DESIGN.md` |
| Visual finish | 15 | Clear hierarchy, transitions, deliberate animation |
| Pacing | 10 | No drag or overloaded scenes |
| Captions | 10 | Synchronized, no overflow/occlusion, at most two lines |
| Audio | 5 | Synchronized when present; truthful `none` state otherwise |
| Render reliability | 10 | lint, validate, inspect, and media probe all pass |

A benchmark is `PASS` only when total score is at least 80; clarity at least 14/20; brand consistency and UI readability each at least 11/15; render reliability is 10/10; all required assets exist and are licensed; HyperFrames and FFprobe gates pass; no unexplained overflow, black frame, blank tail, or caption occlusion remains; and manual correction time is no more than 30 minutes from first playable draft to final.

Every scorecard must identify the reviewer and set whether human review occurred. A Codex visual review is independent evidence but must not be described as human review. These benchmark outputs remain local-only; human review and a separate rights/publication decision are required before external release.

The MVP is `PASS` only when all three benchmarks pass, identical-input resume/cache behavior is demonstrated, one URL-capture success and one supplied-assets fallback success are evidenced, all prompts/recipes are versioned, and the Skill is exercised on a separate new input. Until actual media and reports exist, keep benchmark status `NOT_RUN` or `PARTIAL` as appropriate.

## Required verification order

Run target unit tests, integration tests, typecheck, relevant source lint, HyperFrames doctor/info, per-benchmark lint/validate/inspect, draft renders, final renders, FFprobe/FFmpeg QA, contact-sheet review and scorecard, then `git diff --check`, diff review, and `git status --short`. Never convert an unavailable check into a pass.
