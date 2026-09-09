# QA checklist

Use current command output and generated files as evidence. A check that did not run is `NOT_RUN`; a static reference test is not end-to-end video verification.

## Input and provenance gate

- Product input and `video-spec.json` validate against their schemas.
- Every required asset exists or resolves to a licensed fallback.
- Every final asset is `owned` or `authorized`; `license=unknown` blocks final.
- Product statements, proof points, CTA, and brand choices map to evidence.
- Reports contain no secret, cookie, private data, or public-facing absolute local path.

## Composition gate

- The product name or core result is readable within three seconds.
- There are 5–8 scenes, one communication goal per scene, and a real transition at each boundary.
- Static layout is correct before finite entrance animation; no random, clock-dependent, async-built, or infinite timeline exists.
- UI receives a purposeful crop/pan/zoom/mask/focus treatment and stays readable.
- Captions use at most two lines, remain inside the safe area, and do not cover focal UI or CTA.
- The last scene retains visible content through the final frame; no unexplained black or blank tail exists.

## Tool and media gate

- HyperFrames lint, validate, and inspect complete successfully; each warning is repaired or specifically explained.
- Draft render is playable and its contact sheet has been reviewed.
- Final media decodes, is 1920x1080 at 30fps, lasts 30–60 seconds, and contains a video stream.
- Required narration includes an audio stream, synchronized transcript, and acceptable silence analysis.
- Required narration evidence binds the final audio, transcript, subtitle/cue file, and authored script with recorded SHA-256 values across `voice-report.json`, `narration-artifact-check.json`, or equivalent actual reports; verify those hashes against the delivered files.
- Inspect playback at phrase midpoints, phrase and scene boundaries, and after a reverse seek across at least two boundaries. Captions must enter, clear, and reappear with the matching audio after seeking in either direction.
- Listening review is a separate gate. If no person actually listened to the complete final audio, record human 听审 as `NOT_RUN`; package checks, waveform checks, or model review cannot turn it into `PASS`.
- `narrationMode=none` is intentionally silent and must not fail only because no audio stream exists.
- Media probe, black-frame, and applicable silence checks use actual FFprobe/FFmpeg evidence.

## Score and report gate

A benchmark passes only at total score 80 or higher, clarity 14/20 or higher, brand consistency 11/15 or higher, UI/asset readability 11/15 or higher, rendering reliability 10/10, all hard gates successful, and manual correction time at or below 30 minutes from first playable draft to final.

Preserve actual commands, exit codes, timings, hashes, artifact paths, warnings, and remaining risks in JSON reports. Do not claim `PASS` for an unavailable or skipped gate.
