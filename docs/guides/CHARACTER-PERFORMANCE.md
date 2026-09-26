# 角色演绎与选择 QA

本流程仅适用于用户明确要求的角色讲解动画。HyperFrames 继续作为渲染主链路，旧任务不自动迁移。原始素材、衍生素材和私有报告不进入公开软件包。

## 当前公司角色修复状态

用户已拒绝 `character-performance-v2` 的两支演出：机械、不协调，公司角色造型变化。该版本的工程通过不能作为新的视觉批准。用户随后已认可私有素材库 `assets/brand/enhe/ip/prepared/source-layered-v1/` 的原图分层造型。最新决定单独记录为 `APPEARANCE_ONLY`，不能将它扩大为动作或生产批准；历史冻结清单保持原样。

用户只有扁平图片时，由流程准备可编辑分层素材，不再要求用户自行制作 PSD。当前实现用原始 PNG 像素、透明轮廓、命名 SVG 图层和 rig JSON；保留原脸、眼镜、星体与比例，小幅隐藏关节补全单独声明。XINBI 的脸属于星体，不为了凑层数切出假头部。它不是纯矢量、PSD、Spine 或 AE 工程，也不能从一张正面图推定可靠的背面。

当前六层原图方案仅接通本地动作审查样片，尚未接通下述八部件生产契约。不得绕开生产门槛或自动将它标为 APPROVED；先完成造型与动作确认，再为精确格式接入冻结、恢复和生产验证。图像生成补全失败或造型变化的候选不能进入最终素材。

原图表演使用 `src/quality/source-acting.ts`：肘部弧线、肩根渐变约束、手部接触求解、脚底固定的身体准备与跟随、原眼区像素采样。动作轨迹由每场剧情分别编排；不用全片循环挥手、整图旋转或两个姿势轮换代替表演。眼睛与手臂必须检查实际像素，连续曲线和接触坐标通过不能代替视觉验收。

当前 22 秒局部演出覆盖取物、交接、阅读、指引与回应，并用资料特写衔接原图的不同姿态。它仍没有完整侧身、背面、行走和全身重心表演；不能宣称达到高级动画片效果，也不等于新的 60 秒成片已完成。不得通过拉伸正面脸或镜像带 Logo 的身体假装真实转身。动作审查样片可以静音，正式配音与作者片尾仍沿用各自已批准文件。

## 从产品到剧本

先读取当前项目证据，再填写每场的角色身份、目标、障碍、行动、结果。不要先挑循环动作再套产品名。`performance.fact` 是对应 `product.primaryProblem`、`valueProposition` 或某个 feature 的原始文字；它与戏剧化描述分开。屏幕文字仍引用已经确认的双语 `onScreenText` 索引，不在图形里偷偷补文案。

既有八部件通道支持寻找、行走、取起、交接、放置、连接、指引和回应，不能据此推定新的六层原图通道已支持相同范围。关节轨迹连续，道具在持有阶段跟随手部；`place/connect.destination` 指定放置后的真实位置。它是可复用的有限二维演出能力，不是任意自然语言到全身表演模型。仍需逐场编排并检查接触、角色穿插、空间关系与解释是否清楚。

## 角色选择

先生成公司双 IP 与火柴人的实际短预览，再以包含项目 ID、两支本地 MP4 路径和实际 SHA-256 的选项文件运行：

```powershell
node src/quality/cli.ts character-options --project TASK --selection options.json
```

页面保存在该任务的 `character-options.html`，已有文件不会被覆盖。选项为 TUOTUO + XINBI、火柴人、自定义本机图片。页面无网络上传行为；所有选项初始未确认。保存文件是 `character-choice-request.json` 请求，不是假造的生产批准。用户也可以在当前对话明确给出相同选择。

自定义单图只完成来源选择、哈希与透明度预检。必须继续准备 `head/body/upperArm/forearm/hand/thigh/shin/foot` 八个独立授权部件和动作预览。整张图没有可动结构时保持待准备，不能套用公司角色骨架。

## 审核与冻结

1. 准备 `CharacterReviewSelection`：mode、actorAssetIds、每个实际 rig（私有 vector 或自定义部件绑定）、sources、references、prepared、实际动作 preview、rendererHash、真实 QA JSON。所有文件为任务相对路径及实际 SHA-256。公司原图和新衍生版本分开保存。
2. `character-freeze --project TASK --selection selection.json` 保存不可覆盖的审查版本；这一步不会批准角色。检查 `character-status`。
3. 只有收到用户对该角色/动作版本的明确确认后，才调用 `character-review --project TASK --decision decision.json`。decision 包含真实用户原话、`ACCEPTED/REJECTED` 和完全相同的 `reviewSha256`。本机 API 不承担人类身份认证，调用者不得编造原话。
4. 正常 voice、compose、freeze、run、render 与 QA 均要求当前角色审核有效。实际内联 SVG 必须等于已审 prepared SVG。素材、部件、vector、预览、QA 或渲染代码变化均使旧审核失效，拒绝恢复。删除 performance 配置但保留新演出 HTML 或审核文件也会失败。

图片外部透明、关节多中间态、反向恢复、唯一背景与逐帧文字互斥属于工程 QA。它们不证明动作自然、不证明用户接受，更不自动批准旁白、文案或整体成片。正常生产前应分别报告这些状态。

保留已认可的声音及作者片尾；角色选择不授权重合成声音、删除旧视频或公开品牌原图。参考网页无法访问时明确标记未观看，可继续基于实际工程问题修复，不编造逐镜对比。
