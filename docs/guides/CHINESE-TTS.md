# 本地中文旁白

本项目使用仓库内的 Python 虚拟环境、Kokoro v1.1 中文模型和 Misaki 中文前端生成普通话旁白。工具不会修改系统 `PATH`，不需要管理员权限，也不调用付费 API。

> 三个产品的示例项目目录、输入、抓取结果和授权素材不随公开源码分发。`prepare-zh-variants.mjs` 与 `build-benchmark-compositions.mjs` 是辅助脚本，使用者必须先按 [输入指南](INPUT-GUIDE.md) 和仓库 Skill 的输入契约，用自己的输入与授权素材准备对应的三个源项目目录；fresh clone 不能直接运行下文的三产品示例命令。

## 准备与核验

如果 `.tools/tts-venv` 和两个模型已存在，只运行核验：

```powershell
node scripts/setup-tts.mjs --verify-only
```

首次准备时，传入本机 Python 3.12.14 的可执行文件。脚本只创建缺失的仓库内虚拟环境、模型目录和配置：

```powershell
node scripts/setup-tts.mjs --python "C:\path\to\python.exe"
```

脚本按 [requirements-tts.txt](../../scripts/requirements-tts.txt) 安装固定版本。模型直接来自官方 GitHub release，不调用 GitHub REST API。下载使用 1 MiB 的 Range 请求；普通瞬时网络错误最多重试两次，遇到 HTTP 403 或 429 会立即停止并报告 `Retry-After`。如果目标模型、下载分片、虚拟环境或 `.tools/tts-config.json` 已存在但不符合预期，脚本失败退出，不覆盖它们。

核验报告检查以下事实：

- Python 和全部固定依赖的版本；
- 模型与声音数据的字节数和 SHA-256；
- Misaki `ZHG2P(version="1.1")` 能为中文样句生成音素；
- `zf_001` 存在于声音数据。

这组检查不生成音频，因此报告中的 `verification.synthesis.status` 固定为 `NOT_RUN`。只有实际运行合成脚本并检查生成的 WAV，才能证明合成可用。

## 固定资源

| 资源 | 大小 | SHA-256 | 来源 |
| --- | ---: | --- | --- |
| `kokoro-v1.1-zh.onnx` | 325,506,167 B | `859f9ded9f53be16c24857cdab3254a45da53c3afd5ba6ef134c7de3f822e326` | [kokoro-onnx model-files-v1.1](https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.1-zh.onnx) |
| `voices-v1.1-zh.bin` | 53,815,880 B | `14cb6186c99e4f6016871405f62046c5df863ae27465cbdc4ee08be7dd703acd` | [kokoro-onnx model-files-v1.1](https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.1-zh.bin) |

`.tools/tts-config.json` 只保存仓库相对路径、资源摘要、中文前端版本、采样率和默认声音 `zf_001`。语速属于每个场景的创作元数据；不要通过修改全局配置为不同场景共用一个语速。

HyperFrames 0.8.33 内置 `tts` 命令固定使用 Kokoro v1.0 模型和 eSpeak `cmn` 路径，也没有 v1.1 中文模型参数。本项目的最终中文旁白使用 [synthesize-zh.py](../../scripts/synthesize-zh.py) 和上述 v1.1 中文工具链。

## 旁白与字幕

先把旁白写成短句，再逐句合成。合成脚本以每句实际 PCM 样本数和 24 kHz 采样率计算起止时间，然后拼接音频并生成字幕。字幕因此是实测的句级边界，不是 ASR 推测的逐词时间。

原三条基准视频的中文旁白版本使用新的 `-zh` 项目目录，保留原项目和原成片。准备脚本发现目标项目已存在时会停止，不会覆盖：

以下命令是已按上述前置条件准备好三个源项目后的本地示例。为自己的产品生成旁白时，应使用新的项目 ID、自己的 `input/narration-script.json` 和有权使用的素材。

```powershell
node scripts/prepare-zh-variants.mjs
.tools\tts-venv\Scripts\python.exe -X utf8 scripts\synthesize-zh.py enhe-ai-homepage-zh cognitive-anchor-sketcher-zh project-brand-studio-zh
node scripts/build-benchmark-compositions.mjs enhe-ai-homepage-zh cognitive-anchor-sketcher-zh project-brand-studio-zh

$ids = @('enhe-ai-homepage-zh', 'cognitive-anchor-sketcher-zh', 'project-brand-studio-zh')
foreach ($id in $ids) {
  npm run video -- run --project $id --resume --supplied-only
}
```

合成脚本接受一个或多个项目 ID；每个项目必须先有独立的 `input/narration-script.json`。它拒绝覆盖已存在的旁白、字幕和时间报告，因此修改台词后应创建新的项目 ID，而不是删除原交付物。

本入口不安装或承诺 ASR。当前工作流不依赖不可达的 Whisper 模型，也不会把句级时间标成逐词转写。

## 许可与分发边界

| 组件 | 许可或分发条件 |
| --- | --- |
| `kokoro-onnx` | MIT |
| Kokoro 模型 | Apache-2.0 |
| `misaki` | Apache-2.0 |
| ONNX Runtime | MIT |
| PySoundFile | BSD-3-Clause；其打包的 libsndfile 适用 LGPL |
| `phonemizer` 与 eSpeak NG | GPL-3.0-or-later |

这些资源用于本项目的私有本地运行。不要把 `.tools/tts-venv`、模型或二进制随产品重新分发，除非已逐项保留许可和声明，并完成 LGPL/GPL 对应义务审查。生成音频的对外使用还需要独立核对文本、声音和品牌素材的授权。
