# 本地旁白与背景音乐预混

旁白文案必须先通过当前任务的 `copy-review`。背景音乐预混不会生成旁白，也不会代替用户对声音表达及完整成片的验收。音乐许可必须经过人工核实，`licenseId` 及冻结的许可说明文件只记录核实结果，不自动证明授权。

现有不含 `audioMix` 的冻结方案保持原行为。需要音乐的新任务使用 `src/quality/mix.ts` 的 `createAudioMix(root, project, request)`：

```ts
const audioMix = await createAudioMix(root, project, {
  copySha256: approvedCopyHash,
  voicePath: 'projects/example/input/narration.wav',
  voiceSha256: rawVoiceHash,
  music: {
    path: 'assets/music/licensed-track.wav', sha256: musicHash,
    licenseId: 'CC0-1.0',
    licensePath: 'assets/music/LICENSE-EVIDENCE.md', licenseSha256: licenseHash,
  },
  mixPath: 'projects/example/input/premix-v1.wav',
  durationSec: 38, voiceOffsetSec: 0.45, voiceGainDb: 0,
  musicOffsetSec: 0, musicGainDb: -22, fadeInSec: 0.8, fadeOutSec: 2,
});
```

示例增益不是通用响度标准。需要结合真实旁白和音乐试听与测量；这里仅提供固定增益及限制峰值的混音，不自动进行响度归一化、音乐循环或旁白降噪。偏移以完整视频时间线为基准；淡入淡出只作用于音乐。输入允许单声道或双声道，单声道复制到两个声道以保持原幅度，输出为 48 kHz、双声道、24-bit PCM WAV。限制器目标为 −1.5 dB，四倍过采样；成片仍须实际测量 LUFS、真峰值、同步及可懂度，不能将目标值当作测量结果。

工具先测量原始旁白长度；旁白时长加起始偏移超过时间线时直接拒绝，不会用裁切来凑片长。请调整影片时长与镜头安排。混音后再实际探测输出长度、48 kHz、双声道及 24-bit PCM，确认一致后才发布新文件。最终写入前重新核查输出父目录及路径，防止制作期间新增目录联接将文件转移到任务外。

将返回的 `audioMix` 放进新的创作方案，`narration.voicePath/voiceHash` 继续指向原始旁白，字幕时间对齐也继续绑定原始旁白。随后通过原有 `freeze` 冻结原声、音乐、许可文件和预混成品四类独立文件。资源均采用项目根目录相对路径及 SHA-256；不接受目录联接、外部绝对路径或越界路径。

HTML 只能放一个静态音轨，引用冻结后的 `audioMix.mixPath`，`data-start="0"`、`data-duration` 等于完整片长、`data-volume="1"`。原旁白偏移已预先混入，HTML 中不得再次加偏移。仍然拒绝第二音轨、动态切换音源、嵌套 `source` 或 Web Audio。

```html
<audio src="assets/quality-frozen/EXACT_MIX_SHA256.wav"
  data-start="0" data-duration="38" data-volume="1"></audio>
```

冻结之后的计划、声音、音乐、许可或混音字节发生变化会阻止恢复并使旧验收失效；更新源素材库不会改写旧任务的已冻结版本。声音验收记录原始旁白哈希，最终验收同时记录计划、视频、原始旁白及混音哈希。混音 helper 对输入建立独立暂存快照，完成后再次检查当前文案授权及输入哈希，然后独占写入新文件；输入变化、审批撤回、同名输出已存在时不会覆盖用户文件。过程命令及配方收据留在任务的 `reports/audio-mix-*` 目录，失败暂存保留用于排查。

影片预检完成后、正式渲染开始前会再次核验当前文案许可及冻结资源；渲染结束后和签发 PASS 报告前也会重新核验。期间文案撤回或资源变化时，不签发 PASS，不删除已产生的文件。

以上只完成本地工程支持。音乐审美、年轻男声语气、购买动机、最终视觉与听感必须在真实样片中评审；本工具不会自动将其标记为通过。
