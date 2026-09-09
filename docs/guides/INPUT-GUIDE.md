# Input Guide

## What to prepare

Provide either a public product URL or local product screenshots/recordings, plus the product name and one-line description, target audience, one primary problem, up to three feature/benefit pairs, real brand assets, one CTA, output language, and narration choice.

Use paths relative to the input JSON when possible. Windows paths with spaces are supported as JSON strings and must remain quoted when passed to the CLI. Every asset needs an ID, type, path or source URL, license, required flag, and optional fallback.

## Complete template

The values in angle brackets are instructions to replace, not verified product facts.

```json
{
  "schemaVersion": "1.0",
  "projectId": "<lowercase-project-id>",
  "product": {
    "name": "<verified product name>",
    "url": "<credential-free public HTTP(S) product URL>",
    "oneLiner": "<one verified sentence describing the product>",
    "targetAudience": ["<primary audience>"],
    "primaryProblem": "<one verified problem>",
    "valueProposition": "<verified result or product value>",
    "features": [
      {
        "name": "<feature name>",
        "benefit": "<user benefit supported by evidence>",
        "evidenceAssetIds": ["product-screen-01"]
      }
    ],
    "proofPoints": [],
    "cta": {
      "label": "<single action>",
      "url": "<verified destination>"
    }
  },
  "brand": {
    "logoAssetId": "brand-logo",
    "colors": ["#101828", "#FFFFFF", "#2E90FA"],
    "fontFamilies": ["<available brand font>", "<available fallback>"],
    "motionTone": "technical",
    "canvas": "dark",
    "mustAvoid": ["<brand treatment to avoid>"]
  },
  "assets": [
    {
      "id": "brand-logo",
      "type": "logo",
      "path": "input assets\\brand logo.svg",
      "sourceUrl": "<source URL or documented local origin>",
      "license": "owned",
      "required": true,
      "fallbackAssetId": null
    },
    {
      "id": "product-screen-01",
      "type": "screenshot",
      "path": "input assets\\product screen.png",
      "sourceUrl": "<source URL or documented local origin>",
      "license": "authorized",
      "required": true,
      "fallbackAssetId": null
    }
  ],
  "output": {
    "locale": "zh-CN",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "targetDurationSec": 45,
    "quality": "standard"
  },
  "audio": {
    "narrationMode": "none",
    "voice": "<verified HyperFrames voice or NONE>",
    "externalAudioAssetId": null,
    "musicAssetId": null
  },
  "captions": {
    "enabled": true,
    "maxLines": 2,
    "safeAreaPercent": 7,
    "style": "brand-minimal"
  }
}
```

## Validation rules

- Use at most three `features` in the video.
- Do not add proof points without a source and permission to use them.
- `owned` and `authorized` assets can enter final; `unknown` assets cannot.
- A required local asset must exist, or its `fallbackAssetId` must resolve to another licensed asset.
- Private/login-only pages, paywalls, and CAPTCHA-protected pages are outside automatic capture.
- A non-empty `product.url` must be a credential-free HTTP(S) URL. It may be empty when licensed supplied visuals provide the product evidence; use `--supplied-only` to avoid a URL capture attempt. `product.cta.url` remains required and must be credential-free HTTP(S).
- Default capture uses the local HyperFrames `capture` command and automatically falls back to `supplied-assets` on failure. Pass `--supplied-only` to skip URL capture; the command fails if no usable licensed supplied visual exists.
- `hyperframes` narration requires current voice-list evidence for the target locale. `external-audio` requires an authorized audio asset. `none` is a truthful silent path.
- Input `output.quality` accepts `draft`, `standard`, or `high`, but the direct render command accepts only `--quality draft` and `--quality high`.

## Start and resume

```powershell
npm run video -- init --input "C:\path with spaces\product-input.json"
npm run video -- verify-input --project <projectId>
npm run video -- capture --project <projectId> --supplied-only
npm run video -- render --project <projectId> --quality draft
npm run video -- render --project <projectId> --quality high --resume
npm run video -- run --project <projectId> --resume
```

If npm is not on PATH, replace `npm` with `node .tools/npm/bin/npm-cli.js`. `verify-input`, `capture`, `qa`, `render`, and `run` support `--resume`; identical-input `init` is idempotent without the flag. A cache hit requires an unchanged fingerprint and every registered output to remain present with matching bytes. A missing or changed output reruns that stage. `reports/run-history.json` preserves the first playable draft timestamp across later renders. Read the resulting JSON reports. A zero exit code and `PASS` report are required before treating a deterministic stage as successful.
