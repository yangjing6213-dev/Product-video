# 更新日志 / Changelog

本文件记录 Product Video Studio 的重要项目变更。当前功能更新尚未打版本标签或发布 GitHub Release。

This file records notable changes to Product Video Studio. The current feature update has not been version-tagged or published as a GitHub Release.

## 未发布更新 / Unreleased — 2026-09-27

### 新增 / Added

- 保留 **HyperFrames + GSAP** 为默认视频渲染模式，并增加可选的本地 **Codex + Remotion** 模式。
- 新项目可在生成前选择渲染模式；选择会随项目输入冻结，断点恢复时不能静默切换。
- Remotion 视频输出写入独立的 `renders/remotion/` 目录；两种模式继续共用文案、素材、旁白、字幕和 QA 流程。
- Added an opt-in local **Codex + Remotion** renderer while keeping **HyperFrames + GSAP** as the default.
- New projects can select a renderer before generation. The selection is frozen into the project input and cannot change silently during resume.
- Remotion outputs use the separate `renders/remotion/` directory. Both modes share the copy, assets, narration, captions, and QA stages.

### 验证 / Verification

- 自动化测试：398 通过，0 失败；TypeScript 类型检查和源码检查通过。
- Remotion 本地渲染冒烟验证：H.264、1920×1080、30 fps、45 秒。该验证确认渲染器可工作，不代表新产品视频已经完成人工视听验收。
- Automated tests: 398 passed, 0 failed; TypeScript typecheck and source checks passed.
- Local Remotion render smoke test: H.264, 1920×1080, 30 fps, 45 seconds. This verifies the renderer, not human approval of a new product video.

### 使用边界 / Notes

- Remotion 模式仅在本机渲染，不启用云渲染、Job API、数据库或对象存储。
- Remotion 与 HyperFrames 的画面实现不保证逐像素一致。Remotion 官方免费许可覆盖个人及总人数不超过 3 人的团队，也允许符合条件者使用自动化；其他组织应按人数与用途核对当前许可，见 [许可说明](docs/security/REMOTION-LICENSE.md)。
- Remotion renders locally; no cloud rendering, Job API, database, or object storage is enabled.
- Remotion and HyperFrames are not guaranteed to render pixel-identical visuals. Remotion's current Free License covers individuals and teams of up to three, including eligible automation; other organizations should check current terms against their headcount and use. See the [license notes](docs/security/REMOTION-LICENSE.md).
