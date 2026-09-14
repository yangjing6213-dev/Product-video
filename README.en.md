# ENHE Product Video Studio

**Your product is ready. What about its introduction video?**

Turn scattered product notes, screenshots and assets into a video that explains what your product does and shows how it works.

[中文](README.md) · [See the example](#5-example) · [Installation](#6-installation) · [ENHE website](https://www.enhe-tech.com.cn/)

## 1. What is this repository?

This is a local product-video tool designed to work with **Codex**. The current version is **0.1.0**.

You provide the product information. Codex follows the repository's Skill to organize the content, write the script and plan the shots. After your approval, HyperFrames handles the animation and rendering, with narration, subtitles and quality checks as part of the workflow.

It brings the story and the production steps together. You can review the copy, adjust the visuals and save an approved plan to continue working on later.

## 2. Who is it for?

### 1. A good fit for

- **Independent developers and product creators** who want people to quickly understand the problem their tool solves.
- **AI content creators** who introduce tools, demonstrate workflows and need to turn scattered notes into a clear video.
- **Solo businesses and small teams** who want to keep their own branding, narration and author information across product videos.
- **People who want to review the result along the way**, starting with the script and key visuals instead of redoing an entire finished video.

### 2. Not a good fit for

- Generating videos in bulk from a single sentence and publishing them automatically without review.
- Anyone looking for a ready-to-use browser video editor, cloud rendering platform or fully managed commercial video service.
- Automatically turning one portrait into film-quality 3D acting, or freely imitating any person's appearance or voice.
- Projects without permission to use the supplied product information, portraits, voices or brand assets.

## 3. What does it produce?

| Output | What it is for |
| --- | --- |
| Promotional video in MP4 format | Introduce a product, demonstrate its workflow and explain the problem it solves |
| Video cover and author outro | Show the topic before playback and present the author and next step at the end |
| Mandarin narration, on-screen subtitles and SRT | Help viewers follow the explanation with or without sound |
| Product summary, copy and storyboard | Review the content before production and keep a reference for later edits |
| Asset manifest and frozen versions | Record the images, audio and plans used so work can continue consistently |
| QA and render reports | Record actual checks and help locate missing assets, layout issues or rendering problems |

The current video specifications support **8–90 seconds at 30 fps**, in **1920×1080 landscape** or **1080×1920 portrait**. Actual duration follows the approved script, measured narration and shot timing. Covers, narration and bilingual copy must be prepared and reviewed during their respective production steps.

## 4. What value does it provide?

- **Explain the product clearly.** Start with the viewer's problem and put the explanation in a useful order, instead of listing features.
- **Review first, then produce.** Approve the copy, voice and key visuals separately to reduce full-video rework.
- **Keep your own identity.** Reuse approved branding, narration and author information while giving each product its own story.
- **Continue after an edit.** Save assets and task state so unchanged, verified work can be reused.
- **Know what still needs fixing.** Use actual checks and reports to judge completion. A generated file is not the same as an approved video.

![Turn scattered materials into a clear product story and user goal](https://raw.githubusercontent.com/yangjing6213-dev/Product-video/main/docs/showcase/value-product-story.png)

![Review the storyboard before production to reduce rework](https://raw.githubusercontent.com/yangjing6213-dev/Product-video/main/docs/showcase/value-review-before-production.png)

![Verify first, reuse unchanged work and redo what has changed](https://raw.githubusercontent.com/yangjing6213-dev/Product-video/main/docs/showcase/value-reuse-verified-work.png)

![Review the finished video and deliver after checking it](https://raw.githubusercontent.com/yangjing6213-dev/Product-video/main/docs/showcase/value-check-before-delivery.png)

## 5. Example

### 62 seconds: from a product introduction to a promotional video

This video introduces ENHE Product Video Studio. It includes an opening cover, product explanation, character and workflow demonstrations, the website call to action and an author outro.

[![ENHE Product Video Studio cover: Your product is ready. What about its video?](https://raw.githubusercontent.com/yangjing6213-dev/Product-video/main/docs/showcase/enhe-studio-cover.png)](https://github.com/yangjing6213-dev/Product-video/raw/refs/heads/main/docs/showcase/enhe-studio-demo-62s.mp4)

**[Download the full 62-second video (MP4)](https://github.com/yangjing6213-dev/Product-video/raw/refs/heads/main/docs/showcase/enhe-studio-demo-62s.mp4)**

Click the cover or the link above to download and watch the full video. GitHub displays the cover here; the video is available as a download.

Background music: [Electric Dreams](https://www.scottbuckley.com.au/library/electric-dreams/) by [Scott Buckley](https://www.scottbuckley.com.au/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The video uses an excerpt with volume adjustments and fades.

The example contains AI-assisted visuals and synthetic narration and has been reviewed by the author. It shows a completed, reviewed production. The public repository does not include the full private brand library, reference recordings or local models, so a fresh installation will not automatically reproduce this exact video. See the [showcase asset notice](https://github.com/yangjing6213-dev/Product-video/blob/main/docs/showcase/NOTICE.md) for the permitted use of these assets.

## 6. Installation

**Windows x64** is the currently verified local platform. You will need:

- Git.
- Node.js **24.15 or later** and npm.
- A Codex environment that can read local project files and use Skills.

### 1. Get the project and install dependencies

```powershell
git clone https://github.com/yangjing6213-dev/Product-video.git
cd Product-video
npm ci
```

### 2. Prepare the local rendering tools

```powershell
node scripts/setup-local.mjs
```

This script downloads missing pinned versions of Chrome and FFmpeg and verifies the required tools. It writes only within the project, does not change the system PATH or registry and does not require administrator access.

To check tools that are already installed without downloading them:

```powershell
node scripts/setup-local.mjs --verify-only
```

See the [Windows local setup guide](docs/guides/LOCAL-SETUP.md) for details and download sources. Mandarin narration is a separate, optional setup that requires a local Python environment and the appropriate models; see the [local Chinese narration guide](docs/guides/CHINESE-TTS.md). Models and voice reference files are not included in the repository.

Some existing workspaces provide `node .tools/npm/bin/npm-cli.js` as a fallback npm entry point. That file is not distributed in this repository or supplied by the setup script. A fresh installation still requires npm on your computer.

### 3. Ask Codex to read the project Skill

Open this project in Codex and ask it to read [skills/enhe-product-video/SKILL.md](skills/enhe-product-video/SKILL.md) and its references. There is no need to install a global Skill first.

## 7. How to use it

### 1. Prepare the product information

Provide the project name, a public URL or local screenshots, and explain **who it is for, what problem it solves, which features matter most and what you want viewers to do next**. Add logos, portraits and other assets you have permission to use, along with the desired aspect ratio and duration.

Each new video starts by asking which portrait to use on the cover and author outro. If you do not supply one, the workflow uses the authorized local default. If you provide a new portrait, both places are updated together. A fresh clone does not contain the private default portrait; supply or configure your own assets.

### 2. Start in Codex

You can use this request and add your product information:

```text
Read skills/enhe-product-video/SKILL.md in this repository and follow the project rules to create a product introduction video.

First, use my materials to identify the product's purpose, user pain points and features to demonstrate.
Show me the full copy and storyboard for approval before production.
Keep the approved visual style for the cover and author outro; first ask whether I want to provide a portrait.
For each new video, choose a real-world background scene that suits the product and differs from previous tasks.
After generation, check subtitles, layout, assets, sound and the finished video, then provide the actual files and QA results.
```

See the [input guide](docs/guides/INPUT-GUIDE.md) for fields and templates, and the [cover and author outro rules](docs/guides/AUTHOR-FRAMING.md) for portrait and framing requirements.

### 3. Approve the copy, voice and visuals

Approve the full narration, on-screen text and subtitles first, then review the voice and key frames. Approved recordings that have not changed should be reused. Replacing a portrait does not automatically change the narration or author contact information.

### 4. Generate, review and continue editing

Once Codex has prepared the input, assets, storyboard and animation files, the project commands handle validation, rendering and reports. To see the available commands:

```powershell
npm run video -- help
```

For a prepared task, continue with these commands, replacing `your-project-id` with its actual task ID:

```powershell
npm run video -- qa --project your-project-id
npm run video -- render --project your-project-id --quality draft
npm run video -- run --project your-project-id --resume
```

The video and reports are saved under `projects/<projectId>/`. High-quality rendering also requires the task's current asset, copy, visual and voice approvals. The commands do not write the storyboard for Codex or approve the result on your behalf.

<details>
<summary>More commands: supplied assets, high-quality export and resume</summary>

Use only supplied local assets and skip URL capture:

```powershell
npm run video -- capture --project your-project-id --supplied-only
```

Export a high-quality version after the current plan has received actual visual and voice approval:

```powershell
npm run video -- render --project your-project-id --quality high --resume
```

`verify-input`, `capture`, `qa`, `render` and `run` support `--resume`. Existing results are reused only when the input and every registered output have unchanged bytes. Missing or changed data causes the corresponding stage to run again. Without `--supplied-only`, capture attempts the public URL and falls back to supplied assets if capture fails. Use the positional command `help`, not `--help`.

</details>

## 8. Project workflow

1. **Understand the product:** read the materials and identify the audience, pain point and one main goal.
2. **Choose the assets:** confirm brand, portrait and voice sources, and select a suitable new scene for the video.
3. **Approve the content:** review the full narration, on-screen text, subtitles and storyboard.
4. **Approve the visual and voice direction:** check the cover, author outro, key shots and narration.
5. **Produce and render:** freeze the approved assets and create the video with HyperFrames.
6. **Review the finished video:** check subtitles, layout, sound, duration and assets against the requirements.
7. **Deliver and reuse:** keep the video, asset versions and reports. Resuming the same task must not randomly change its portrait, scene or voice.

## 9. Project structure

```text
Product-video/
├─ README.md                    # Chinese project guide
├─ README.en.md                 # English project guide
├─ skills/enhe-product-video/    # Codex video workflow and rules
├─ src/                         # Commands, orchestration and quality checks
├─ scripts/                     # Local tools, assets and narration helpers
├─ schemas/                     # Input and video specification schemas
├─ recipes/                     # Video production recipes
├─ prompts/                     # Creative and review prompts
├─ tests/                       # Project tests
├─ docs/
│  ├─ guides/                   # Setup, usage and quality guides
│  ├─ architecture/             # Architecture and project scope
│  ├─ security/                 # Dependency risk notes
│  └─ showcase/                 # Approved illustrations, video and author image
├─ .github/workflows/           # GitHub automated checks
├─ LICENSE                      # Apache-2.0 software license
└─ THIRD_PARTY_NOTICES.md        # Third-party and showcase asset notices
```

The workflow also uses local directories such as `projects/`, `.tools/` and `.cache/`. The private brand library lives under `assets/brand/enhe/`; original assets, voice references and task records are not distributed with the public source.

## 10. Important notes

- **This is a local workflow, not a one-click cloud generator.** Codex creates the copy, storyboard and visuals according to the Skill; the CLI runs repeatable production steps.
- **Approve the copy before generating a video.** Review the visuals, sound and asset rights before publishing.
- **Paid APIs and cloud services are not enabled by default.** The default workflow does not use Remotion, ElevenLabs, Captions AI, cloud rendering, databases, a Job API or object storage.
- **Public examples are not a free asset pack.** The code uses [Apache-2.0](LICENSE). Portraits, brands, voices and third-party content have separate rights, described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Keep private information out of public repositories.** Tokens, cookies, unredacted screenshots, voice references and private assets stay local.
- **A new scene must preserve the approved style.** New videos use different real-world backgrounds; resumed tasks retain their original portrait, scene and frozen versions.
- **Back up the local assets too.** Saving only Git-tracked files cannot restore ignored brand libraries, models or task assets.
- **Other operating systems have not completed local toolchain verification.** Check the project documentation for actual platform and automated-check coverage.

Development checks:

```powershell
npm run lint
npm run typecheck
npm run check:dependency-risk
npm test
```

There is no separate compilation build step, and a coverage command is not configured. See the [benchmark guide](docs/guides/BENCHMARK-GUIDE.md) for full validation requirements, [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance and [SECURITY.md](SECURITY.md) for reporting security issues.

## 11. Related projects

None.

## 12. About the author

![About the author: Enhe](https://raw.githubusercontent.com/yangjing6213-dev/Product-video/main/docs/showcase/about-author.png)

### Enhe（恩禾） | Product Designer · Solo Company Practitioner · AI Builder

**Building a one-person company with AI.**

- GitHub: [yangjing6213-dev](https://github.com/yangjing6213-dev)
- X / Twitter: [@Amenenhe_ai](https://x.com/Amenenhe_ai)
- Website: [www.enhe-tech.com.cn](https://www.enhe-tech.com.cn/)
- WeChat: `Hu-Amen`
- Email: **amen.enhe@gmail.com**

[ENHE AI | AI tools, news, account services and skills courses](https://www.enhe-tech.com.cn/)

## 13. Keep exploring

This project is one of the tools in my personal creation system built with AI.

If you also use AI for content, knowledge bases or workflows, or want to turn an idea into a product, visit [www.enhe-tech.com.cn](https://www.enhe-tech.com.cn/) for more resources.

**Visit ENHE for more AI tools and solutions.**
