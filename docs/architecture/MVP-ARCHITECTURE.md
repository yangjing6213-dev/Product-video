# MVP Architecture

## 决策

首版采用本地 HyperFrames-first 工作流，并提供显式选择的本地 Remotion 渲染模式。创意判断由 Codex 完成，CLI 只执行可重复、可记录的确定性步骤。两种渲染器共享输入、文案确认、素材冻结、旁白、字幕、QA 和断点恢复；只有合成与渲染适配器不同。这样保留历史兼容性，同时避免把云架构、Job API 或第二套 Agent 系统引入 MVP。

```mermaid
flowchart LR
  I[Product input and licensed assets] --> V[Local CLI: schema, path, license preflight]
  V --> C[Capture and evidence manifest]
  C --> A[Codex: summary, design, script, storyboard, video spec]
  A --> H[Codex: shared video spec]
  H --> HF[HyperFrames + GSAP composition]
  H --> RM[Remotion React composition]
  HF --> Q[Local CLI: renderer QA, media QA]
  RM --> Q
  Q --> R[Selected local renderer]
  R --> E[JSON reports, contact sheet, scorecard, MP4]
  S[Run state, hashes, cache] <--> V
  S <--> C
  S <--> Q
  S <--> R
```

## Responsibilities

| Area | Owner | Observable output |
|---|---|---|
| Product facts and message | Codex | `PRODUCT-SUMMARY.md`, claim/evidence map |
| Brand and creative direction | Codex | `DESIGN.md`, `SCRIPT.md`, `STORYBOARD.md` |
| Scene contract and visual implementation | Codex | `video-spec.json`, selected composition |
| Validation and orchestration | Local CLI | nonzero failures, `run-state.json`, structured JSON reports |
| HTML animation and render | HyperFrames 0.8.33 (default) or Remotion 4.0.529 (opt-in) | renderer-specific reports, draft/final MP4 |
| Media verification | FFprobe/FFmpeg plus independent visual review | media checks, contact sheet, QA report, scorecard with explicit reviewer type |

The CLI does not generate creative content, call Codex, or hide external service calls. HTML compositions remain the visual source of truth.

## Local provider boundary

- Capture: local HyperFrames `capture`, with automatic `supplied-assets` fallback; `--supplied-only` skips URL capture.
- Narration: verified HyperFrames TTS, authorized `external-audio`, or `none`.
- Render: `hyperframes-local` by default, or the pinned local `remotion-local` adapter when explicitly selected.
- Storage: local filesystem.

Retries are bounded and stage-specific. The `--resume` flag applies to capture, verify-input, QA, render and full run; init recognizes identical input and asset bytes idempotently. Cache reuse requires matching input/dependency hashes and unchanged output hashes; changed creative artifacts or source assets invalidate their dependent stages. JSON reports record the command, exit code, duration, paths, and remaining risk observed in the current run. Warning reviews match each finding's file, severity, code, message and snippet one to one; unexplained findings block QA.

## Security and rights

The workflow never bypasses login, CAPTCHA, paywalls, anti-bot controls, or access restrictions. It excludes secrets, cookies, private data, and full environment dumps from reports. Only assets marked `owned` or `authorized` may enter a final render.

Cloud services, public automation and renderer-as-a-service remain deferred to [SCALE-GATE.md](SCALE-GATE.md); the current dual mode is local-only and does not introduce a Job API, queue, object storage or database.
