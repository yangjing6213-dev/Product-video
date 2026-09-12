# Contributing

Thank you for helping improve ENHE Product Video Studio. Keep changes focused, evidence-backed, and safe for local use.

## Before you start

The currently verified development environment is Windows x64 with Node.js 24.15+ and npm. After a fresh clone, install the pinned dependencies with:

```powershell
npm ci
```

Read [README.en.md](README.en.md) and the public guides related to the area you plan to change. If an `AGENTS.md` file is present in your working copy, follow its local instructions, but it is not required public content. Open a normal issue in the verified public repository once its Issue tracker is available when scope needs discussion. Security reports follow [SECURITY.md](SECURITY.md) and must not include sensitive details in a public issue.

## Change guidelines

- Keep the change limited to one clear purpose and preserve unrelated local work.
- Do not commit `.tools`, `.cache`, rendered media, private inputs, credentials, or local audit reports.
- Use only assets that are owned or explicitly authorized. Record provenance and the applicable license; `license=unknown` content cannot enter a final render.
- Do not add paid services, cloud infrastructure, automated publishing, global installers, or GitHub Actions workflows without an explicit project decision.
- Do not represent model review as human review or unexecuted checks as passing.
- Update the English and Chinese documentation together when behavior or user-facing instructions change.

## Validation

Run the configured checks relevant to the change:

```powershell
npm run lint
npm run typecheck
npm test
```

Browser tests require an installed Chrome executable (`HYPERFRAMES_BROWSER_PATH`) and a licensed Chinese font. The layout/workflow fixtures default to Microsoft YaHei on Windows; set `EPVS_TEST_CJK_FONT` to another installed CJK font family when needed. To load a verified font file without a system install, also set `EPVS_TEST_CJK_FONT_PATH` to its absolute path. Missing fonts fail with setup instructions rather than accepting fallback or skipping assertions; private brand images are not required by these fixtures.

The [CI workflow](.github/workflows/ci.yml) runs on main pushes, pull requests and manual requests using a standard Windows runner. It checks source, real browser layout, Python migration/speech contracts, dependencies and the actual public package. CI downloads a pinned OFL Chinese font into the temporary workspace; no system font installation is required. Two optional Kokoro integration tests explicitly skip when that local backend is absent. Private voice models, brand assets and generated videos are never uploaded, cached or published by this workflow. See the [CI guide](docs/guides/ci.md) for the exact scope and local reproduction.

The project does not currently configure coverage tooling or a coverage threshold. It also has no separate compilation build step because Node.js executes the TypeScript ESM sources directly. Do not report coverage or build as passing; record them as not configured or not applicable.

For video or pipeline changes, also run the relevant HyperFrames lint, validate, inspect, render, and media checks described in the repository guides. Include only real command and report evidence.

## Licensing contributions

Original project code is licensed under [Apache-2.0](LICENSE). By intentionally submitting a contribution, you confirm that you have the right to submit it and that it may be included under that license unless you clearly state an applicable third-party license. External code, models, media, fonts, datasets, and other assets retain their own terms and must be recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) or the relevant project asset notice.
