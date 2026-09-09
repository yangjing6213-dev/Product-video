# Dependency risk: adm-zip extraction through destination symlinks

## Current disposition

The dependency audit remains **FAIL**. This record does not suppress or replace
`npm audit`, and it does not claim that the vulnerability is fixed.

On 2026-09-09, GitHub's reviewed advisory
[GHSA-vwc7-r8mq-g2x9](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9)
listed `adm-zip` versions 0.5.9 through 0.6.0 as affected and listed no patched
version. The [npm package versions](https://www.npmjs.com/package/adm-zip?activeTab=versions)
listed 0.6.0 as the latest release. This project therefore cannot resolve the
finding by selecting an available fixed `adm-zip` version.

The installed and locked dependency chain reviewed here is:

- `hyperframes@0.8.33`
- HyperFrames dependency declaration `adm-zip: ^0.6.0`
- resolved `adm-zip@0.6.0`
- `node_modules/hyperframes/dist/cli.js` SHA-256
  `af57f08331c602ce6b5903945bc2b55a565d6b1ab839a26a0fcefbfa620d033f`

Any change to these versions, the declared range, or the reviewed bundle hash
invalidates this assessment and requires a new review.

## Affected behavior

The advisory applies when `extractAllTo`, `extractAllToAsync`, or
`extractEntryTo` writes through a symbolic link already present in an extraction
destination and overwrite is enabled. This can overwrite a file outside the
intended extraction root.

The reviewed HyperFrames CLI bundle contains two `adm-zip` uses:

- lines 145699–145707 build a publication archive in memory using `addFile`,
  `getEntries`, and `toBuffer`;
- lines 205445–205451 read a `.lottie` archive from a buffer using `getEntries`
  and `getData`.

The reviewed bundle contains no call to the three affected extraction APIs. The
application invokes HyperFrames commands for capture, inspection, rendering,
media tooling, and optional narration; it does not expose a separate disk ZIP
extraction operation. This is a narrow call-path assessment of the exact bundle,
not a runtime sandbox. It does not prevent a future dependency build from
adding another or dynamically dispatched extraction path.

## Evidence-consistency check

Run:

```powershell
npm run check:dependency-risk
```

The check returns `PASS_WITH_DOCUMENTED_RISK` only when the lockfile and both
installed package manifests match the exact reviewed versions, both the locked
and installed dependency ranges and HyperFrames CLI bundle SHA-256 still match, and none of the three
affected API calls appears in the bundle. It returns
`REVIEW_REQUIRED` for version or bundle drift and for a detected affected call.
This check preserves `rawNpmAuditExpectedToPass: false`; it is not a replacement
for an advisory scanner or a vulnerability fix.

## Required controls and re-evaluation triggers

- Do not add an application feature that extracts untrusted ZIP content to a
  filesystem destination while this dependency remains affected.
- Re-run `npm audit` and this check immediately before release.
- Re-evaluate when HyperFrames, `adm-zip`, the lockfile resolution, or the
  HyperFrames CLI bundle changes.
- Re-evaluate if HyperFrames adds any disk extraction call, including a dynamic
  or aliased call that a name scan may not detect.
- Prefer an upstream patched release once one exists and compatibility has been
  validated through the full test, lint, typecheck, HyperFrames, and media QA
  gates. Do not force a dependency override without that compatibility evidence.
