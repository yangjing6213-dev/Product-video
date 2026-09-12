# 项目内品牌素材库

本指南说明素材库与备份流程；下文 R2 质量验收部分保留历史契约。当前新任务以 [当前生成指南](GENERATOR-QUALITY.md) 和用户最新明确要求为准。

原创代码、自编 Skill 和本技术文档按项目根目录的 Apache-2.0 许可证发布。公司 Logo、IP、作者图像及其衍生素材的权利范围另见本地 `assets/brand/enhe/ASSET-RIGHTS.md`。允许在本项目制作 ENHE 视频，不代表允许公开分发素材包。

日常任务从项目内 catalog 选择经过审核的版本，冻结到具体任务，再预览、渲染和 QA。完整素材入库不等于全部抠图、全部审核通过或每条视频都使用所有素材。运行时不扫描项目外素材目录，也不保留外部路径作为回退。

## 目录和原件

```text
assets/brand/enhe/
├── ASSET-RIGHTS.md
├── logo/
├── author/
└── ip/
    ├── originals/
    ├── prepared/
    ├── previews/
    ├── catalog.json
    └── README.md
```

`originals/` 完整保存每个导入包的文件名和子目录，包括空目录。原件不能被抠图、压缩或转码结果覆盖。处理结果使用 `prepared/` 下新的版本文件；`previews/` 是可重建的轻量浏览材料。Logo 和作者原件可以位于同一品牌目录的 `logo/`、`author/`，统一列入 catalog，不另建平行素材库。

临时导入区是 `ip/.staging/<runId>/`；私有迁移回执是 `reports/asset-library/<runId>/migration.json`。目录映射、原始来源路径和清理证据只留在私有回执中。catalog 的素材路径全部采用项目相对路径和正斜线。

## 导入和安全清理

先确认 `PROJECT_ROOT` 与当前 Git 根、`package.json`、交付文档一致。不要根据旧路径另建工程或迁移整个项目。以下命令在现有项目根执行；`<...>` 表示必须替换的参数。先查看实际帮助：

```powershell
npm run ip:library -- --help
npm run ip:library -- migrate --help
```

CLI 可用显式 `--python` 选择已有 Python；包装器也支持 `EPVS_PYTHON`。不需要安装系统级工具。完整图像元数据检测需要该 Python 环境已有 Pillow；无 Pillow 时仍会逐字节保存和校验素材，但尺寸、透明度等未测字段保持 `null`，不能声称透明度检查已通过。日常 TypeScript 素材解析不依赖 Pillow。

```powershell
npm run ip:library -- migrate --source "<明确授权的源目录>" --run-id "<安全且稳定的批次ID>" --dry-run --python "<已有Python可执行文件>"
npm run ip:library -- migrate --source "<同一源目录>" --run-id "<同一批次ID>" --python "<已有Python可执行文件>"
npm run ip:library -- migrate --source "<同一源目录>" --run-id "<同一批次ID>" --resume --python "<已有Python可执行文件>"
npm run ip:library -- index --python "<已有Python可执行文件>"
npm run ip:library -- validate --python "<已有Python可执行文件>"
```

导入依次枚举全包、记录大小及 SHA-256、复制到独立 staging、重新读取源和 staging 校验、非覆盖地落入 originals、再次校验目标并生成索引。同名同内容复用；同名不同内容保留双方，并将本次文件放入 `originals/import-<runId>/`，记录映射。中断后的临时文件不进入正式 catalog；用相同批次的 `--resume` 继续，不能重新编号掩盖中断。

只复制并保留源时，回执会标明 `IMPORTED_SOURCE_RETAINED`；整体迁移状态可以是 `PARTIAL`。这不是文件复制失败，也不是源清理完成。源不存在且没有有效回执时会失败；只有有效迁移记录与所有正式目标一致，才可识别为 `ALREADY_MIGRATED`。历史路径在执行前已消失，不能据此声称由本流程完成清理。换用另一个导入源，不自动获得清理该来源的授权。

