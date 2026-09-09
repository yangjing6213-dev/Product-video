# Input contract

Read `product-input.json` and validate it before creative work. The schema is authoritative; this reference explains the facts Codex needs.

| Required concept | Input | Handling when absent |
|---|---|---|
| Product URL and/or local screenshots | `product.url`, `assets[]` | A non-empty URL must be credential-free HTTP(S). With an empty URL, use licensed supplied visuals and `--supplied-only`. Do not bypass restricted pages. |
| Product name | `product.name` | Critical: stop or use an existing verified name; never invent one. |
| One-line description | `product.oneLiner` | Derive only from first-party evidence; otherwise use a neutral verified description. |
| Target audience | `product.targetAudience[]` | Infer only when the source states or clearly demonstrates it; record the inference. |
| Primary problem | `product.primaryProblem` | Use one verified problem. Do not manufacture urgency or harm. |
| Up to three features and benefits | `product.features[]` | Each selected benefit must link to its `evidenceAssetIds` or another recorded source. |
| Brand logo, colors, and fonts | `brand`, `assets[]` | Extract from a real site or supplied material. Record font fallback explicitly. |
| CTA | `product.cta` | Use one exact label and verified destination. |
| Output locale | `output.locale` | Controls script, on-screen copy, and caption language. |
| Narration mode | `audio.narrationMode` | One of verified HyperFrames TTS, authorized external audio, or `none`. |

## Asset evidence

Every used asset needs a stable ID, type, local path, source URL when applicable, license (`owned` or `authorized` for final), required flag, and optional fallback ID. Validate Windows paths with spaces as complete path values. Never split or reconstruct them from unquoted fragments.

The current implementation requires `product.cta.url` to be a credential-free HTTP(S) URL. It accepts an empty `product.url`; this is valid only when supplied assets provide usable licensed product evidence. Use `--supplied-only` so capture does not attempt the empty URL.

`license=unknown` can remain in an audit record, but it cannot enter a final render. A required asset must exist or resolve to a declared, licensed fallback before composition work.

## Claim discipline

Create an evidence map from each product statement to an input field, source URL, or asset ID. Preserve qualifiers. Missing proof means omitting the claim or using neutral language, not inventing a metric, customer, review, award, comparison, or feature.

## Audio choices

- `hyperframes`: use only after the current `tts --list` evidence confirms the target language and voice.
- `external-audio`: require an authorized WAV/MP3 asset and derive scene/caption timing from its real transcript.
- `none`: create a silent video with concise on-screen copy. Keep the caption structure when useful and report the absence of audio truthfully.
