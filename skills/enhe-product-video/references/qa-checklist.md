# QA checklist

Current jobs follow [GENERATOR-QUALITY.md](../../../docs/guides/GENERATOR-QUALITY.md) over historical R2 examples: no IP, transparent captions, actual subject actions, website primary CTA, and the complete five-item secondary author contact block. Verify actual final DOM, small-player type size, six-second minimum contact scene time and practical human readability. `video release-check` is local readiness only and separates engineering, visual, voice, audience and final acceptance. A/B/C cover two products; a locked independent real-product holdout is additional evidence, never an inferred PASS.

Use current command output and generated files as evidence. A check that did not run is `NOT_RUN`; a static reference test is not end-to-end video verification.

## Cover and author framing gate

For new jobs, [AUTHOR-FRAMING.md](../../../docs/guides/AUTHOR-FRAMING.md) takes precedence over historical no-portrait/fixed-poster examples. Verify the recorded default/supplied person choice, actual authorized source, matching identity in both images, and the locked `enhe-cinematic-glass-v1` style. Check semantic scene distinctness against private history (a crop, color change or new filename is not a new scene), and unchanged frozen bytes on resume. Verify cover poster visibility, complete reviewed bilingual copy and author contacts; preserve the voice. Missing defaults or unreadable supplied images cannot pass. Report person selection, style, scene distinctness, cover/ending identity and user acceptance separately; document tests do not prove actual image quality.

## Input and provenance gate

- Product input and `video-spec.json` validate against their schemas.
- Every required asset exists or resolves to a licensed fallback.
- Every final asset is `owned` or `authorized`; `license=unknown` blocks final.
- Product statements, proof points, CTA, and brand choices map to evidence.
- Before new speech/video generation, `copy-script.json` and the latest actual user decision bind this video's identity, complete approved words, and copy hash. A rejection, missing decision, changed text or transferred approval blocks generation. Identical historical video caches may be read without fabricated retrospective decisions.
- New quality plans bind `copy.sha256`; the actual narration text source must match `narration.textHash` and the approved words. Spoken subtitle cues bind the copy/audio hashes and match approved subtitle words. Independently inspect browser-visible screen text, including author ending and CTA, against the approved copy; arbitrary HTML, CSS, canvas, SVG, or text embedded in images cannot be semantically verified by a file hash alone.
- Reports contain no secret, cookie, private data, or public-facing absolute local path.

## Library, migration, and freeze gate

- A complete source inventory records names, subdirectories including empty ones, sizes, and SHA-256. Source, staging, and formal originals were reread and matched; original bytes were never transformed or overwritten.
- Temporary fixtures cover name conflicts, same-content reuse, interrupted copies, changed sources, bad hashes, missing sources, links, and repeated stable IDs. Do not use real assets for fault injection.
- Source cleanup is separately evidenced: valid receipt and full target verification, an actual project-library render proof, actual FFprobe/FFmpeg decode, and source/target locks during final hash checks and per-file deletion. Changed or inaccessible sources remain. No recursive source deletion is permitted.
- Missing source without a valid receipt is a failure to verify migration, not `ALREADY_MIGRATED`. Do not credit externally performed deletion to this workflow. Another source location has its own cleanup authorization boundary.
- Catalog IDs, original/prepared relationships, relative paths, rights, roles, poses, embedded text, and review states are correct. Actual alpha pixels distinguish opaque RGBA from transparency; unavailable metadata stays `null`.
- Every selected version is individually `APPROVED`; no bulk default approval. Selected hash means prepared hash when a prepared path exists, otherwise original hash.
- Every new input has `brandLibrary`, and `frozen-brand-assets.json` matches immutable job copies. Rebuilding/updating the library does not change a resumed old job. Corrupt frozen bytes fail visibly.
- A project relocated into a temporary path containing Chinese characters and spaces can resolve frozen assets and render without the former source folder.
- Apache-2.0 covers owned software/Skill/technical documentation. Brand rights are separate. Public Git/npm/Skill file lists exclude unauthorized brand originals, derivatives, author images, previews, catalog, and private migration records.
- Full private backup includes ignored brand files, every retained video, plans, `.tools`, and `.git`, with a reread ZIP/hash manifest. Windows paths over 260 characters remain readable without system changes. Explicitly excluded rebuildable directories and the narrowly validated dependency links described in the IP library guide are listed. Other unfollowed links or changing source files mean `PARTIAL`, not a complete backup.

## Composition gate

