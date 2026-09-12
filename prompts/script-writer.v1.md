---
id: script-writer.v1
version: 1.2.0
artifact: SCRIPT.md
---

# Product script prompt

Write a natural product-video script from verified product facts and the approved visual direction. Lead with the result, keep one narrative thread, and map every sentence to a real product visual or a branded fallback. Product evidence controls the claims; advertising tone never licenses invention.

## Inputs

- `PRODUCT-SUMMARY.md`
- `DESIGN.md`
- `input/product-input.json`
- `assets/assets-manifest.json`
- `recipes/product-promo-45s.v1.json`

Use one primary problem, no more than three features or benefits, and one CTA. Preserve source qualifiers. For `narrationMode=none`, write concise screen copy and timing intent without pretending narration or an audio stream exists.

For new work, organize the message as a recognizable user problem/context → practical approach → visible result → how to start. This is a communication sequence, not a fixed scene template. Prefer everyday language over internal implementation terms. State the promoted product, example project and publishing brand as separate facts; do not let an example's large title imply it is the product being sold. Explain requirements honestly. A claim without actual evidence stays out of the video. Freeze the complete narration, screen and subtitle scope for user copy approval before rendering. If the user has accepted an existing recording and says to keep it, improve its visuals without rewriting or regenerating that recording.

## Output contract

Write `SCRIPT.md` containing:

- duration target and output locale;
- a one-sentence message spine;
- 5–8 numbered beats with purpose, narration text or explicit `NONE`, on-screen text, evidence/asset references, and estimated seconds;
- the exact CTA label and destination;
- a claim ledger mapping every factual statement to evidence;
- unresolved facts that must not enter the video.

For current generatorPolicy tasks, use the applicable 8–90 second horizontal/vertical contract and purposeful scene count; only historical MVP inputs retain 5–8 beats and 30–60 seconds. Address ordinary AI users, identify product form and prerequisites, distinguish a demonstration project, and keep the ENHE website as primary CTA. Preserve the complete authorized secondary authorContacts block in the reviewed screen text and allow reading time. Screen text should be naturally phrased and suitable for at most two caption lines. With narration, actual audio determines final timing; never force it by repeated speed changes.
