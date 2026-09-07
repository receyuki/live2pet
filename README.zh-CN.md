<h1 align="center">Live2Pet</h1>

<p align="center"><strong>把喜欢的角色，变成桌面上的陪伴。</strong></p>
<p align="center">将 Live2D 与 Spine 动画制作成 Clawd on Desk 和 Codex 桌面宠物。</p>

<p align="center">
  <a href="https://github.com/receyuki/live2pet/releases"><img src="https://img.shields.io/badge/release-coming%20soon-9087ff?style=flat-square" alt="Release: coming soon"></a>
  <a href="https://github.com/receyuki/live2pet/stargazers"><img src="https://img.shields.io/github/stars/receyuki/live2pet?style=flat-square&color=9087ff" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/platform-macOS-111118?style=flat-square&logo=apple&logoColor=white" alt="Platform: macOS">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/receyuki/live2pet?style=flat-square&color=9087ff" alt="License: Apache-2.0"></a>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/Electron-111118?style=flat-square&logo=electron&logoColor=9feaf9" alt="Electron">
  <img src="https://img.shields.io/badge/React-111118?style=flat-square&logo=react&logoColor=61dafb" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-111118?style=flat-square&logo=typescript&logoColor=3178c6" alt="TypeScript">
  <a href="https://www.heroui.com/"><img src="https://img.shields.io/badge/UI-HeroUI-111118?style=flat-square" alt="HeroUI"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a><br>
  <a href="#开始使用">开始使用</a> · <a href="docs/guides/user-guide.zh-CN.md">使用指南</a> · <a href="https://github.com/receyuki/live2pet/issues">反馈问题</a>
</p>

<p align="center"><img src="docs/assets/app-preview.png" alt="Live2Pet 映射工作区：选择动画、实时预览猫咪模型，并关联 Clawd 宠物状态" width="100%"></p>

<p align="center"><sub>浏览 → 预览 → 映射 → 生成，全程在你的电脑上完成。</sub></p>

## 目录

[你可以做什么](#你可以做什么) · [三步制作宠物](#三步制作宠物) · [开始使用](#开始使用) · [支持范围](#支持范围) · [运行时](#runtime-setup) · [了解更多](#了解更多)

## 你可以做什么

| | 让宠物更像你喜欢的样子 |
| --- | --- |
| **找到喜欢的角色** | 浏览本地模型库或 GitHub 文件夹，只下载选中的模型。 |
| **看清每一个动作** | 实时播放、暂停、拖动进度，挑出最合适的动画。 |
| **留下角色，隐藏杂物** | 通过部件小图识别并隐藏可分离的背景、遮罩或特效。 |
| **一个项目，两种去处** | 将动作关联到 Clawd 或 Codex 状态，直接生成宠物包。 |
| **下次接着做** | 保存项目、自动复用运行时，支持中英文界面。 |

## 三步制作宠物

1. **选一个模型** — 拖入文件夹或受支持的 PCK，也可以浏览 GitHub 模型集合。
2. **调整成喜欢的样子** — 预览动作、隐藏多余部件、关联宠物状态。
3. **生成，放上桌面** — 起名字、选画质，保存 ZIP 或安装到目标应用。

模型在本地处理，原始资源保持不变。

## 开始使用

**macOS 预览阶段 · 可从源码构建 · 公开安装包稍后提供。**

目前需要 Git、Node.js 22.12+ 和 pnpm 11。构建未签名 App：

```sh
git clone https://github.com/receyuki/live2pet.git
cd live2pet
corepack enable
pnpm install
pnpm --filter @live2pet/desktop package:mac
open apps/desktop/out/Live2Pet-darwin-*/Live2Pet.app
```

首次启动时添加运行时，再选择模型即可。[安装说明与常见问题 →](docs/guides/user-guide.zh-CN.md)

## 支持范围

**支持导入**

- Live2D Cubism 2–5 模型文件夹
- 受支持的 Live2D PCK 文件
- Spine 4.0–4.3 文件夹，需可选渲染器

**支持导出** — 受支持的模型均可选择以下任一目标：

- **[Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk)** — 包含透明 WebP 动画的主题
- **Codex 自定义宠物** — V2 动画图集

也可以保存为 **.live2pet** 项目，方便以后继续编辑。

Spine 仍在预览阶段，Windows 支持已列入后续计划。PCK 是否可用取决于其内容和封装方式。[详细兼容性与限制 →](docs/guides/user-guide.zh-CN.md#compatibility)

<a id="runtime-setup"></a>

## 运行时

**添加一次，后续自动复用。** Live2D 运行时受独立条款约束，需要单独取得。将下载的运行时文件或解压后的 SDK 文件夹拖入“设置 → 运行时”。

| 模型版本 | 获取方式 |
| --- | --- |
| Cubism 3–5 | [官方 Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/) → `Core/live2dcubismcore.min.js` |
| Cubism 2 | 从[第三方旧版存档](https://github.com/dylanNew/live2d/tree/master/webgl/Live2D/lib)获取 `live2d.min.js` |
| Spine 4.0–4.3 | 在 App 中为匹配的渲染器点击“安装” |

[为什么需要单独下载？详细配置与许可说明 →](docs/guides/user-guide.zh-CN.md#runtimes)

## 了解更多

- **使用帮助：** [使用指南与常见问题](docs/guides/user-guide.zh-CN.md)
- **接下来的计划：** [Issues](https://github.com/receyuki/live2pet/issues) · [V1 计划](docs/plans/live2pet-v1-implementation-plan.md)
- **参与开发：** [贡献指南](CONTRIBUTING.md) · [开发文档](docs/guides/development.md)
- **安全问题：** [漏洞报告](SECURITY.md)

使用 Electron、React、TypeScript 和 HeroUI 构建。源代码采用 [Apache-2.0](LICENSE) 许可。

<sub>模型与运行时保留各自的许可。预览图仅展示使用效果，图中模型不随项目分发。参见[第三方声明](NOTICE)。</sub>