- The product name or core result is readable within three seconds.
- Existing whole-film MVP specifications have 5–8 scenes; quality samples and other deliverables follow their own duration/scene contract. Each scene has one communication goal and a purposeful transition.
- Static layout is correct before finite entrance animation; no random, clock-dependent, async-built, or infinite timeline exists.
- UI receives a purposeful crop/pan/zoom/mask/focus treatment and stays readable.
- Captions use at most two lines, remain inside the safe area, and do not cover focal UI or CTA.
- The last scene retains visible content through the final frame; no unexplained black or blank tail exists.
- Title typography uses the reviewed display font; body and subtitles remain legible. Verify the actually loaded font, its license, glyph coverage, and the intended weight.
- Use the original company Logo and semantically chosen IP, with measured transparency and appropriate cropping. Never redraw a substitute or decorate every scene by default.
- The author ending uses the complete five-item editable contact text and graphic layers; it is not a full flattened poster. Do not require or add a portrait or full CV unless the current user explicitly authorizes it.
- Compare each product's story, composition, shot sequence, and pacing. Merely changing a name, image, and color in one whole-video template does not meet R2.

## Tool and media gate

- HyperFrames lint, validate, and inspect complete successfully; each warning is repaired or specifically explained.
- Draft render is playable and its contact sheet has been reviewed.
- Whole-film MVP media decodes, is 1920x1080 at 30fps, lasts 30–60 seconds, and contains a video stream. R2 library smoke is 3–5 seconds; M1 motion is 8–12 seconds; approved later horizontal/vertical deliverables follow their specific contract. Probe each actual output against its own specification.
- Required narration includes an audio stream, synchronized transcript, and acceptable silence analysis.
- Quality rendering enforces one static frozen narration audio source using parsed DOM and executed frame seeks; undeclared tracks, nested sources and scripted media are unsupported. Verify the actual source and bytes against the plan, not just the plan declaration. This finite runtime audit is not a proof of arbitrary asynchronous JavaScript.
- Every legacy transcript route, including external audio without phrase cues and ASR, matches approved subtitle words with line breaks as the only normalization. Local TTS consumes an approved input snapshot and rechecks current approval/input hashes immediately before exclusive publication; rejection or input changes preserve staging and block formal output.
- Required narration evidence binds the final audio, transcript, subtitle/cue file, and authored script with recorded SHA-256 values across `voice-report.json`, `narration-artifact-check.json`, or equivalent actual reports; verify those hashes against the delivered files.
- Inspect playback at phrase midpoints, phrase and scene boundaries, and after a reverse seek across at least two boundaries. Captions must enter, clear, and reappear with the matching audio after seeking in either direction.
- Listening review is a separate gate. If no person actually listened to the complete final audio, record human 听审 as `NOT_RUN`; package checks, waveform checks, or model review cannot turn it into `PASS`.
- For R2, human voice review checks the requested young adult male, standard Mandarin, natural fluency, warmth, and absence of mechanical or exaggerated sales delivery. A backend's voice label is not proof of perceived quality. Bind accepted voice/audio, plan, and visual/motion artifacts to their hashes and invalidate affected acceptance after changes.
- `narrationMode=none` is intentionally silent and must not fail only because no audio stream exists.
- Media probe, black-frame, and applicable silence checks use actual FFprobe/FFmpeg evidence.

## Score and report gate

The historical MVP benchmark thresholds are total score 80 or higher, clarity 14/20 or higher, brand consistency 11/15 or higher, UI/asset readability 11/15 or higher, rendering reliability 10/10, all hard gates successful, and manual correction time at or below 30 minutes from first playable draft to final. These do not supersede R2 quality acceptance or make an earlier rejected video accepted.

R2 M1 requires user acceptance of the presented visual directions, motion sample, and voice choice before M2 production. Keep unaccepted candidates out of permanent Skill defaults. Report `MIGRATION`, `IP_LIBRARY`, `ENGINEERING_QA`, `VISUAL_REVIEW`, `VOICE_REVIEW`, and `USER_ACCEPTANCE` separately using `PASS`, `PARTIAL`, `FAIL`, or `NOT_RUN`. Identify model review versus human review; leave a human score unassigned when no human score exists. Library/engineering PASS cannot conceal outstanding visual or voice acceptance. Keep batch production and publication disabled unless separately authorized.

Preserve actual commands, exit codes, timings, hashes, artifact paths, warnings, and remaining risks in JSON reports. Do not claim `PASS` for an unavailable or skipped gate.

For the editorial visual version, check the horizontal three-card, vertical three-card and four-feature layouts at every focus and after reverse seeking. A text element can fit its own box yet be cut off by a rounded ancestor: test both. Inspect full-resolution export frames for image occupancy and safe crops. With reviewed `authorRegions`, check source dimensions/coordinates, equal x/y scale, all five contact lines and the complete information panel; retain the strict whole-image checks for historical contain-mode posters. A preserved voice hash is engineering evidence; user voice acceptance is a separate record. Full regressions, the new real-product holdout and user comprehension testing remain NOT_RUN until actually performed.