只有用户授权清理的精确来源，才能在完成真实短片验证之后执行：

```powershell
npm run ip:library -- migrate --source "<已授权清理的同一源目录>" --run-id "<同一批次ID>" --resume --cleanup --render-proof "<项目内真实渲染proof.json>" --ffmpeg "<已有ffmpeg.exe>" --ffprobe "<已有ffprobe.exe>" --python "<已有Python可执行文件>"
```

`--render-proof` 不是人工填写一个成功标记。它必须绑定当前 catalog、本任务冻结清单和实际 MP4 的 SHA-256，包含至少一个本批素材的冻结读取记录。门禁使用明确指定或项目工具配置中现有的 FFmpeg/FFprobe，实际检查 1920×1080、30fps、3–5 秒、完整解码结果和声明时长；拒绝伪造 MP4、损坏帧、错误哈希和越界路径。proof 不能指定任意可执行命令。

清理前逐文件重新读取源；Windows 同时持有目标及源文件的句柄，禁止并发写入/删除，哈希一致才在同一源句柄上删除。不同、被占用或权限不足的文件留在源处并报告。只删除具体已核验文件，再移除确认为空的目录；不递归强删。当前非 Windows 环境的源清理不具备同等实现，保留源并报告未完成。故障注入只在临时夹具执行。

## 审核、选择和冻结

catalog 条目记录稳定 `assetId`、`contentVersion`、原件 SHA-256、原件/派生/预览路径、派生哈希、媒体类型、尺寸、实际透明度、分层情况、角色、姿势、表情、内嵌文字、建议与限制用途、来源、权利说明和审核状态。新条目默认 `UNREVIEWED`。PNG/RGBA 并不保证透明，必须检查实际 alpha 像素。文件名不能替代对图像内容和品牌适用性的检查。

审核选择是局部的：检查一项原件或其派生版本，补充语义和权利说明，确认后才把该项设为 `APPROVED`。索引重建保留已存 assetId、语义和审核信息；发现原件内容漂移时拒绝静默替换。同内容的不同原始路径也保留各自来源关系。

所有新任务的输入必须包含：

```json
{
  "brandLibrary": {
    "selections": [
      {
        "assetId": "<已审核的assetId>",
        "contentVersion": "<catalog中的精确版本>",
        "sha256": "<本次实际选用文件的SHA-256>",
        "purpose": "在结尾介绍中表达作者与品牌的关系"
      }
    ]
  }
}
```

有 `preparedPath` 时，`sha256` 取其 `preparedHash`；否则取原件 `sha256`。选择必须与 catalog 的版本、哈希和 `APPROVED` 状态一致。无素材选择用 `selections: []` 并填写非空 `omissionReason`，但不能用它取消当前任务必需的原始 Logo、IP 或作者素材。

```powershell
npm run video -- init --input "<新任务输入.json>"
npm run video -- verify-input --project "<projectId>"
```

初始化将选定字节复制到 `projects/<projectId>/assets/brand-frozen/`，写入 `projects/<projectId>/frozen-brand-assets.json`。合成文件读取冻结清单中的 `jobPath`。同一任务恢复时验证冻结字节和原选择，不重新扫描 catalog 挑选新素材。素材库升级只影响未来任务；旧冻结文件损坏会报错，不能自动换成新版。历史视频与未使用新字段的历史任务原样保留。

## R2 质量验收

工程实现、素材库迁移和美术/声音验收分别成立。M1 要交付两套静态方向、8–12 秒动态样片和最多三种经授权的声音候选，集中获得用户对视觉、动效与声音的认可，才进入 M2 制作。3–5 秒素材读取 smoke 只证明资源链路与媒体解码，不等于 8–12 秒质量样片或最终影片合格。

HyperFrames 保持默认主链路。标题使用经过设计且许可明确的展示字体；正文与字幕清晰可读；镜头和转场服务于产品故事。使用原始公司 Logo，按场景意义选择 IP。作者介绍在片尾用可编辑的图像、文字与图形层设计，不直接贴完整海报。每个产品独立组织故事和画面。

