[![CI](https://github.com/zidell/ginote/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/zidell/ginote/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/zidell/ginote/branch/main/graph/badge.svg)](https://codecov.io/gh/zidell/ginote)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | [한국어](README.ko.md) | **简体中文** | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Italiano](README.it.md) | [Español](README.es.md)

# Ginote

## 简介

Ginote 是一个简单、安全的 Web 应用，让你把 GitHub Issues 当作个人笔记来使用。
我个人很喜欢 GitHub Issues，但一直对它反应迟缓、用户体验不便感到不满。于是我做了这个
SPA 应用：功能几乎原样保留，只把使用体验做得像笔记应用一样。本应用仅由静态 JS 构成，
浏览器直接与 GitHub API 通信，因此是安全的。

在线地址（任何人都可以直接使用）：[https://note.gitools.net](https://note.gitools.net)

## 界面

![Ginote 使用预览](docs/preview.gif)

重新生成预览 GIF 的方法见 [docs/screencasting.md](docs/screencasting.md)。

## 主要特性

- **直接保存到私有仓库：** 无需单独的应用服务器或数据库，把私有（Private）仓库中的
  Issue 用作笔记。
- **浏览器直连：** 浏览器直接调用 GitHub API。不存在由应用运营方接收或保管笔记、PAT
  的中间服务器。
- **标签、搜索与回收站：** 使用 GitHub Label 作为标签（每个标签还可以附上分类说明），
  支持正文搜索以及基于已关闭 Issue 的回收站。常看的笔记可以置顶。
- **评论：** 把 Issue 评论用作追加在笔记后的记录。评论同样可以添加附件或用语音输入。
- **文件与图片附件：** 正文和评论的附件都保存在同一个仓库中，在应用和 GitHub 上都能
  查看。详情请参阅[附件存储方式](docs/ATTACHMENTS.md)。
- **语音录制、转写与润色（仅限 OpenAI）：** 在浏览器中录制的语音会直接发送到 OpenAI
  进行转写，并可将转写内容润色为自然的书面文字。润色时还可以生成标题、推荐已有标签，
  必要时也能把原始音频作为笔记附件保留。语音功能目前仅支持 OpenAI API。
- **笔记锁定（正文额外加密）：** 如果仅保存在私有仓库还不够，可以用 6 位数字锁定笔记，
  在浏览器中用 AES-GCM 对正文和评论再加密一次。详情请参阅[加密方式](docs/ENCRYPTION.md)。
- **编辑工具：** 可以把多条笔记合并为一条，在正文中查找替换（支持正则表达式），并用
  Markdown 查看器查看渲染结果。
- **多仓库切换：** 可以注册多个仓库，通过列表或数字键直接切换。
- **键盘操作：** 可以用键盘在笔记列表中移动、打开、选择笔记，新建笔记，切换仓库等。
- **MCP 集成：** 连接 GitHub 官方 MCP Server 后，AI 工具也能读写同样的笔记（Issue）。
  不需要额外的应用专用 MCP 服务器。
- **支持 Web 与桌面端：** 提供可安装的 PWA，以及基于 Tauri 的 macOS、Windows、Linux
  应用。桌面应用的打包与发布请参阅[桌面应用文档](docs/DESKTOP.md)。

## 使用说明

### 我的数据会去哪里？

**Ginote 是以文件形式提供的静态 Web 应用。** 部署服务器只负责分发 HTML、CSS、
JavaScript 等应用文件。没有处理登录或笔记存储的应用后端，应用打开后的所有数据通信
都直接发生在你的浏览器和 GitHub API 之间。

```text
你的浏览器  ←──── 直接通信 ────→  GitHub
     │
     └─ PAT、应用设置和未保存的草稿只保存在此浏览器中
```

- 笔记、标签和附件只保存在你指定的 GitHub 仓库中。
- PAT 和应用设置只保存在你的浏览器中，仅在认证时发送给 GitHub API。
- 未保存的草稿只留在该浏览器中。
- 可选的笔记加密说明见[加密方式](docs/ENCRYPTION.md)。
- 不存在向应用运营方发送笔记、PAT 或设置的 API，也不使用任何分析或追踪服务。

也就是说，除了下载应用文件的请求之外，你的数据不会被发送给 GitHub 以外的应用运营方
或其他服务器。笔记数据实际存在的地方，**只有你自己的浏览器和你选择的 GitHub 仓库**。

### 使用语音录制

首次使用语音录制前需要一个 OpenAI API 密钥。在 OpenAI 创建 API 密钥后，填入 Ginote 的
**设置 → 语音录制 → OpenAI API 密钥**。OpenAI 可能会根据 API 用量收取费用。

设置完成后，可以通过侧边栏或笔记界面中的麦克风按钮开始录音。录音结束后，会先将语音
转写，再应用可选的润色模型和润色规则，提出正文、标题和已有标签的建议。你可以在设置中
更改转写模型、润色模型以及常用转写词汇；如果将润色模型留空，则只记录转写原文。开启
**保留原始音频**后，成功录制的原始音频也会作为该笔记的附件保存。

音频文件和转写文本会从浏览器直接发送到 OpenAI API，不经过应用服务器。API 密钥以明文
形式保存在此设备浏览器的 `localStorage` 中，因此请只在个人设备上使用，并建议使用专用
项目密钥、设置用量上限并定期轮换。

### 键盘快捷键

在笔记列表中可以使用以下快捷键。在输入框中输入文字时，列表快捷键不会生效。
`Ctrl/Cmd + R` 是浏览器的刷新快捷键，在任何地方都会重新加载应用。

| 按键 | 操作 |
| --- | --- |
| `↑` / `↓` | 在笔记列表中移动 |
| `Enter` | 打开当前笔记 · 再按一次进入编辑 |
| `N` | 新建笔记 |
| `` ` `` | 打开仓库选择框 |
| `1`–`9` | 按注册顺序切换仓库 |
| `Esc` | 取消选择 · 取消删除 · 关闭提示 |
| `Space` | 选择当前笔记 |
| `Shift` + `↑` / `↓` | 范围选择多条笔记 |
| `Delete` / `Backspace` | 将选中的笔记移到回收站 |
| `Ctrl/Cmd + R` | 刷新应用 |

打开笔记且输入框没有焦点时，还可以使用以下快捷键。

| 按键 | 操作 |
| --- | --- |
| `T` | 添加标签 |
| `A` | 添加附件 |
| `P` | 切换置顶 |
| `L` | 锁定 · 解锁 |
| `Delete` | 将笔记移到回收站 |
| `G` | 查看 GitHub Issue |
| `M` | 打开 · 关闭 MD 查看器 |
| `R` | 刷新整个应用 |
| `S` | 保存当前笔记 |

### PWA（可安装的 Web 应用）

生产构建可作为 PWA 运行，可以从浏览器安装并像应用一样使用。在浏览器中打开在线地址后，
使用浏览器的安装菜单即可。Manifest 和 Service Worker 不依赖于任何特定域名或托管服务，
而是以应用部署的路径为基准运行。Service Worker（让浏览器临时保存应用文件的功能）只缓存
与应用同源的文件，不会缓存 GitHub API 请求、PAT 或笔记数据。

### 下载桌面应用

macOS、Windows、Linux 的安装包可以在 [GitHub Releases](https://github.com/zidell/ginote/releases)
下载。macOS 使用 DMG，Windows 10/11 使用 MSI。SignPath Foundation 签名配置完成后，新的
Windows 版本将以已签名的 MSI 发布。桌面应用会打开 [note.gitools.net](https://note.gitools.net)，
需要联网。界面和一般功能的修改会通过 Web 部署生效。

[Code signing policy](docs/CODE_SIGNING.md)

macOS Homebrew 安装、本地运行、各平台打包及发布流程请参阅[桌面应用文档](docs/DESKTOP.md)。

## 运维与开发

修改 Web 应用时，请按照锁定文件安装依赖，并在部署前确保静态检查、测试和生产构建全部
通过。应用以静态文件形式部署，桌面应用的打包与签名则与 Web 部署分开管理。涉及数据格式
或安全的变更，请先查阅附件和加密文档。开发环境、验证命令以及部署和维护流程请参阅
[开发与运维文档](docs/DEVELOPMENT.md)。

## 功能请求

如果有功能需求，请 fork 后自行修改。它对我来说已经够用了，因此不接受额外的功能建议。

## 许可证

[MIT License](LICENSE)
