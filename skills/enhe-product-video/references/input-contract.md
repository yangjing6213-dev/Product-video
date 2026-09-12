# Input contract

Read `product-input.json` and validate it before creative work. The schema is authoritative; this reference explains the facts Codex needs.

Current new jobs first apply [GENERATOR-QUALITY.md](../../../docs/guides/GENERATOR-QUALITY.md). `init` fills `generatorPolicy`, ordinary AI audience, the ENHE website CTA and transparent captions. It freezes all five authorized `authorContacts` from the private local profile; partial or differing caller contacts cannot override it. Declare truthful `product.form`, `product.prerequisites` and a separately labeled `product.example` when needed. Landscape and portrait tasks use their own 8–90 second timing contract; historical no-policy inputs retain their previous dimensions and duration.

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
| Frozen brand selection for a new job | `brandLibrary` | Required by new-job `init`; choose reviewed catalog versions, or provide an explicit reason for no selection. |

## Project brand selection

Read `assets/brand/enhe/ip/catalog.json` and select by meaning, not randomly or by filename order. The catalog uses stable `assetId`, measured metadata, project-relative paths, content hashes, review status, original/derived relationships, and rights notes. Original and derived content have separate hashes. A PNG or RGBA file can still be completely opaque; use measured `hasTransparency`, and preserve `null` when metadata cannot be measured.

New job input uses this shape (the values below are placeholders, not real approved assets):

```json
{
  "brandLibrary": {
    "selections": [
      {
        "assetId": "<catalog assetId>",
        "contentVersion": "<catalog contentVersion>",
        "sha256": "<exact selected bytes SHA-256>",
        "purpose": "Explain the collaboration result in the opening scene"
      }
    ]
  }
}
```

- Require `reviewStatus: APPROVED` for every selected entry. Do not approve the entire library as a convenience.
- Pin `contentVersion` exactly. If `preparedPath` exists, select its `preparedHash`; otherwise select the original `sha256`. Do not silently switch between the original and prepared version.
- `selections: []` requires a non-empty `omissionReason`. This does not waive a task's required original Logo, IP, or author material.
- `init` writes selected immutable copies under `projects/<projectId>/assets/brand-frozen/` and the job's `frozen-brand-assets.json`. Use each manifest entry's `jobPath` in the composition.
- On resume, verify existing frozen bytes and the unchanged selection. A catalog update must not alter an older frozen job. A deliberately different selection belongs in a separately identified variant.
- Historical input without `brandLibrary` can resume as historical work; do not change old inputs or videos merely to adopt the new library. Every newly initialized job must declare the selection.
- No daily selection, renderer, or fallback may depend on an external source folder. One-time import paths belong only in explicit migration input and private receipts.

See [the IP library guide](../../../docs/guides/IP-LIBRARY.md) for migration, validation, rights, and complete local backups.

## Asset evidence

Every used asset needs a stable ID, type, local path, source URL when applicable, license (`owned` or `authorized` for final), required flag, and optional fallback ID. Validate Windows paths with spaces as complete path values. Never split or reconstruct them from unquoted fragments.

The current implementation requires `product.cta.url` to be a credential-free HTTP(S) URL. It accepts an empty `product.url`; this is valid only when supplied assets provide usable licensed product evidence. Use `--supplied-only` so capture does not attempt the empty URL.

`license=unknown` can remain in an audit record, but it cannot enter a final render. A required asset must exist or resolve to a declared, licensed fallback before composition work.

## Claim discipline

Create an evidence map from each product statement to an input field, source URL, or asset ID. Preserve qualifiers. Missing proof means omitting the claim or using neutral language, not inventing a metric, customer, review, award, comparison, or feature.

## Audio choices

- `hyperframes`: legacy jobs only. Current Mandarin jobs use `external-audio` produced through the normal `video voice` route; the built-in locale/voice route is not a substitute for the reviewed v1.1 Chinese backend.
- `external-audio`: require an authorized WAV/MP3 asset and derive scene/caption timing from its real transcript.
- `none`: create a silent video with concise on-screen copy. Keep the caption structure when useful and report the absence of audio truthfully.

For current local Mandarin jobs, declare an explicit `audio.voiceProfile` and display-to-spoken `audio.pronunciationMap`, then use the normal `video voice` command before composition. There is no automatic voice/provider selection. An empty voice remains unresolved. The generated asset is `external-audio` at `assets/narration.wav`; voice and captions keep their real timing evidence. Asset fonts declare their actual `fontFamily` and weight. Layered assets declare real `width`, `height`, child `assetId` and pixel bounds. Every scene has a structured `action` rather than motion prose alone.

These are implementation modes, not equivalent quality approvals. When a task requires Mandarin narration, switching to `none` cannot satisfy it. For R2, retain the requested young adult male, standard Mandarin, warm and natural voice criteria; freeze the accepted audio and timing evidence. Missing paid-service authorization or human listening approval remains outstanding rather than triggering repeated trials or an automatic silent substitute.
