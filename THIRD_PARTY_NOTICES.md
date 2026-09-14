# Third-Party Notices

This project includes or interoperates with third-party software. The Apache
License 2.0 in `LICENSE` applies only to original material in this repository.
It does not replace the licenses, terms, notices, trademark rights, model
licenses, voice rights, or content rights of third parties.

## JavaScript dependencies

The versions below are pinned in `package.json` and `package-lock.json`.

| Component | Version | License or terms | Upstream |
| --- | ---: | --- | --- |
| Ajv | 8.20.0 | MIT | <https://github.com/ajv-validator/ajv> |
| GSAP | 3.14.2 | GSAP Standard “No Charge” License; this is a separate, non-Apache license with permitted-use restrictions | <https://gsap.com/standard-license/> |
| HyperFrames | 0.8.33 | Apache-2.0 | <https://github.com/heygen-com/hyperframes> |
| Puppeteer Core | 25.10.0 | Apache-2.0 | <https://github.com/puppeteer/puppeteer> |
| ffprobe-static | 3.1.0 | MIT for the npm wrapper/package; an installed FFprobe executable remains subject to the applicable FFmpeg build license | <https://github.com/joshwnj/ffprobe-static> |
| TypeScript | 7.0.2 | Apache-2.0 | <https://github.com/microsoft/TypeScript> |
| Node.js type definitions | 26.5.0 | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |

Each component’s transitive dependencies remain under their own licenses.
Nothing in this repository relicenses those dependencies. In particular, GSAP
is distributed under its own Standard License and is not licensed under
Apache-2.0 by this project. Review the GSAP terms before using this project in a
product that allows users to build animations visually or otherwise falls
outside the permitted uses in that license.

## Optional local Mandarin speech toolchain

The repository contains scripts and configuration for an optional local speech
workflow. It does not distribute the Python environment, model files, voice
files, browsers, FFmpeg/FFprobe executables, or other downloaded binaries.
Users who install that toolchain obtain its components from their upstream
sources and are responsible for the corresponding license terms.

The principal components used by the verified local setup are:

| Component | Verified local version | License | Upstream |
| --- | ---: | --- | --- |
| kokoro-onnx | 0.6.1 | MIT | <https://github.com/thewh1teagle/kokoro-onnx> |
| Kokoro-82M model | v1.1 Chinese ONNX files | Apache-2.0 for the upstream model | <https://huggingface.co/hexgrad/Kokoro-82M> |
| Misaki | 0.9.4 | Apache-2.0 | <https://github.com/hexgrad/misaki> |
| ONNX Runtime | 1.29.0 | MIT | <https://github.com/microsoft/onnxruntime> |
| SoundFile | 0.14.0 | BSD-3-Clause for the Python package; its libsndfile dependency has separate terms | <https://github.com/bastibe/python-soundfile> |
| phonemizer | 3.4.0 | GPL-3.0-or-later | <https://github.com/bootphon/phonemizer> |
| eSpeak NG | installed through the local speech toolchain | GPL-3.0-or-later | <https://github.com/espeak-ng/espeak-ng> |

The complete optional Python dependency set is pinned in
`scripts/requirements-tts.txt`; every package and transitive dependency keeps
its own upstream license. Model licensing does not by itself grant rights in a
particular generated voice, dataset, trademark, or input text.

The optional local Qwen narration workflow uses
[`qwen-tts` 0.1.1](https://github.com/QwenLM/Qwen3-TTS), the historical
[`Qwen3-TTS-12Hz-1.7B-CustomVoice`](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)
audition model, and the explicitly selected
[`Qwen3-TTS-12Hz-1.7B-Base`](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base)
reference-voice model, under their upstream Apache-2.0 licenses. Actual model
revisions, voice authorization and selected parameters are frozen in local
task evidence. Environments, dependency inventories, model weights, reference
voices, approvals, auditions and generated recordings are excluded from source
packages. Transitive dependencies retain their own terms. Code/model licensing
does not authorize use or imitation of an individual's voice; supply a reference
with the necessary rights and explicitly approve its intended use.

## Assets, examples, and generated media

The public source distribution excludes `projects/`, `benchmarks/`,
`artifacts/`, `reports/`, `.tools/`, `.cache/`, and `node_modules/`. These local
directories may contain product captures, logos, screenshots, audio, rendered
videos, command evidence, downloaded tools, or model files. They are not
covered by the project’s Apache-2.0 license and must not be copied into a public
release without separate rights review.

Product and company names, logos, marks, and third-party visual material remain
the property of their respective owners. Their appearance in local examples or
tests does not imply endorsement and does not grant trademark, advertising, or
redistribution rights.

`docs/creative/zh-narration-scripts.json`, when included in a source release,
contains project-authored example narration text only. It does not include or
license the related product assets, synthesized voices, audio, screenshots, or
rendered videos, and it grants no rights in third-party names or marks.


## Explicitly approved GitHub showcase

The repository owner has separately approved the final author image, video
cover and 62-second demonstration in `docs/showcase/` for public display in
this repository and its README. These three selected files are not reusable
Apache-2.0 media assets. See the [showcase notice](https://github.com/yangjing6213-dev/Product-video/blob/main/docs/showcase/NOTICE.md)
for the exact scope, music credit, modifications and other asset terms.
The npm pack file allowlist still excludes these media files; the
private brand library, voice references, source images and other videos remain
excluded from public distribution.

## Distribution boundary

This source release does not vendor or redistribute third-party executable
binaries, model weights, voice files, package installation directories, or
private locally generated product media. If a future release adds any such material,
its license, required notices, source-code obligations, and content rights must
be reviewed before distribution.
# CI-only media tooling

The CI workflow uses the standard GitHub-hosted Windows image's installed Google Chrome, subject to its existing terms. It installs the hash-pinned Windows wheel of [imageio-ffmpeg 0.6.0](https://pypi.org/project/imageio-ffmpeg/0.6.0/); the Python wrapper is BSD-2-Clause. That wheel's FFmpeg 7.1 binary reports GPL version 3 or later and retains its upstream terms. These tools run only on the ephemeral CI runner; this repository and its npm package do not redistribute their binaries. The production local toolchain is unchanged.
