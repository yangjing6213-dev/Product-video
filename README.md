# 恩禾产品视频工作室 · ENHE Product Video Studio

**产品做出来了，介绍视频怎么做？**

把零散的产品介绍、截图和素材，整理成一支讲清楚用途、展示使用过程的视频。

[English](README.en.md) · [查看示例效果](#五示例效果) · [安装方法](#六安装方法) · [恩禾官网](https://www.enhe-tech.com.cn/)

## 一、这个仓库是什么？

这是一个配合 **Codex** 使用的本地产品视频制作工具，当前版本为 **0.1.0**。

你提供产品资料，Codex 按仓库内的 Skill 梳理内容、写文案、安排镜头；你确认后，再使用 HyperFrames 制作动画，并完成配音、字幕、渲染和质量检查。

它把“要讲什么”和“怎么做成视频”放进同一套工作流程。你可以检查文案、调整画面，也可以保存已确认的方案，之后接着做。

## 二、适合谁用？

### 1、特别适合

- **独立开发者和产品作者**：做出了工具，希望让别人快速看懂它解决什么问题。
- **AI 内容创作者**：需要介绍工具、演示工作流，想把零散资料整理成有顺序的视频。
- **一人公司和小团队**：希望保留自己的品牌、旁白和作者介绍，持续制作产品内容。
- **愿意参与确认的人**：先看文案和画面，再决定生成什么，而不是生成后从头返工。

### 2、不适合

- 只想输入一句话，就无人审核、批量生成并自动发布视频。
- 需要开箱即用的网页剪辑器、云渲染平台或成熟商业视频服务。
- 希望用一张人物图片，自动获得电影级三维表演或任意人物、声音仿制。
- 无法提供有权使用的产品资料、人物、配音或品牌素材。

## 三、它会产出什么？

| 产出 | 用来做什么 |
| --- | --- |
| 产品宣传视频 MP4 | 介绍产品、演示流程、说明解决的问题 |
| 视频封面与作者片尾 | 播放前说明主题，结尾展示作者和下一步入口 |
| 中文旁白、画面字幕与 SRT | 让观众听得懂，也能在静音时看懂 |
| 产品摘要、文案与分镜 | 在生成前确认内容，后续修改时有据可查 |
| 素材清单与冻结版本 | 记录使用了哪些图片、声音和方案，支持继续制作 |
| QA 与渲染报告 | 记录真实检查结果，定位缺素材、排版或渲染问题 |

当前视频规格支持 **8–90 秒、30fps**，可制作 **1920×1080 横屏**或 **1080×1920 竖屏**。实际时长取决于确认后的文案、旁白和镜头安排。封面、配音和双语文案需要在对应制作环节准备与确认。

## 四、具有什么价值？

- **先把产品讲清楚。** 从用户遇到的问题出发，安排介绍顺序，避免只罗列功能。
- **先确认，再制作。** 文案、声音和关键画面分开确认，减少整支视频推倒重来的情况。
- **保留自己的表达。** 已确认的品牌风格、旁白和作者信息可以沿用；新视频仍按产品组织内容。
- **改一部分，可以接着做。** 保存素材和任务状态，符合复用条件的步骤无需重复执行。
- **知道问题出在哪里。** 用实际检查和报告判断完成情况，不把“文件生成了”当作“成片通过了”。

## 五、示例效果

### 62 秒：从产品介绍到推广视频

这支视频介绍 ENHE Product Video Studio，包含开头封面、产品讲解、角色与流程演示、官网入口和作者片尾。

[![ENHE Product Video Studio 视频封面：产品做出来了，介绍视频怎么做？](https://raw.githubusercontent.com/yangjing6213-dev/Product-video/main/docs/showcase/enhe-studio-cover.png)](https://github.com/yangjing6213-dev/Product-video/raw/refs/heads/main/docs/showcase/enhe-studio-demo-62s.mp4)

**[下载观看 62 秒完整视频（MP4）](https://github.com/yangjing6213-dev/Product-video/raw/refs/heads/main/docs/showcase/enhe-studio-demo-62s.mp4)**

点击封面或上方链接下载完整视频。GitHub 首页展示封面，视频请下载后播放。

背景音乐：[Electric Dreams](https://www.scottbuckley.com.au/library/electric-dreams/) — [Scott Buckley](https://www.scottbuckley.com.au/)，采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可；视频中进行了截取、音量调整和淡入淡出。

示例使用 AI 辅助创作的画面与合成旁白，已经过作者审核。它展示的是完成创作与审核后的成片；公开仓库不附带完整私有品牌素材、参考录音或本机模型，首次安装不会自动复现同一支视频。展示素材的使用范围见[展示素材说明](https://github.com/yangjing6213-dev/Product-video/blob/main/docs/showcase/NOTICE.md)。

## 六、安装方法

当前已验证的本地平台为 **Windows x64**。请先准备：

- Git。
- Node.js **24.15 或更新版本**，以及 npm。
- 能读取本地项目文件、使用 Skill 的 Codex 环境。

### 1、获取项目并安装依赖

```powershell
git clone https://github.com/yangjing6213-dev/Product-video.git
cd Product-video
npm ci
```

### 2、准备本地渲染工具

```powershell
node scripts/setup-local.mjs
```

该脚本下载缺少的固定版本 Chrome、FFmpeg，并核验所需工具；只写入项目内目录，不修改系统 PATH 或注册表，不需要管理员权限。

已有工具、只想检查环境时，运行：

```powershell
node scripts/setup-local.mjs --verify-only
```

详细步骤与下载来源见 [Windows 本地工具准备](docs/guides/LOCAL-SETUP.md)。中文配音是独立的可选配置，需要本地 Python 环境和相应模型；准备方式见[本地中文旁白](docs/guides/CHINESE-TTS.md)。仓库不附带模型或声音参考文件。

部分已有工作区提供 `node .tools/npm/bin/npm-cli.js` 作为 npm 备用入口。它不随仓库分发，也不由安装脚本提供；首次安装仍需电脑上已有可用的 npm。

### 3、让 Codex 读取项目 Skill

在 Codex 中打开这个项目，要求它读取 [skills/enhe-product-video/SKILL.md](skills/enhe-product-video/SKILL.md) 及关联说明即可。不需要先安装全局 Skill。

## 七、如何使用

### 1、准备产品资料

提供项目名称、公开网址或本地截图，并说明：**给谁用、解决什么问题、最希望展示哪些功能、希望观众下一步做什么**。再提供有权使用的 Logo、人物等素材，以及期望的画幅和时长。

每支新视频都会先询问封面和作者片尾使用的人物。没有提供时使用已授权的本地默认人物；提供新人时，两处同步替换。全新仓库没有私有默认人物，需要你提供或配置自己的素材。

### 2、在 Codex 中开始制作

可以直接使用下面这段说明，并补充你的产品资料：

```text
请读取本仓库 skills/enhe-product-video/SKILL.md，按项目规范制作一支产品介绍视频。

先根据我提供的资料整理产品用途、用户痛点和需要展示的功能。
请先给我完整文案与分镜，确认后再制作。
封面和作者片尾保持项目已审核的风格；先询问我是否提供人物图片。
新视频选择适合产品、与历史任务不同的真实背景场景。
生成后检查字幕、排版、素材、声音和成片，并提供实际文件与QA结果。
```

完整输入字段与模板见[输入指南](docs/guides/INPUT-GUIDE.md)。封面和人物规则见[封面与作者片尾规范](docs/guides/AUTHOR-FRAMING.md)。

### 3、确认文案、声音和画面

先确认整支视频的旁白、屏幕文字和字幕，再审核声音与关键画面。已经认可且未变化的录音优先复用；更换人物图片不会自动改变配音或作者联系方式。

### 4、生成、查看与继续修改

Codex 准备好任务输入、素材、分镜和动画文件后，项目命令负责校验、渲染与报告。查看可用命令：

```powershell
npm run video -- help
```

对已经准备好的任务，可继续执行（将 `your-project-id` 换成实际任务编号）：

```powershell
npm run video -- qa --project your-project-id
npm run video -- render --project your-project-id --quality draft
npm run video -- run --project your-project-id --resume
```

成片与报告保存在对应的 `projects/<projectId>/` 下。高质量渲染还需满足任务当前的素材、文案与视听确认要求；命令本身不会代替 Codex 写分镜或自动通过审核。

<details>
<summary>更多命令：本地素材、高质量导出与断点恢复</summary>

只使用已经提供的本地素材，跳过网址抓取：

```powershell
npm run video -- capture --project your-project-id --supplied-only
```

在当前方案已获实际视听确认后，导出高质量版本：

```powershell
npm run video -- render --project your-project-id --quality high --resume
```

`verify-input`、`capture`、`qa`、`render` 和 `run` 支持 `--resume`。只有输入与登记输出的字节均未变化时才复用已有结果；缺失或变化会使对应步骤重新执行。未指定 `--supplied-only` 时会尝试抓取公开网址，失败后回退到已提供素材。查看帮助使用位置参数 `help`，不是 `--help`。

</details>

## 八、项目工作流程

1. **了解产品**：阅读资料，确定用户、痛点和一个主要目标。
2. **选择素材**：确认品牌、人物与声音来源，为新视频选择合适的新场景。
3. **确认内容**：整理完整文案、屏幕文字、字幕与分镜。
4. **确认视听方向**：检查封面、作者片尾、关键镜头和旁白。
5. **制作与渲染**：冻结已确认素材，使用 HyperFrames 制作视频。
6. **检查成片**：查看字幕、排版、声音、时长和素材是否符合要求。
7. **交付与复用**：保留视频、素材版本和报告；同一任务恢复时不随机换人、换景或换声。

## 九、项目目录结构

```text
Product-video/
├─ README.md                    # 中文项目说明
├─ skills/enhe-product-video/    # Codex 视频创作流程与规范
├─ src/                         # 命令入口、任务编排与质量检查
├─ scripts/                     # 本地工具准备、素材与配音辅助脚本
├─ schemas/                     # 输入与视频规格定义
├─ recipes/                     # 视频制作配方
├─ prompts/                     # 创作与检查提示
├─ tests/                       # 项目测试
├─ docs/
│  ├─ guides/                   # 安装、使用与质量指南
│  ├─ architecture/             # 项目架构与范围说明
│  ├─ security/                 # 依赖风险说明
│  └─ showcase/                 # 本次已授权公开的示例与作者图
├─ .github/workflows/           # GitHub 自动检查
├─ LICENSE                      # Apache-2.0 软件许可证
└─ THIRD_PARTY_NOTICES.md        # 第三方与展示素材说明
```

运行时还会使用本地 `projects/`、`.tools/`、`.cache/` 等目录。私有品牌库保存在 `assets/brand/enhe/`，原件、声音参考与任务记录不随公开源码分发。

## 十、注意事项

- **这是本地工作流程，不是云端一键生成平台。** 文案、分镜和画面由 Codex 按 Skill 创作，CLI 负责可重复执行的步骤。
- **先确认文案，再生成视频。** 发布前还需检查画面、声音及素材的使用权。
- **默认不接入付费 API 或云服务。** 不默认使用 Remotion、ElevenLabs、Captions AI、云渲染、数据库、Job API 或对象存储。
- **公开示例不等于免费素材包。** 代码采用 [Apache-2.0](LICENSE)；展示中的人物、品牌、声音和第三方内容另有权利边界，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- **不要把隐私资料放进公开仓库。** Token、Cookie、未脱敏截图、参考录音与私人素材留在本地。
- **换场景不能改变已确认风格。** 新视频更换真实背景；同一任务恢复时保留原人物、场景和冻结版本。
- **备份要包含本地素材。** 只保存 Git 已跟踪文件，不能恢复被忽略的品牌库、模型和任务资产。
- **其他操作系统尚未完成本地工具链验证。** 现有自动检查与平台说明见项目文档，不把未验证环境写成已支持。

开发与检查命令：

```powershell
npm run lint
npm run typecheck
npm run check:dependency-risk
npm test
```

项目没有独立编译构建步骤，也尚未配置覆盖率命令。完整验证要求见 [Benchmark 指南](docs/guides/BENCHMARK-GUIDE.md)；贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题报告见 [SECURITY.md](SECURITY.md)。

## 十一、相关项目

无。

## 十二、关于作者

![关于作者：Enhe（恩禾）](https://raw.githubusercontent.com/yangjing6213-dev/Product-video/main/docs/showcase/about-author.png)

### Enhe（恩禾）｜产品设计师 · 一人公司实践者 · AI Builder

**用 AI 打造一个人公司。**

- GitHub：[yangjing6213-dev](https://github.com/yangjing6213-dev)
- X / Twitter：[@Amenenhe_ai](https://x.com/Amenenhe_ai)
- 网站：[www.enhe-tech.com.cn](https://www.enhe-tech.com.cn/)
- 微信：`Hu-Amen`
- 邮箱：**amen.enhe@gmail.com**

[恩禾 ENHE AI | AI工具、AI资讯、账号服务与技能课程](https://www.enhe-tech.com.cn/)

## 十三、继续探索

这个项目是我用 AI 搭建的个人生成系统里的一个工具。

如果你也在用 AI 做内容、知识库、工作流，或者尝试把想法做成产品，可以访问 [www.enhe-tech.com.cn](https://www.enhe-tech.com.cn/) 查看更多资料。

**访问恩禾官网，获取更多 AI 工具和解决方案。**
