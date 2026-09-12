# 项目内 IP 素材库

`originals/` 保存完整原件及原文件名/子目录；`prepared/` 保存按需非破坏处理的版本；`previews/` 是可重建的轻量浏览资料；`catalog.json` 是本地私有索引。权利范围见上级 `ASSET-RIGHTS.md`。

新任务读取 catalog，按产品语义选择稳定 assetId 与已审核 contentVersion/sha256，再冻结为任务的 `frozen-brand-assets.json` 与 `assets/brand-frozen/`。恢复任务核对旧快照，不重新选图、不自动追随素材升级。不用 IP 也应记录明确的 omissionReason。

`npm run ip:library -- index` 重建索引；`npm run ip:library -- validate` 验证原件、派生图和覆盖率。Python 可通过 `--python` 指定；图片测量需要 Pillow，缺失时元数据为未知，不能当作审核通过。迁移及条件清理仅限一次性显式输入，详见项目 IP 素材库指南。日常生成不扫描任何桌面来源。
