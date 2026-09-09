# ENHE Product Video Studio

[中文](README.md)

ENHE Product Video Studio is a local, HyperFrames-first MVP for creating product promotional videos. Codex analyzes the product and authors `PRODUCT-SUMMARY.md`, `DESIGN.md`, `SCRIPT.md`, `STORYBOARD.md`, `video-spec.json`, and HyperFrames compositions. The Node.js CLI orchestrates deterministic input validation, asset registration, stage state and caching, QA, rendering, and reports.

## Scope

- Node.js 24.15+, TypeScript ESM, JSON Schema, and pinned dependencies. HyperFrames is pinned to `0.8.33`.
- Output targets 30–60 seconds at 1920×1080 and 30 fps; the default is 45 seconds.
- Final videos may use only owned or explicitly authorized assets. Assets with `license=unknown` cannot enter a final render.
- The MVP does not use paid APIs, ElevenLabs, Captions AI, Remotion, databases, cloud infrastructure, automated publishing, or global tool installation.
- Windows x64 is the currently supported platform. The local toolchain has not been verified on other platforms.

## Local use

A fresh clone requires Node.js 24.15+ and npm. Install the lockfile-pinned dependencies first:

```powershell
npm ci
```

Then follow the [Windows local setup guide](docs/guides/LOCAL-SETUP.md). Verify existing pinned tools without downloading them:

```powershell
node scripts/setup-local.mjs --verify-only
```

If pinned Chrome or FFmpeg is missing, optionally run `node scripts/setup-local.mjs` to download and verify repository-local copies. The script writes only `.tools`, `.cache`, and the matching local environment file. It does not require administrator access or modify the system PATH, registry, or global environment.

Some existing local workspaces may have `node .tools/npm/bin/npm-cli.js` as a fallback. That ignored file is not included in a clone and cannot replace host npm during initial setup.

Prepare JSON that follows the [input guide](docs/guides/INPUT-GUIDE.md), then use the CLI:

```powershell
npm run video -- help
npm run video -- init --input "C:\path with spaces\product-input.json"
npm run video -- capture --project <projectId>
npm run video -- capture --project <projectId> --supplied-only
npm run video -- verify-input --project <projectId>
npm run video -- qa --project <projectId>
npm run video -- render --project <projectId> --quality draft
npm run video -- render --project <projectId> --quality high --resume
npm run video -- run --project <projectId> --resume
```

The CLI uses the positional `help` command and does not support `--help`. Direct `render` accepts `draft` or `high`; `run` executes draft and high in order. Capture uses repository-local HyperFrames capture and falls back to supplied assets after a capture failure. `--supplied-only` skips URL capture.

`verify-input`, `capture`, `qa`, `render`, and `run` support `--resume`. A stage is reused only when its fingerprint matches and every registered output still exists with unchanged bytes. `init` is naturally idempotent for identical input. The current `run-state.json`, `reports/run-history.json`, and `reports/*.json` are the source of truth. Failures return a nonzero exit code, while console and report output use JSON without secrets, cookies, or complete environment values.

## Authoring Skill

Ask Codex to read the repository [ENHE Product Video Skill](skills/enhe-product-video/SKILL.md) and follow its references. With explicit authorization, the complete `skills/enhe-product-video/` directory may be copied to `$CODEX_HOME/skills/enhe-product-video/`; stop if the destination already exists.

## Chinese narration

The optional [local Chinese narration guide](docs/guides/CHINESE-TTS.md) uses Kokoro v1.1-zh and measured phrase-level timing to produce a WAV track, in-frame captions, and SRT subtitles in a separate project. Its retained benchmark commands require the corresponding private local benchmark data and authorized assets; they are not generic fresh-clone examples.

## Project output

Each `projects/<projectId>/` keeps its input, asset manifest, creative documents, `video-spec.json`, HyperFrames composition, stage state, and actual QA, render, and run reports. Benchmark review additionally requires a final MP4, contact sheet, and independent visual scorecard. A Codex review must never be represented as a human review.

See the [benchmark guide](docs/guides/BENCHMARK-GUIDE.md) for scoring and the [scale gate](docs/architecture/SCALE-GATE.md) for documented future conditions. External publication still requires human review and a separate confirmation of asset rights.

## Development validation

```powershell
npm run lint
npm run typecheck
npm run check:dependency-risk
npm test
```

Coverage tooling and a coverage threshold are not configured. Node.js runs the TypeScript ESM sources directly, so there is no separate compilation build step; `npm run typecheck` checks types without emitting build artifacts.

There is a published advisory affecting the transitive `adm-zip` dependency. `check:dependency-risk` checks whether the reviewed versions and code have changed; it does not fix the vulnerability or replace `npm audit`. Read the [dependency risk disposition](docs/security/DEPENDENCY-RISK.md) for its evidence and limits.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contributions and [SECURITY.md](SECURITY.md) for security-reporting boundaries.

## License

Original project code is licensed under the [Apache License 2.0](LICENSE). Third-party dependencies, models, assets, fonts, and other external material remain subject to their own licenses and provenance terms; Apache-2.0 does not relicense them. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the asset notices within individual projects.
