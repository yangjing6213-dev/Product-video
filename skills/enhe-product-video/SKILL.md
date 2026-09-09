---
name: enhe-product-video
description: Use when a user explicitly asks to generate a product introduction video, product promotion video, or turn a website or product page into a video; exclude general editing, film generation, and human-presenter replacement.
---

# ENHE Product Video

Create a truthful 30–60 second product video with Codex-authored creative artifacts and HyperFrames-first local rendering. Product evidence and licensed assets determine the story.

## Read first

1. Read the repository `AGENTS.md`, project input, and current CLI help.
2. Read [references/input-contract.md](references/input-contract.md).
3. Follow [references/workflow.md](references/workflow.md) in order.
4. Select shots with [references/recipes.md](references/recipes.md).
5. Apply [references/qa-checklist.md](references/qa-checklist.md) before final rendering and reporting.
6. When the user requests 中文旁白 (local Chinese narration) or Chinese subtitles, read [the Chinese TTS guide](../../docs/guides/CHINESE-TTS.md) before authoring audio.

## Creative ownership

Codex writes and revises `PRODUCT-SUMMARY.md`, `DESIGN.md`, `SCRIPT.md`, `STORYBOARD.md`, `video-spec.json`, and the HyperFrames compositions. The local CLI validates input and assets, runs deterministic stages, manages run/render hashes and cache, invokes local checks/rendering, and records actual JSON reports. Do not make the CLI call Codex recursively or represent deterministic scaffolding as creative authorship.

Use genuine product and brand assets. Track each asset's source and license. Derive non-critical gaps only from real pages and supplied material; use neutral language for missing critical facts. Never invent metrics, customers, reviews, awards, UI, or capabilities.

## Boundaries

- Prefer the repository CLI, HyperFrames, FFmpeg, and FFprobe.
- Do not add paid APIs, ElevenLabs, Captions AI, Remotion, databases, cloud services, publishing, or unrelated project changes.
- Do not bypass login, CAPTCHA, paywalls, anti-bot controls, or access restrictions.
- Do not expose credentials, cookies, private data, or absolute local paths in public-facing artifacts.
- Do not use `license=unknown` material in final output.
- Keep the Skill in this repository. Provide installation instructions only; never copy it to a global Skill directory without explicit authorization.

## Completion rule

Report only commands and paths observed in current JSON evidence. A static Skill contract test does not prove end-to-end Skill behavior. Local benchmark success requires the applicable HyperFrames, media, asset-license, and independent visual scorecard gates to pass. The scorecard must identify the reviewer type and `humanReviewed`; a Codex review is not human review. Human review and a separate rights/publication decision remain required before external release, but their absence must not be disguised or used to mislabel a local-only result.

## Required handoff

Return the observed Studio preview URL or `NOT_RUNNING`, final MP4 path or missing status, `DESIGN.md`, `SCRIPT.md`, `STORYBOARD.md`, `video-spec.json`, contact sheet, `qa-report.json`, `scorecard.json`, and `run-report.json`. The current repository CLI does not start Studio preview or create the independent visual scorecard. Report a missing artifact as outstanding; when a Codex scorecard exists, report it as independent model review with `humanReviewed: false` and keep the local-only publication boundary explicit.
