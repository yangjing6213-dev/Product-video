# Dependency risk: adm-zip extraction through destination symlinks

## Current disposition

On 2026-09-13, the project updated only the transitive `adm-zip` resolution from
0.6.0 to 0.6.1 within HyperFrames' existing `^0.6.0` range. Direct dependencies,
HyperFrames 0.8.33, and its CLI bundle are unchanged; no override is used.
The upstream [0.6.1 release](https://github.com/cthackers/adm-zip/releases/tag/v0.6.1)
published on September 11 reports a fix for extraction through symlinks inside
the target directory. Local regression tests verify that all three affected
APIs reject a pre-existing destination junction without modifying the file
outside the extraction root, while ordinary extraction still succeeds.

The real `npm audit --json` changed from **FAIL** (exit 1 before the update) to
**PASS** (exit 0, zero reported vulnerabilities after the update). This is a
dated scanner result, not a guarantee against future advisories. Neither this
document nor the consistency check suppresses or replaces `npm audit`.

At this review, GitHub's advisory
[GHSA-vwc7-r8mq-g2x9](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9)
still listed versions 0.5.9 through 0.6.0 as affected and “None” under patched
versions (last updated September 8). The patch disposition relies on the later
upstream release, the installed source, actual filesystem regressions, and the
fresh scanner result; it does not claim the advisory page has been updated.

The installed and locked dependency chain reviewed here is:

- `hyperframes@0.8.33`
- HyperFrames dependency declaration `adm-zip: ^0.6.0`
- resolved and installed `adm-zip@0.6.1`
- `node_modules/hyperframes/dist/cli.js` SHA-256
  `af57f08331c602ce6b5903945bc2b55a565d6b1ab839a26a0fcefbfa620d033f`

Any change to these versions, the declared range, or the reviewed bundle hash
invalidates this assessment and requires a new review.

## Affected behavior

The advisory applies when `extractAllTo`, `extractAllToAsync`, or
`extractEntryTo` writes through a symbolic link already present in an extraction
destination and overwrite is enabled. This can overwrite a file outside the
intended extraction root.

The reviewed HyperFrames CLI bundle imports the external `adm-zip` package
at line 145382 and dynamically imports the same package at line 205444.
Resolution from the CLI's location reaches the updated top-level installed
package. Inspection found no embedded old `adm-zip` implementation or nested
lockfile resolution. Therefore the patch applies to these runtime imports;
changing the lockfile has not rewritten the HyperFrames bundle.

The bundle contains two `adm-zip` uses:

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

The check returns `PASS_REVIEWED_PATCH` only when the lockfile and both
installed package manifests match the exact reviewed versions, both the locked
and installed dependency ranges and HyperFrames CLI bundle SHA-256 still match, and none of the three
affected API calls appears in the bundle. It returns
`REVIEW_REQUIRED` for version or bundle drift and for a detected affected call.
It reports `rawNpmAuditStatus: NOT_RUN` because this command does not execute
the scanner; the independent `npm audit` command and its exit code must still
be recorded. The patch comes from the dependency upgrade, not this check.

## Required controls and re-evaluation triggers

- Do not treat the patch as a filesystem sandbox. New extraction features need
  their own review of destination ownership, concurrent changes, and trust boundaries.
- Re-run `npm audit` and this check immediately before release.
- Re-evaluate when HyperFrames, `adm-zip`, the lockfile resolution, or the
  HyperFrames CLI bundle changes.
- Re-evaluate if HyperFrames adds any disk extraction call, including a dynamic
  or aliased call that a name scan may not detect.
- Validate upstream patch compatibility through the full test, lint, typecheck,
  HyperFrames, and media QA gates. Do not force a dependency override without
  compatibility evidence.