旁白目标是年轻成年男声、标准普通话、温暖自然、无机械播报或夸张促销腔。安装了后端不代表声音已获认可。已经认可且内容未改变的画面、音频和实现直接复用；实际付费与外部上传仍需授权。未获认可的样片和声音保持候选状态，不能变成永久 Skill 默认值。质量计划相关操作只使用当前 CLI 帮助实际列出的命令。

分别报告 `MIGRATION`、`IP_LIBRARY`、`ENGINEERING_QA`、`VISUAL_REVIEW`、`VOICE_REVIEW`、`USER_ACCEPTANCE` 的 `PASS / PARTIAL / FAIL / NOT_RUN`。报告说明谁进行了视觉/声音评审，人工未听审就写 `NOT_RUN`；模型分数不能代替人工接受。当前 R2 不启用批量生产，不 Push、部署或公开发布。

## 完整本地备份与公开边界

Git 已跟踪文件清单不能作为完整备份清单。以下脚本直接遍历项目文件，包含 Git 忽略的品牌原件、派生图、预览、catalog、私有迁移回执、所有保留的视频、冻结任务、执行计划、`.tools` 和 `.git`。归档是私有项目备份，不能上传 GitHub、npm 或作为公开 Skill 包；其中也可能包含本地配置和私有报告。

```powershell
python -X utf8 scripts/backup-project.py --project-root "."
```

输出默认位于项目内 `.local-backup/project-<UTC时间>-<随机标识>.zip`，相邻 `.report.json` 为校验回执。可用 `--output` 指定 `.local-backup/` 内新的 ZIP 名称；已有归档和回执都不会覆盖。只需 Python 标准库，不依赖 Pillow。

备份仅排除备份输出目录 `.local-backup/`，以及任意层级中可重建的 `node_modules`、`.cache`、`.hyperframes` 目录。实际排除路径列入 manifest 和回执；依赖可依据锁文件重建。`.tools` 包含在备份内，因此模型、字体或工具可能使归档较大。`.git` 也包含在内，保留当前本地历史和工作区关联。

脚本为每个纳入文件记录大小与 SHA-256，保留空目录，写入 ZIP 后重新解压读取每一项校验字节和哈希，再核对源清单是否变化。Windows 文件操作内部使用扩展路径，支持超过 260 字符的项目、文件和归档路径，无需修改注册表或系统长路径设置；manifest 仍用项目相对路径，界面和回执仍显示普通路径。manifest 位于 ZIP 根的 `backup-manifest.json`，文件位于 `project/`。最终回执还记录 ZIP 整体 SHA-256、核验文件数、字节数、排除目录、无法纳入的路径及备份期间变化。

不跟随 symlink/junction/reparse 路径。仅以下已核实的两个依赖链接有明确排除规则：`.local-audit/github-oss-release/public-candidate/node_modules` 和 `.local-audit/github-oss-release/remediation/candidate-baseline/node_modules`。每次运行仍要求链接解析目标精确等于项目根下的 `node_modules`，且目标及其父路径无链接、目标是常规目录；满足时写入 manifest 与回执的 `excludedLinks`，记录相对路径、目标和 `REBUILDABLE_LINK_TO_PROJECT_NODE_MODULES` 原因，不读取其内容。任意其他链接、同名不同目标、目标本身仍为链接的情况都记录为未备份并返回 `PARTIAL`。

备份期间源文件或已排除链接的状态改变同样为 `PARTIAL`；异常则 `FAIL` 并保留本次未完成归档供检查。脚本始终保留原项目和视频。只有所有纳入文件核验通过且没有未处理链接或变化，才返回 `PASS`。应在停止其他项目写入后运行，并对实际回执作最终判断。

恢复时先选一个新的空目录，读取 manifest，解压 `project/` 并逐文件核对大小和 SHA-256，再恢复本地依赖、运行 catalog 验证与短片读取验证。不要直接覆盖现有项目。当前脚本只负责创建与核验备份，不自动恢复或替换工程。
