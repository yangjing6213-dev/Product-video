# 为已验收视频增加封面

封面在主视频验收后接入。HyperFrames 继续生成主视频；本地装配只增加静态片头并复制原音轨。

1. 在私有品牌目录保存原参考、版本化封面、生成方式及内容哈希。封面中出现的全部文字写入标准 `CopyDraft` 并使用现有 `freezeCopyDraft` 冻结。实际用户确认后，使用 `recordCopyDecision` 记录本次文案哈希和用户原话。
2. 在同一审核目录写 `cover-manifest.json`：`schemaVersion: "1.0"`，`source` 与 `cover` 各包含项目相对 `path` 和 `sha256`，`copySha256`，`holdSeconds`（1–5 秒），安全文件名 `outputName`。源视频当前要求 1920×1080、30 fps、带音轨。拒绝跨目录资产、变化的哈希和已有输出。
3. 从项目根运行 `node scripts/add-video-cover.mts --manifest reports/<review>/cover-manifest.json`。实际输出包含无损母版、普通播放 MP4、独立 PNG 和 `WATCH.html`。装配结果的 `PARTIAL` 表示还需完整解码、音轨哈希、主体/片尾帧与浏览器验证；不是自动视觉验收。

`WATCH.html` 使用浏览器原生 `poster`、`controls`、`preload="none"` 和 `playsinline`。初始控件隐藏，画面下方显示可键盘操作的播放按钮；点击按钮或封面才显示原生控件并播放，避免手机控件挡住封面网址。不自动播放；禁用 JavaScript 时退回原生 controls。视频首段也是该封面，但第三方平台可能另行生成缩略图，上传时应同时选择独立 PNG。

音轨只延后封面时长，不重合成或变速。AAC 包直接复制，重封装的 priming/edit-list 信息与容器时间取整可能导致毫秒级起止差异，不能宣称音频采样级严格平移。无损母版可验证原主体逐帧一致；普通播放版有视频重新编码差异。源文件与所有历史视频保持不变。更换封面文字必须重新冻结和确认，已有视频及装配报告均不覆盖，使用新审核目录或新版本。

封面包含私有作者/品牌资产，遵守 `assets/brand/enhe/ASSET-RIGHTS.md`；生成文件不随软件源码自动公开分发。
