---
id: script-writer.v1
version: 1.0.0
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

## Output contract

Write `SCRIPT.md` containing:

- duration target and output locale;
- a one-sentence message spine;
- 5–8 numbered beats with purpose, narration text or explicit `NONE`, on-screen text, evidence/asset references, and estimated seconds;
- the exact CTA label and destination;
- a claim ledger mapping every factual statement to evidence;
- unresolved facts that must not enter the video.

The total estimated duration must remain between 30 and 60 seconds. Screen text should be shorter than spoken text, naturally phrased for the locale, and suitable for at most two caption lines. With narration, final timing remains provisional until real audio and transcript timing are available.
