# 持续集成

GitHub Actions 在主分支 Push、Pull Request 和手动运行时检查公开源码。工作流是 [.github/workflows/ci.yml](../../.github/workflows/ci.yml)，使用一个标准 Windows 2025 runner、Node 24.19.0 和 Python 3.13.15。

检查包括：锁文件安装、类型检查、源码与契约 Lint、TypeScript 测试、真实 Chrome 排版测试、Python 迁移和语音契约测试、依赖风险回归、npm 漏洞审计，以及实际 npm 压缩包的公开内容边界。项目直接运行 TypeScript，没有单独构建命令，也没有配置覆盖率门槛。

浏览器与媒体工具通过现有 `scripts/setup-local.mjs` 下载并校验固定版本和 SHA-256。中文浏览器夹具从 Adobe 官方仓库的固定提交下载未修改的 Source Han Sans CN 2.005R Regular 和完整 SIL OFL 1.1 许可；两者校验哈希后通过测试页面的 `@font-face` 加载，不安装系统字体。浏览器仍通过 CDP 验证实际使用的中文字体，不接受缺字回退。

在本地复现字体模式，可设置 `EPVS_TEST_CJK_FONT=Source Han Sans CN` 和 `EPVS_TEST_CJK_FONT_PATH` 为经校验的本地字体绝对路径，再运行 `npm test`。不设置文件路径时，仍使用原有系统字体测试方式。

CI 使用自编测试图形与合成媒体夹具。它不接入已确认的制作声线或私有品牌素材；两项需要本机 Kokoro 后端的集成测试按现有规则明确跳过，其余语音契约单元测试仍执行。完整声线与成片视听验收属于本地制作流程，不能由 CI 通过代替。

工作流仅有 `contents: read` 权限，不保留 checkout 凭据，不使用仓库 Secret，不使用 `pull_request_target`，不上传视频、品牌图片、模型、日志附件或制作报告，不部署、不发布 npm 包、不创建 Release，也不启用依赖或媒体缓存。Actions 固定到完整提交 SHA。公开仓库使用标准托管 runner 的运行分钟免费，未使用收费的大型 runner；参见 [GitHub 官方计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。

字体来源与许可：[Adobe 固定提交](https://github.com/adobe-fonts/source-han-sans/tree/6c709ca72d3d7c46ab42ebecc1a26e7d69595a37)、[完整 SIL OFL](https://github.com/adobe-fonts/source-han-sans/blob/6c709ca72d3d7c46ab42ebecc1a26e7d69595a37/LICENSE.txt)。字体与便携工具仅在临时 runner 中使用，不进入公开软件包。
