# Remotion 本地模式许可边界

本项目固定使用 Remotion `4.0.529`、`@remotion/bundler` `4.0.529` 和
`@remotion/renderer` `4.0.529`。它们只在用户明确选择 `renderMode: "remotion"`
或传入 `--renderer remotion` 时，在本机执行 React 时间线打包和渲染。

Remotion 不是本项目 Apache-2.0 代码的一部分。它是 source-available 软件，按
Remotion 自己的许可和商业条款提供；React 与其他传递依赖仍按各自许可证提供。

按 2026-09-27 查阅的官方许可 FAQ，个人、总人数不超过 3 人的组织或团队、非营利
组织，以及尚未商业使用的评估者符合免费许可条件。符合免费条件的使用者也可以运行
自动化并进行商业使用。官方将以代码调用 `renderMedia()` 等接口来自动生成视频的
流程归类为自动化；总人数达到 4 人或以上的组织应按自己的使用方式购买相应公司许可。
当前 Remotion 模式会调用 `renderMedia()`，因此团队规模与用途会影响使用者的许可
义务。官方许可 FAQ 也限制出售 Remotion 本身或让用户规避其许可要求；本项目不接受
用户上传任意 Remotion 工程供服务器代渲染。

本说明不是对任何组织资格的法律判断。本仓库不购买或代用户启用许可，也不声称
Remotion 受 Apache-2.0 许可；使用前应复核当前官方条款。

官方规则和价格可能变化。公开分发、团队使用、自动化批量渲染或服务化前，实际使用
方应核对自己的组织人数、业务方式和当前官方条款：

- [Remotion License FAQ](https://convert.remotion.dev/docs/license/faq)
- [Remotion Pricing and licensing](https://convert.remotion.dev/docs/license/pricing)
- [Remotion license page](https://www.remotion.dev/license)

当前实现没有云渲染、Job API、对象存储、数据库、自动发布或外部素材上传。Remotion
模式生成的报告和 MP4 留在本地项目目录；输出文件不因此获得 Apache-2.0 许可。
公开发布还必须分别审查品牌素材、人物图片、旁白、音乐和视频内容的权利。
