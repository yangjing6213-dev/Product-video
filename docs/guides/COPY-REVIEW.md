# 逐视频文案确认

每条新视频在生成旁白或视频前，先向用户呈现并确认完整文案：旁白、屏幕文字、字幕与行动提示（CTA）。屏幕文字包括可编辑作者片尾。静音样片同样确认其屏幕文字。动效、声音、IP 或背景方向的认可不能代替文案认可。

文案保存为项目内 `copy-script.json`，字段包括 `schemaVersion: "1.0"`、`projectId`、`productId`、`revision`、`narration`（分句数组）、`onScreenText`、`subtitles` 和 `cta`。有旁白时，字幕只能调整分段或换行，合并后的文字须与旁白一致。CLI 冻结时生成项目相对路径与完整内容的 SHA-256，保留历史字节，不覆盖其他版本。

```powershell
node src/quality/cli.ts copy-freeze --project <video-id> --copy <reviewed-copy.json>
node src/quality/cli.ts copy-status --project <video-id>
```

只有收到用户明确确认后，才创建决策 JSON：`decision` 为 `ACCEPTED` 或 `REJECTED`，`copySha256` 是用户本次审阅版本的冻结哈希，`userInstruction` 是用户的真实原话。此接口不能自行证明用户身份，调用者必须忠实转录会话中的实际指令；不得自动生成批准、由模型分数批准，或将其他维度认可解释为文案批准。

```powershell
node src/quality/cli.ts copy-review --project <video-id> --decision <actual-user-decision.json>
node src/quality/cli.ts copy-check --project <video-id>
```

审批保存在该视频的 `copy-approvals/`，追加历史，不替换旧决策。新质量方案使用 `copy: { "sha256": "<reviewed copy hash>" }` 绑定文案，方案冻结、恢复和渲染均校验绑定。修改字体、实拍背景、构图、时长或同文案的声音表达不会无谓撤销文案认可；改变文字或改用于另一条视频需新变体及确认。

有旁白的新质量方案，`sources` 必须包含 SHA-256 与 `narration.textHash` 相同的真实文本文件，文件去除换行后的文字须等于批准的旁白。含音频时，`narration.alignmentPath` 的 JSON 须有 `copySha256`、`voiceSha256` 和实际 `cues`（`text/start/end`）；哈希应对应文案及音频，字幕合并文字须与批准字幕一致。实际段落/换行可以不同，字词不得悄悄变化。

当前质量链采用 `static-single-narration-v1` 音轨契约：有声影片仅含一个静态 `<audio src="...">`，路径必须直接指向本任务已冻结的 `narration.voicePath`，实际文件字节须匹配 `voiceHash`；静音影片不得携带音轨。新渲染前，Chromium 先解析不运行脚本的 DOM，再加载脚本并逐帧定位检查。嵌套 `<source>`、额外音轨、视频音轨、动态修改音源、创建独立 Audio 或 Web Audio 均不受支持并阻断。新增音乐必须先扩展明确的批准来源契约。此检查覆盖已解析和实际执行的有限时间线，不是对任意异步或蓄意隐藏 JavaScript 的形式化证明；继续禁止异步构建媒体。

机器门禁保证被引用的文案、旁白源、字幕源与冻结资源不被静默替换；已有冻结方案的 HTML 变化会被入口文件哈希阻断。它不能从任意 HTML/CSS、canvas、SVG 或图片中可靠识别全部视觉文字。因此每次新构图仍须在浏览器中对照批准文案抽检屏幕字、作者片尾和 CTA，记录实际可见文字证据；不能声称文件哈希已自动证明所有画面文案一致。新视频变体的审批不可从另一项目复制。

旧版 `video-spec.json` 流程同样受控：用 `copyDraftFromVideoSpec` 提取旁白、屏幕文字、字幕与 CTA 后冻结，真实确认后使用 `copy-check --legacy-spec` 检查。旧链新的旁白阶段、draft/high 渲染，以及直接调用本地 `synthesize-zh.py` 都检查同一门禁。已有全部输入/输出哈希一致的视频缓存可以读取，不要求伪造历史审批；缺失输出或变化输入触发实际生成时，仍必须通过文案确认。

旧链所有实际 transcript 来源（包括没有分句 cues 的外部音频和 ASR）须与批准字幕逐字一致，仅允许换行差异；音频及 transcript 自身的哈希一致不能代替此检查。本地 Python TTS 在模型加载前保存并审核完整输入快照，合成全程消费该快照，正式写入前再次检查最新审批与输入字节。合成中途改稿或拒绝审批会阻止发布，保留临时结果及失败说明，且不覆盖已有音频。这是快照与发布前复核，并非多文件原子事务。

文案确认仅允许在既有任务和授权范围内制作，不代表最终画面、声音表达、成片验收、批量生产、外部费用或公开发布已经批准。权利和其他集中确认点继续独立记录。
