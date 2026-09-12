# 本地中文旁白

## 当前新任务入口

当前本地中文任务先在输入中声明 `audio.voiceProfile`、`audio.deliveryMode`、`audio.pronunciationMap` 和 `external-audio` 的 `assets/narration.wav`，并给每个有声 scene 编写 `voiceDirection`。字段及实际能力边界见 [当前生成指南](GENERATOR-QUALITY.md)。完成文案确认后运行：

```powershell
npm run video -- voice --project <id>
```

该命令按显式 profile 选择已有 Kokoro v1.1 中文分支，或已接入的 Qwen 本机参考声音分支，绑定真实 WAV、字幕时间和声音报告，再进入正常 `compose → run --quality draft` 流程。它不自动选择声音或供应商。已有符合当前哈希的音频优先复用；缺失模型或授权时报告缺口，不自动安装、下载或换声。需要费用或外部上传时先取得明确授权。

已确认录音仅升级画面时，先正常建立新项目并确认它的完整文字，再使用 `node src/cli.ts voice --project TARGET --reuse-from SOURCE`。该入口只复用同仓库原始 Qwen 项目；旁白、字幕、发音、声线参数、导演指令和场景时间必须一致。原 WAV、SRT、字幕和生成收据保持原字节，独立 `reports/voice-reuse.json` 绑定源项目证据与目标批准，不把画面升级伪装成重新生成语音。普通 compose、run、QA、恢复和冻结都会检查绑定；源证据变化即拒绝。完整本地备份必须保留原项目，不能把派生任务误认为可脱离源项目的便携包。

新文案的 Whisper 提示从当前批准稿中提取英文专有词，并遵循发音表使用实际口播词。识别提示变化只重做 ASR 对齐，保留已有 `.qwen-prepared` 波形及原始失败识别；不重新推理、不直接替换识别错误或降低逐字核验。识别结果仍有差异时保留失败状态，提示词不能代替真实听审。

## 当前质量任务的声音选择

既有 `zf_001` 配置保留用于历史任务重现，不是 R2 新任务的男声默认值。历史 R2 曾使用现有模型生成最多三种真实 `zm_*` 男声的同文本试听，把正文、发音表、模型/声音/设置版本与波形哈希一并冻结；这不要求已有声音选择的任务重新试音。可运行 `scripts/audition-zh.py --help` 查看现有参数。脚本不联网、不下载模型；已经合成的原始波形用于缓存与重混，不能重复合成来掩盖缓存失效。

新质量片在用户选定具体声音和当前试听文件前，声音状态保持 `PENDING_REVIEW` / `NOT_RUN`。男声 ID 不证明年轻、温暖、自然等听感已通过。不要把静音技术样片或试听的机器响度检查当作声音验收。后续正式旁白按自然表达组织镜头时长，不通过变调或加速硬塞旧场景；字幕用实际句段/音频对齐证据，展示文字与口播稿分开。

项目内有 `.tools/selected-voice.json` 时，先核对其批准回执及音频哈希，再按回执范围采用已选声音。将当前已批准声音的原始音频、试听副本和批准回执保留为项目内不可变版本，profile 冻结回执与原始音频的 SHA-256；私有路径和哈希不写入公开示例。正常 `video voice` 的 Qwen 分支会核验该选择，不能自动回退 Kokoro。相同已批准口播直接复用原字节，记录 `sourceMode: reuse-approved-audio` 及真实原始模型来源：历史 B 保留 VoiceDesign 来源，后续 Base 样本保留 Base 来源；复用不声称重新合成。

Qwen profile 使用 `provider: qwen3-tts`、`modelId: Qwen3-TTS-12Hz-1.7B-Base`、`locale: zh-CN`，以及从当前选择和实际批准文件读取的 `voiceId`、`selectionPath`、`selectionSha256`、`referenceAudioSha256`。历史 `enhe-magnetic-b-v1` 只是旧版本标识，不能覆盖用户后续选定的声音。只使用已批准的完整文字和读音表。新文字经当前任务授权后，用本机 Base 参考合成，记录 `sourceMode: reference-synthesis`；不重新生成候选，也不因时间线不合适重复推理。

生产运行依赖已核验的私有 `.tools/qwen3-production-config.json`、模型清单和授权。对新建且尚未冻结的草稿，先用 `scripts/synthesize-qwen3.py --prepare-only` 准备整稿音频与真实 Whisper DTW 对齐；必传项目 ID、`--semantic-scenes`、`--voice-profile`、`--pronunciation`、`--context-hash`，分别与该草稿及活动规则一致，参数见脚本 `--help`。按输出的实测 `durationSec` 和 cues 调整新草稿的场景时间，不改已批准文字，也不改旧冻结任务。保留 `.qwen-prepared`，再走正常 `video voice → compose → run --quality draft --resume --supplied-only`。正式 `voice` 复用准备包并绑定最终 spec/script；时间仍不匹配时保留包并修正新草稿，不拉伸、变调或重推理。

VoiceDesign 的文字描述和固定 seed 不能保证换文案后保持已选音色。Base 参考合成的 `voiceDirection` 与 `deliveryMode` 是导演元数据，映射为 `qwen3-reference-v1`；不应用原生 `instruct`、逐场景情绪、语速或停顿控制，不能套用 Kokoro 参数。现阶段 `crossTextVoiceIdentity: NOT_VERIFIED`。当前已选声音的听审只覆盖对应音频；新文本仍需实际听审，不能以元数据、ASR 或样本批准替代。

