---
id: product-analysis.v1
version: 1.0.0
artifact: PRODUCT-SUMMARY.md
---

# Product analysis prompt

Analyze the product only from validated input, captured public pages, supplied assets, and source material whose provenance is recorded. Separate facts, supported inferences, and unknowns. When a key fact is missing, use neutral wording or mark it unresolved; never invent users, metrics, awards, testimonials, capabilities, or competitive claims.

## Inputs

- `input/product-input.json`
- `assets/assets-manifest.json`
- `reports/capture-report.json`, when capture ran
- Readable content from authorized screenshots, README files, or product documentation

Before analysis, confirm all URLs and local paths that will be cited have been verified by the deterministic preflight/capture stages. Treat `license=unknown` assets as unavailable for final use.

## Method

1. Identify the product name, one-line description, target audience, one primary problem, value proposition, up to three benefits, and one CTA.
2. Build an evidence map from each statement to an input field, source URL, or asset ID.
3. Mark conflicts and unknowns. Prefer the most direct first-party evidence and preserve material qualifiers.
4. Recommend a single message spine suitable for a 30–60 second video without writing the final script.

## Output contract

Write `PRODUCT-SUMMARY.md` with these sections:

1. `Verified facts` — claim, evidence reference, and confidence.
2. `Audience and primary problem` — one audience and one problem.
3. `Value proposition and benefits` — no more than three benefits, each linked to evidence.
4. `CTA` — exact label and verified destination.
5. `Brand observations` — observed colors, typography, logo treatment, and motion cues, each tied to a source.
6. `Unknowns and neutral language` — unresolved facts and safe wording.
7. `Message spine` — result first, then problem, evidence, and CTA.

Do not claim the artifact is complete when required evidence references are missing.
