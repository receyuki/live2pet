# Live2Pet

[English](README.md) | [简体中文](README.zh-CN.md)

将 Live2D 模型转换为可移植的 Agent 桌面宠物包。

Live2Pet 是一款仍在开发中的本地桌面工具：加载 Cubism 模型，预览原始动作，将动作映射到不同宠物宿主的状态，生成经过校验的 Clawd 主题包和 Codex 自定义宠物包。当前 V1 里程碑限定为个人使用的 macOS App。

界面以项目为中心：首次引导和欢迎页突出实际操作，不显示装饰吉祥物；空预览会明确说明缺少什么。设置页与工作区使用一致的顶部栏，“完成”位于右上角。系统 App 图标保持不变。

<a id="runtime-setup"></a>

## 运行时配置：为什么需要单独下载？

模型保存角色数据，运行时则负责让角色动起来。Live2Pet 包含界面和渲染适配器，但选择不内置、不自动下载 Live2D 的专有运行时。运行时适用的许可与本仓库源代码不同，需要你自行从对应来源获取并阅读条款。导入运行时并不意味着获得模型使用权或生成宠物的发布权。

| 你的模型 | 需要导入的运行时 | 获取方式 |
| --- | --- | --- |
| Cubism 3 及之后的模型（`.model3.json` / `.moc3`） | Cubism Core for Web，通常为 `Core/live2dcubismcore.min.js` | [Live2D 官方 Cubism SDK for Web 下载页](https://www.live2d.com/zh-CHS/sdk/download/web/)：下载 SDK 后先解压。 |
| Cubism 2 模型（`.model.json` / `.moc`，包括部分 PCK 资源包） | 旧版 Web 运行时 `live2d.min.js` | 第三方旧版来源：[dylanNew/live2d 运行时目录](https://github.com/dylanNew/live2d/tree/master/webgl/Live2D/lib)，或[打开原始 JavaScript 文件](https://raw.githubusercontent.com/dylanNew/live2d/master/webgl/Live2D/lib/live2d.min.js)并另存为 `live2d.min.js`。 |

Cubism 2 请保存 JavaScript 文件本身，不要保存 GitHub 的 HTML 网页，然后将文件拖入 Live2Pet。上述仓库是**第三方副本**，不是 Live2D 官方或持续维护的下载渠道。[Live2D 的公告](https://help.live2d.com/en/other/other_20/)说明已停止提供新的 Cubism 2.1 SDK 下载。使用前请检查来源与适用的运行时许可；GitHub 上公开可见不等于获得使用授权。Live2Pet 只提供链接，不内置、不自动下载，也不重新分发该文件。

SDK 下载页会要求阅读 Live2D 的软件许可。请选择 **Web SDK**，而不是 Editor、Unity SDK 或 Native SDK。现代 Core 无法代替 Cubism 2 运行时。PCK 只是容器格式，不代表特定运行时版本，也不保证其中的资源一定受支持。

1. 将下载的 SDK 解压到本地。
2. 在首次引导或 **设置 → 运行时** 中拖入 JavaScript 运行时文件或已解压的 SDK 文件夹，也可以点击 **添加运行时 / 选择 SDK 文件夹**。
3. Live2Pet 会识别版本并保存一份本地副本。**不需要自行构建 App，也不需要每次启动重新导入**。可以同时保存两代运行时，之后根据模型自动选择。

只导入可信来源的运行时代码。在设置中删除已保存的运行时不会删除原始文件。可以先跳过配置来检查资源，但播放模型和捕获动画需要匹配的已保存运行时。本节针对当前 Live2D 流程，不表示 Spine 支持已完成。

App 的“下载指南”按钮会在系统浏览器中打开本节，并根据 App 当前语言选择中文或英文 README。

## 项目组成

- `apps/mapper/`：浏览器版 Live2D 动作预览和映射参考工具，包含 Clawd 待机/分层行为池、Codex 九行映射、本地 Codex ZIP 回退构建、共享 App Clawd 构建、生成结果预览、实际尺寸播放和明确的安装操作。运行时不依赖 CDN；现代 Core 和 Cubism 2 的 `live2d.min.js` 均由用户本地选择，副本仅保存在浏览器配置中，清除操作移除这些副本。中英文界面不改变项目或包格式。
- `packages/source-inspector/`：标准 Cubism 文件夹和受支持 Live2D PCK 的规范化资源检查 API 与版本化 `live2pet-inspect` CLI。
- `packages/project/`：仅保存引用的 `.live2pet` 项目格式、可复用的动作与表情配方、各目标渲染预设、确定性序列化、原子文件读写、自动保存恢复、资源重新关联和变更确认。
- `packages/runtime/`：用户提供的 Cubism 运行时发现、受限校验、脱敏诊断、App 管理的持久化副本及按版本自动选择。
- `packages/renderer/`：版本化播放/捕获接口、确定性动作采样、供 CI 使用的版权安全合成渲染器，以及现代和旧版 Pixi 适配器的自动选择。
- `packages/frame-selection/`：基于动作的候选帧去重与有序图集选帧。
- `packages/package-build/`：可取消的 Codex 和 Clawd 构建，包括共享渲染器 RGBA 捕获、目标预设、校验后的候选帧和编码缓存复用、无本地路径的构建来源记录与简明报告、生成结果预览计划、目标格式校验、安全版本化文件名、RGBA 合成、Sharp WebP 编码、确定性清单、大小限制、zip.js 打包、变更确认和有容量边界的磁盘缓存。
- `packages/cli/`：统一 JSON CLI，支持资源检查、运行时诊断、项目校验、使用临时预捕获输入的共享构建、ZIP 校验、导出/安装及缓存管理。
- `packages/installation/`：生成包的显式安装与冲突处理；构建、下载不会隐式安装。
- `packages/app-host/`：类型化 IPC 路由、preload API、下载/安装边界、不透明本地位置句柄及加固的窗口默认配置。
- `apps/desktop/`：Electron App，默认使用 React/TypeScript/HeroUI 界面，包含首次引导、欢迎页、完整设置页和资源/映射/构建工作区。支持保存项目、预览模型、构建 ZIP 和明确安装，不内置用户运行时或模型。中间列是唯一的资源预览；`apps/mapper/` 只是开发参考，不是 App 入口。
- `packages/clawd-target/`：遵循宿主指南的状态、睡眠模式、回退与互动反应校验。
- `packages/codex-target/`：版本化 Codex V1/V2 图集规格、九行动作映射、帧引用布局、RGBA 合成和包结构校验。桌面构建使用 [V2 中立视线姿势方案](docs/codex-sprite-v2.md)。
- `packages/live2d-exporter/`：确定性透明帧导出和 Live2D PCK 解包。
- `docs/research/`：架构、集成及生态调研。
- `docs/agents/`：供工程工作流使用的仓库规范。

## 规划材料

以下工程材料目前使用英文：

- [`CONTEXT.md`](CONTEXT.md)：共享领域术语。
- [`docs/adr/`](docs/adr/)：已确认的架构与产品决策。
- [`docs/specs/live2pet-v1.md`](docs/specs/live2pet-v1.md)：个人使用 V1 的产品范围与验收规格。
- [`docs/agents/project-workflow.md`](docs/agents/project-workflow.md)：项目保存/恢复、资源重新关联、变更确认与隐私规范。
- [`docs/plans/live2pet-v1-implementation-plan.md`](docs/plans/live2pet-v1-implementation-plan.md)：剩余任务顺序、issue 对应关系与验收门槛。
- [`docs/dependency-inventory.md`](docs/dependency-inventory.md)：固定版本依赖、原生模块与用户提供资源的边界。
- [`docs/release-checklist.md`](docs/release-checklist.md)：源码公开、本地 macOS 验证和安装包发布检查。

## 仅保存在本地的数据

角色模型、渲染帧、主题示例和发布 ZIP 均有意排除在 Git 之外，仅在本地的 `examples/`、`.work/`、`archive/`、`artifacts/` 等目录保存，不属于开源仓库内容。

Live2Pet 不授予任何导入模型、纹理、动作或衍生动画的使用权。Cubism Core 同样只保存在本地，本仓库不分发。运行时来源及一次性导入步骤见[运行时配置](#runtime-setup)。

## 开发状态

默认 HeroUI App 已实现核心资源检查、项目管理、映射、中间列资源预览、目标构建、进度、缓存、校验、生成结果预览、下载和显式安装。V1 尚需完成实际宿主安装验收、共享模型可见性、可选的指定版本 Spine 支持，以及最终 macOS 无障碍与发布验证。

Codex Skill 集成、托管 Mapper Session、独立预览窗口、官方 Cubism Web Framework 桥接、Windows 验证及公开签名安装包均不属于 V1 产品范围。当前优先级与关闭条件见[实施计划](docs/plans/live2pet-v1-implementation-plan.md)。

## 本地验证

启动默认桌面 App，或构建本地未签名 macOS App：

```sh
pnpm --filter @live2pet/desktop start
pnpm --filter @live2pet/desktop package:mac
pnpm --filter @live2pet/desktop smoke:mac
```

启动和打包命令会自动构建 HeroUI 资源并准备内部渲染依赖。打包后的 App 不需要 Vite 服务或预览参数；`preview:shell` 保留为 `start` 的别名。

真实模型的可选桌面验收步骤见[本地验收指南](docs/desktop-acceptance.md)。

```sh
pnpm test
pnpm typecheck
pnpm release:check
node packages/source-inspector/bin/live2pet-inspect.cjs --input /path/to/source-package --pretty
node packages/cli/bin/live2pet.cjs version --pretty
node packages/cli/bin/live2pet.cjs inspect --input /path/to/source-package --pretty
node packages/cli/bin/live2pet.cjs runtime-diagnose --input /path/to/CubismCore.js --pretty
node packages/cli/bin/live2pet.cjs project-validate --input /path/to/project.live2pet --pretty
node packages/cli/bin/live2pet.cjs project-recover --input /path/to/project.live2pet --pretty
node packages/cli/bin/live2pet.cjs package-build --input /path/to/build-spec.json --output /path/to/exports --pretty
node packages/cli/bin/live2pet.cjs package-validate --input /path/to/package.zip --pretty
node packages/cli/bin/live2pet.cjs export --input /path/to/package.zip --output /path/to/export.zip --pretty
node packages/cli/bin/live2pet.cjs install --input /path/to/package.zip --target codex-pet --target-root /path/to/pets --confirm-install --pretty
node packages/cli/bin/live2pet.cjs cache-status --cache-dir /path/to/cache --pretty
node packages/cli/bin/live2pet.cjs cache-clear --cache-dir /path/to/cache --project-id my-project --pretty
# 可选真实运行时测试：仅使用本地输入，不要提交实际路径
LIVE2PET_MODERN_RUNTIME=/path/to/live2dcubismcore.min.js LIVE2PET_MODERN_SOURCE=/path/to/modern-model \
  node --test packages/renderer/test/modern-runtime.integration.test.cjs
LIVE2PET_CUBISM2_RUNTIME=/path/to/live2d.min.js LIVE2PET_CUBISM2_SOURCE=/path/to/destiny-child-model \
  node --test packages/renderer/test/legacy-runtime.integration.test.cjs
```

资源检查输出只包含元数据：相对资源标识、指纹、警告和动作/表情目录，不包含模型字节、运行时二进制、访问令牌或无关的绝对路径。浏览器预览使用版本匹配的 Pixi `@pixi/unsafe-eval` 兼容模块，在现有严格 CSP 下仅允许生成的 `blob:` 资源 URL，不启用通用 `unsafe-eval`。
