# Workflow

Follow all stages in order. Codex owns creative decisions and artifacts. The CLI owns deterministic validation, state, cache/resume, tool invocation, and actual JSON evidence.

1. **Read rules and input** — Read `AGENTS.md`, this Skill, input JSON, available assets, schemas, and `npm run video -- help`. The CLI uses positional `help`; `--help` is not implemented. Do not assume a command exists from documentation alone.
2. **Preflight** — Run `npm run video -- init --input <product-input.json>` and `npm run video -- verify-input --project <projectId>`. Confirm schema, URLs/paths, required assets, licenses, target directory, and local tool availability. Preserve report JSON and nonzero failures.
3. **Capture & Understand** — Run `npm run video -- capture --project <projectId>`. The default path invokes HyperFrames `capture` and has automatic fallback to `supplied-assets` when capture fails. Pass `--supplied-only` to skip URL capture and require usable licensed supplied visuals. Write `PRODUCT-SUMMARY.md` with claims mapped to evidence.
4. **DESIGN.md gate** — Before composition HTML, write the style prompt, 3–5 colors with roles, 1–2 font families/fallbacks, logo rules, motion tone, safe areas, and what to avoid. Base them on real brand evidence.
5. **SCRIPT.md** — Write a result-first 30–60 second script with one problem, up to three evidenced benefits, and one CTA. Keep screen copy shorter than narration. For `narrationMode=none`, mark narration as `NONE` and design for readable screen copy.
6. **STORYBOARD.md + video-spec.json** — Build 5–8 single-purpose scenes with versioned recipes, real asset IDs, hero frames, crop/camera intent, finite entrance motion, transitions, caption regions, and fallbacks. Validate the JSON contract before composition work.
7. **Voice, transcript, and timing** — Use HyperFrames TTS only when the current voice list supports the locale. Otherwise use authorized external audio or `narrationMode=none`. With audio, generate one real transcript source and update actual scene timing from it; do not maintain competing caption text. For local Chinese narration, read `docs/guides/CHINESE-TTS.md`, run `node scripts/setup-tts.mjs --verify-only`, then use `.tools/tts-venv/Scripts/python.exe -X utf8 scripts/synthesize-zh.py <projectId>`. Treat its measured phrase/句级 PCM boundaries as phrase timing; they are not ASR 逐词 timestamps. Bind the audio and 字幕/transcript artifacts with SHA-256 evidence across `voice-report.json` and `narration-artifact-check.json` (or equivalent actual reports), including an SRT text/time comparison against the measured cues. Keep `ASR` as `NOT_RUN` when no real transcription backend ran.
8. **Build HyperFrames compositions** — Use the current local scaffold/contract. Establish static layout first, then deterministic finite animation. Use real brand/product assets; apply declared fallbacks instead of fabricating content.
9. **Lint, validate, and inspect** — Run `npm run video -- qa --project <projectId>` and retain the actual JSON result. Fix every error. Explain or repair each warning; never bulk-ignore it.
10. **Draft render** — Run `npm run video -- render --project <projectId> --quality draft`. Record the actual render report and preview URL only when observed.
11. **QA repair** — Inspect contact-sheet frames and machine reports. Fix the smallest evidenced defect, rerun the failed check, and stop after bounded retries. For renderer failures, use the available HyperFrames doctor/info diagnostics before changing code.
12. **Final render** — Run `npm run video -- render --project <projectId> --quality high --resume` only after input, asset, structure, visual, and audio gates pass. An unknown-license asset blocks this stage.
13. **Media probe, scorecard, and report** — Verify decode, dimensions, fps, duration, required streams, black frames, and silence rules. Complete an independent visual scorecard and record reviewer type plus whether human review occurred; never label a Codex review as human. Preserve `qa-report.json`, `scorecard.json`, `render-high-report.json`, `render-report.json`, and `run-report.json` with real commands, exits, timings, paths, and remaining risks. Per-command details are stored under `reports/commands/`. The current benchmark videos are local-only deliverables and still require explicit human review before external publication.

## Resume and cache

`verify-input`, `capture`, `qa`, `render`, and `run` all use `--resume` for stage reuse. Identical-input `init` is idempotent without it. A stage is reused only when its fingerprint matches and every registered output still exists with unchanged bytes; if an output is missing or its bytes change, that stage reruns. `npm run video -- run --project <projectId> --resume` resumes the full deterministic chain. Trust the reported input hashes and stage states, and use `reports/run-history.json` for the preserved first playable draft timestamp. Never call Codex recursively from `run`.

If the current CLI rejects a documented option, capture the actual help/error, use the supported equivalent, and report the difference. Never edit a JSON report to simulate success.

## Failure routing

| Failure | Response |
|---|---|
| URL capture fails | Switch to `supplied-assets`; record final URL/error and missing coverage. |
| Target-language TTS is unavailable | Use authorized external audio or `narrationMode=none`; do not fake audio. |
| Complex transition is unsupported | Use a CSS reveal or crossfade. |
| Screenshot resolution is insufficient | Use a native-resolution crop plus brand card; do not enlarge beyond 2x. |
| Caption overflows | Shorten copy, adjust the container, or fit text while preserving the two-line limit. |
| Render fails | Run available doctor/info diagnostics, make a minimal repair, and retry a bounded number of times. |
| Asset license is unknown | Keep it out of final and request/reselect authorized material. |
