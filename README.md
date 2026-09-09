# ENHE Product Video Studio

[English](README.en.md)

这是一个本地、HyperFrames-first 的产品推广视频 MVP。Codex 负责理解产品并创作 `PRODUCT-SUMMARY.md`、`DESIGN.md`、`SCRIPT.md`、`STORYBOARD.md`、`video-spec.json` 和 compositions；Node CLI 只编排可确定执行的输入校验、素材登记、状态/缓存、QA、渲染和报告。

## 边界

- Node.js 24.15+、TypeScript ESM、JSON Schema、固定依赖版本；HyperFrames 固定为 `0.8.33`。
- 输出目标为 30–60 秒、1920×1080、30fps，默认 45 秒。
- 只使用自有或明确授权素材。`license=unknown` 素材不能进入 final。
- 本 MVP 不接入付费 API、ElevenLabs、Captions AI、Remotion、数据库、云基础设施或自动发布。
- 当前支持 Windows x64；其他平台尚未完成本地工具链验证。

## 本地使用

首次 clone 后需要 Node.js 24.15+ 和可用的 npm。先按 lockfile 安装仓库依赖：

```powershell
npm ci
```

再按 [Windows 本地工具准备](docs/guides/LOCAL-SETUP.md)核验固定版本工具。现有工具只读验证，不重复下载：

```powershell
node scripts/setup-local.mjs --verify-only
```

缺少固定 Chrome 或 FFmpeg 时，可选运行 `node scripts/setup-local.mjs` 下载并核验仓库内工具；它只写 `.tools`、`.cache` 与匹配的环境文件，不需要管理员权限，不修改系统 PATH、注册表或全局环境。

准备符合 [输入指南](docs/guides/INPUT-GUIDE.md) 的 JSON 后，使用 npm。某些既有本地工作区可能有 `node .tools/npm/bin/npm-cli.js` 作为备用入口；它位于被忽略的 `.tools`，不是 clone 自带内容，不能替代首次准备环境时的 npm。

```powershell
npm run video -- help
npm run video -- init --input "C:\path with spaces\product-input.json"
npm run video -- capture --project <projectId>
npm run video -- capture --project <projectId> --supplied-only
npm run video -- verify-input --project <projectId>
npm run video -- qa --project <projectId>
npm run video -- render --project <projectId> --quality draft
npm run video -- render --project <projectId> --quality high --resume
npm run video -- run --project <projectId> --resume
```

当前 CLI 使用位置参数 `help`，不支持 `--help`。直接 `render` 只接受 `draft` 或 `high`；`run` 按顺序执行 draft 和 high。默认 capture 调用仓库内 HyperFrames `capture`，失败后自动回退到已提供素材；`--supplied-only` 跳过 URL capture。

`verify-input`、`capture`、`qa`、`render` 和 `run` 都支持 `--resume` 阶段复用；`init` 对完全相同的输入天然幂等，无需该标志。只有指纹一致且所有登记输出仍存在、字节哈希未改变时才会命中缓存，否则对应阶段重跑。以当次 `run-state.json`、`reports/run-history.json` 和 `reports/*.json` 为准；`run-history.json` 保留首次可播放 draft 时间，不因重渲染覆盖。失败必须返回非零退出码，控制台和报告使用 JSON，且不得包含密钥、Cookie 或完整环境变量。

创意生成与修复请从仓库内 [ENHE Product Video Skill](skills/enhe-product-video/SKILL.md) 开始。该 Skill 尚未安装到全局目录，也不能由 CLI 递归调用。

中文旁白使用仓库内 Kokoro v1.1-zh 后端和预设普通话女声，流程见 [本地中文旁白](docs/guides/CHINESE-TTS.md)。新版本放在独立的 `-zh` 项目目录；每条同时提供旁白 WAV、画面内同步字幕和 SRT。字幕起止时间来自实际合成音频样本，精度为分句级。原无声版保留。

## Skill 使用

在当前仓库中使用时，直接要求 Codex 读取 [ENHE Product Video Skill](skills/enhe-product-video/SKILL.md) 并遵循其 references。若用户明确授权安装到个人 Skill 目录，将整个 `skills/enhe-product-video/` 文件夹（包括 `references/`）复制到 `$CODEX_HOME/skills/enhe-product-video/`；未设置 `CODEX_HOME` 时默认位于 `~/.codex/skills/`。目标目录已存在时停止，不覆盖已有 Skill。

## 交付结构

每个 `projects/<projectId>/` 应保留输入、素材清单、创意文档、`video-spec.json`、HyperFrames compositions、stage 状态，以及实际生成的 QA/render/run 报告。当前直接渲染报告为 `render-draft-report.json` 或 `render-high-report.json`；high 成功后还会写 `render-report.json`。实际外部命令记录在 `reports/commands/*.json`。benchmark 还需要 final MP4、contact sheet 和独立视觉 scorecard；scorecard 必须记录审查者类型和 `humanReviewed`，不能把 Codex 审查写成人工复核。

测试、benchmark 和状态判定见 [Benchmark 指南](docs/guides/BENCHMARK-GUIDE.md)。视觉评分必须明确记录审查者类型；Codex 独立审查不能标作人工复核。视频外部发布前仍需人工复核和单独的素材权利确认。规模化条件仅定义在 [Scale Gate](docs/architecture/SCALE-GATE.md)，当前不实现云服务。

## 开发验证

```powershell
npm run lint
npm run typecheck
npm run check:dependency-risk
npm test
```

项目当前没有配置 coverage 命令或覆盖率阈值。运行时由 Node.js 直接执行 TypeScript ESM，因此没有单独的编译 build 步骤；`npm run typecheck` 只检查类型，不生成构建产物。

当前存在已公开的 `adm-zip` 间接依赖告警。`check:dependency-risk` 只核验已审查的版本和代码是否变化，不会修复漏洞，也不替代 `npm audit`；处置依据和限制见 [依赖风险说明](docs/security/DEPENDENCY-RISK.md)。

贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题报告边界见 [SECURITY.md](SECURITY.md)。

## 许可证

本项目原创代码采用 [Apache License 2.0](LICENSE)。第三方依赖、模型、素材、字体及其他外部内容继续适用各自的许可和来源条件，不因本项目采用 Apache-2.0 而重新授权；汇总见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 及各项目资产声明。
