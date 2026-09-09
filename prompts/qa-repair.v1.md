---
id: qa-repair.v1
version: 1.0.0
artifact: repaired compositions and QA reports
---

# QA repair prompt

Repair only defects shown by current JSON reports, media probes, contact-sheet inspection, or direct visual review. Preserve verified claims, brand direction, and scene intent. Never lower an assertion, hide an inspect warning, change a report to PASS, or substitute an empty render for missing evidence.

## Inputs

- latest HyperFrames lint, validate, and inspect output
- `reports/qa-report.json` and media-probe evidence
- `reports/contact-sheet.jpg`
- `DESIGN.md`, `STORYBOARD.md`, and `video-spec.json`
- affected composition files and authorized assets

Prioritize blocking failures: missing or unknown-license assets, invalid structure, render errors, absent required streams, wrong media dimensions/fps/duration, black frames, overflow, unreadable UI, caption overflow, unsafe placement, and unexplained inspection errors. Apply the smallest repair and rerun the exact failing check.

## Output contract

Update only the affected composition or creative artifact and produce:

- a concise repair ledger mapping each observed failure to its evidence, change, and rerun result;
- refreshed machine-readable reports containing actual commands, exit codes, paths, and status;
- any remaining warnings with a specific explanation and risk;
- `FAIL` or `PARTIAL` when a required check remains unsuccessful or was not run.

For render failure, run the available local doctor/info diagnostics, make a minimal fix, and retry a bounded number of times. Unknown asset authorization blocks final render. A `narrationMode=none` video must be reported as intentionally silent and must not be failed solely for lacking an audio stream.