## 既有本地工具链

### 隔离的 Qwen 试听候选

`scripts/audition-qwen3-zh.py` 保留历史已授权的本地 Qwen3-TTS 1.7B CustomVoice / Dylan 最多两档干声实验，不是已选 B 的生产入口，也不授权重新试听。它读取项目内的独立 `.tools/qwen3-tts-config.json`、模型清单、依赖锁、文案批准和该次试听授权；不自行下载模型，不上传文本或音频。CPU 实验采用 float32/eager，不安装 CUDA 或改系统设置。

该 CustomVoice 模型支持原生 `instruct`，这不代表 Base 参考合成支持它；是否达到年轻、有活力、普通话自然等要求仍需实际听审。试听接口没有逐词/音素时序时，只记录波形样本数和时长，不生成伪造字幕对齐。可运行 `--help` 查看参数；私有配置、授权稿、模型和试听不进入公开分发包。

既有 Kokoro 分支使用仓库内的 Python 虚拟环境、Kokoro v1.1 中文模型和 Misaki 中文前端。以下准备与固定资源说明属于该分支；工具不会修改系统 `PATH`，不需要管理员权限，也不调用付费 API。

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

HyperFrames 0.8.33 内置 `tts` 命令固定使用 Kokoro v1.0 模型和 eSpeak `cmn` 路径，也没有 v1.1 中文模型参数。显式选择 Kokoro 的任务通过正常 `video voice` 命令使用上述 v1.1 中文工具链。

## 旁白与字幕

Kokoro 按完整语义段合成；一段可包含多句，禁止按字幕行调用 TTS。段内依据模型输出的真实音素时序，段间依据实际 PCM 样本数和 24 kHz 采样率累计边界，再拆分可读字幕。它不是 ASR 识别结果。表达备注不会进入朗读文本，实际生效的语速/停顿与模式一起记录；不支持的情绪等字段不能宣称已生效。

Qwen 复用或合成整稿后，使用本地 whisper.cpp 的真实 DTW 锚点生成字幕组，方法为 `whisper-cpp-dtw-anchors-v1`。保留原始 token、DTW 和 offset；允许词锚点重复，但字幕组必须有正时长，末尾 padding 只可截至实测 WAV 边界。它是 ASR 词锚点，不是 Qwen 原生音素时序；不能平均分配、沿用别的声线时序或自动修词。Windows 调用保存 UTF-8 `@response-file`，使用 `-nfa` 确保 DTW 实际启用。

`asr-alignment.json`、`asr-raw.json`、`asr-command.json`、`asr-arguments.txt` 与 WAV、文案、模型及选择回执哈希共同核验；运行配置、授权、模型清单和当时合成脚本副本随任务冻结。文字只做明确的书写正规化。仅复用已接受原波形时，可对批准问句末唯一“啊”记录 `omittedDiscourseTokens`，原始识别保留，报告为 `MATCH_WITH_DOCUMENTED_DISCOURSE_OMISSION`、`reviewerType: model`、`humanReviewed: false`；不能将该特例用于新稿，也不能宣称逐字一致。其他词义差异阻止正常输出并等待核验。真实对齐通过不代表声音听感或完整影片通过。

## 历史基准重放（非当前默认）

以下直接脚本只用于按旧输入与旧报告重放原三条基准视频，不是普通新 brief 的入口，也不能替代当前 `video voice → compose → run` 流程。原三条基准视频的中文旁白版本使用新的 `-zh` 项目目录，保留原项目和原成片。准备脚本发现目标项目已存在时会停止，不会覆盖：

> 三个产品的示例项目目录、输入、抓取结果和授权素材不随公开源码分发。`prepare-zh-variants.mjs` 与 `build-benchmark-compositions.mjs` 是历史辅助脚本，使用者必须先按 [输入指南](INPUT-GUIDE.md) 和仓库 Skill 的输入契约，用自己的输入与授权素材准备对应的三个源项目目录；fresh clone 不能直接运行下文的三产品示例命令。

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

上述历史 Kokoro 脚本不安装或承诺 ASR，不会把句级时间标成逐词转写；当前 Qwen 对齐能力见前文。

## 许可与分发边界

| 组件 | 许可或分发条件 |
| --- | --- |
| `kokoro-onnx` | MIT |
| Kokoro 模型 | Apache-2.0 |
| `misaki` | Apache-2.0 |
| ONNX Runtime | MIT |
| PySoundFile | BSD-3-Clause；其打包的 libsndfile 适用 LGPL |
| `phonemizer` 与 eSpeak NG | GPL-3.0-or-later |

这些资源用于本项目的私有本地运行。不要把虚拟环境、模型或二进制随产品重新分发，除非已逐项保留许可和声明，并完成 LGPL/GPL 对应义务审查。Qwen 与 Whisper 的具体模型和可执行文件也必须匹配本地授权清单及各自许可；不随软件默认分发。已选音频、副本、私有回执、准备包和运行报告保留在本地完整备份中。生成音频的对外使用还需要独立核对文本、声音和品牌素材的授权。
