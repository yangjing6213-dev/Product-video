# ENHE Product Video Studio

[English](README.en.md)

这是一个本地、HyperFrames-first 的产品推广视频 MVP。Codex 负责理解产品并创作 `PRODUCT-SUMMARY.md`、`DESIGN.md`、`SCRIPT.md`、`STORYBOARD.md`、`video-spec.json` 和 compositions；Node CLI 只编排可确定执行的输入校验、素材登记、状态/缓存、QA、渲染和报告。

## 边界

- Node.js 24.15+、TypeScript ESM、JSON Schema、固定依赖版本；HyperFrames 固定为 `0.8.33`。
- 当前规格支持 8–90 秒、1920×1080 横屏或 1080×1920 竖屏、30fps；具体时长按批准文案和实测旁白确定。
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

当前 CLI 使用位置参数 `help`，不支持 `--help`。直接 `render` 只接受 `draft` 或 `high`；当前活动规则任务的 `run` 默认只输出 draft；显式 `--quality high` 还要求当前计划的实际人工视觉和声音批准。未绑定生成规则的历史任务保留原 draft→high 行为。默认 capture 调用仓库内 HyperFrames `capture`，失败后自动回退到已提供素材；`--supplied-only` 跳过 URL capture。

`verify-input`、`capture`、`qa`、`render` 和 `run` 都支持 `--resume` 阶段复用；`init` 对完全相同的输入天然幂等，无需该标志。只有指纹一致且所有登记输出仍存在、字节哈希未改变时才会命中缓存，否则对应阶段重跑。以当次 `run-state.json`、`reports/run-history.json` 和 `reports/*.json` 为准；`run-history.json` 保留首次可播放 draft 时间，不因重渲染覆盖。失败必须返回非零退出码，控制台和报告使用 JSON，且不得包含密钥、Cookie 或完整环境变量。

创意生成与修复请从仓库内 [ENHE Product Video Skill](skills/enhe-product-video/SKILL.md) 开始。该 Skill 尚未安装到全局目录，也不能由 CLI 递归调用。

中文旁白先确认完整文案，再按显式 `voiceProfile` 选择已配置的本地 Kokoro 或 Qwen 参考声音分支；已有批准录音优先校验复用，不自动换声或重新试听。Qwen 使用实际 Whisper DTW 对齐，Kokoro 使用模型时序，输出 WAV、透明画面字幕与 SRT；流程与私有配置前提见[本地中文旁白](docs/guides/CHINESE-TTS.md)。

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

已将 `adm-zip` 间接依赖锁定到修复目标目录链接写穿问题的 `0.6.1`，HyperFrames 保持 `0.8.33`。`check:dependency-risk` 核验已审查的补丁版本和代码，不替代每次发布前的 `npm audit`；验证结果和限制见 [依赖风险说明](docs/security/DEPENDENCY-RISK.md)。

贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题报告边界见 [SECURITY.md](SECURITY.md)。

## 许可证

本项目原创代码采用 [Apache License 2.0](LICENSE)。第三方依赖、模型、素材、字体及其他外部内容继续适用各自的许可和来源条件，不因本项目采用 Apache-2.0 而重新授权；汇总见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 及各项目资产声明。
