# MCP Harness

> 开源本地工具：管理 MCP 服务器并接入到编程 Agent。

[English](README.md) · [中文](README.zh.md)

**mcp-bridge-harness** 是一个开源的本地工具，用来管理 MCP 服务器，并把它们接入到 OpenCode、Codex-兼容工作流、Claude Code 工作流以及其他开发者 Harness 这样的编程 Agent。

它以一个跨平台桌面应用（Electron）的形式交付：开发者可以在本机一个地方完成 Model Context Protocol（MCP）服务器的安装、配置、版本锁定和分发——不必再为每个 Agent 手改 JSON 配置文件，也不用把 API Key 写进这些文件。

## 它能做什么

- **本地优先的桌面 App** — Electron 壳层；MCP 二进制、secrets、状态都放在每用户数据目录里。没有云账号、没有遥测、没有按席位授权。
- **Agent 中立分发** — 一次安装即可通过可插拔 adapter 投递给 OpenCode、Codex-兼容工作流、Claude Code 工作流、Cursor、VS Code 等开发者 Harness。
- **Secret-safe 配置** — API Key 存在本机 `secrets.json` 里；agent 配置只拿到 `MCP_HARNESS_HOME` 和一条 stdio 命令，永远拿不到 key。
- **跨平台安装包** — Windows 用 NSIS 安装包 + 免安装绿色版，macOS 用 `.dmg`，Linux 用 `.AppImage`，全部基于 `electron-builder`。
- **Catalog 化骨架** — 预留 download URL、checksum / 签名、健康检查、版本锁定、per-adapter 输出等位置。

## 当前进度（v0.2）

- **已交付** — 桌面 App 壳层（Electron + IPC）；本机 Harness state / secrets / logs；OpenCode adapter（写入 `opencode.json` 并自动备份）；内置 `minimax-bridge` MCP（搜索、图像、视频、语音、音乐、声音复刻）。
- **已预留** — Codex / Claude Code / Cursor / VS Code adapter；MCP 市场 UI（下载、签名、健康检查、多 Harness 同步）。

## 项目定位

```text
MCP Harness Desktop App
  ├─ Electron shell
  │   ├─ desktop/main.cjs
  │   └─ desktop/preload.cjs
  ├─ Renderer UI
  │   └─ web/
  ├─ Local Harness API
  │   └─ src/harness/api.ts
  ├─ Harness Adapters
  │   └─ OpenCode Adapter ✅
  └─ Bundled MCP Servers
      └─ MiniMax Bridge MCP ✅
```

`src/harness/server.ts` 仍保留，但只是 legacy / development fallback：

```bash
npm run serve
```

主入口是桌面 App，不要求用户手动打开浏览器访问 `127.0.0.1`。

## 快速开始

### Windows（用户）

直接下载 release 页面里的安装包：

```text
mcp-harness-0.2.0-x64-setup.exe    # NSIS 安装包（推荐，会创建桌面 + 开始菜单快捷方式）
mcp-harness-0.2.0-x64-portable.exe # 免安装绿色版，双击即可运行
```

下载后双击 `mcp-harness-0.2.0-x64-setup.exe`：

1. 选择安装目录（默认 `C:\Program Files\MCP Harness`）。
2. 勾选「创建桌面快捷方式」和「创建开始菜单快捷方式」。
3. 安装完成，桌面会出现 **MCP Harness** 图标。
4. 双击图标即可启动本地 MCP 管家桌面程序。

### 视频教程

- **安装教程**：[MCP Harness 安装教程（Bilibili）](https://www.bilibili.com/video/BV1dj5F6aEJa/?vd_source=a58871624315dd079f4e4f7f33690416)
- **进阶使用教程**：[MCP Harness 进阶使用教程（Bilibili）](https://www.bilibili.com/video/BV1T7V66cEi8/)

### Windows（开发）

双击：

```bat
install.bat
```

或者命令行：

```bat
npm install
npm run build
npm run app
```

### macOS / Linux（用户）

下载 `mcp-harness-0.2.0-*.dmg` 或 `mcp-harness-0.2.0-*.AppImage`，分别拖入 `Applications` 或 `chmod +x` 后双击运行。

### macOS / Linux（开发）

```bash
chmod +x install.sh
./install.sh
```

或者：

```bash
npm install
npm run build
npm run app
```

## 打包桌面安装包

```bash
# 仅 Windows（NSIS 安装包 + 绿色版）
npm run dist:win

# 跨平台
npm run dist:mac
npm run dist:linux
npm run release:desktop   # 当前平台 + 重新生成 agent.manifest.json
```

构建产物统一输出到 `release/desktop/`：

```text
mcp-harness-0.2.0-x64-setup.exe       # NSIS 安装包
mcp-harness-0.2.0-x64-portable.exe    # 免安装单文件
mcp-harness-0.2.0-arm64-dmg.dmg       # macOS
mcp-harness-0.2.0-x64-appimage.AppImage  # Linux
win-unpacked/                         # 解包后的运行目录（用于调试）
```

构建基于 `electron-builder` + NSIS：

- `appId`: `com.mcpharness.desktop`
- 安装时自动创建桌面图标和「开始菜单 → MCP Harness」快捷方式
- 默认 `oneClick=false`，允许选择安装目录
- `perMachine=false`，装在当前用户下，不需要管理员
- 卸载时保留 `appDataDir` 下的本地数据

> 注意：当前主机如果在 Synology Drive / OneDrive 这类同步盘下构建，`rcedit` 写图标时会被驱动拦截（`Unable to commit changes`）。这是非致命错误，**安装包仍然能正常生成并运行**，只是不会嵌入自定义图标。解决办法是把源码 `Copy-Item` 到本地目录（如 `%TEMP%`）后在那里执行 `npm install && npm run dist:win`。

## 安装脚本

`install.bat` / `install.sh` 仅用于开发环境，从源码直接跑 Electron。普通用户请直接下载 release 里的安装包。

它们会：

1. 安装依赖，包括 Electron 桌面运行时。
2. 构建 TypeScript 项目。
3. 初始化本地数据目录。
4. 自动把内置 MiniMax Bridge MCP 安装到 Harness state。
5. 打开 MCP Harness 桌面 App。

## 使用方式

启动桌面管理器：

```bash
npm run app
```

或：

```bash
npm run harness
```

打开桌面 App 后进入：

```text
Harness 目标 → OpenCode → 进入配置 OpenCode
```

然后：

1. 填入 MiniMax API Key。
2. 确认 API Host、输出目录、TTS 模式。
3. 默认启用官方 MiniMax MCP Proxy，官方 `minimax-mcp-js` 已支持的生成工具会优先转发到官方 MCP。
4. 按需启用 Token Plan MCP Proxy。
5. 点击 **保存并配置到 OpenCode**。
6. 重新打开 OpenCode，即可直接使用 `minimax-bridge` MCP。

MCP Harness 会写入：

```text
~/.config/opencode/opencode.json
```

Windows 上同样使用用户目录下的：

```text
%USERPROFILE%\.config\opencode\opencode.json
```

写入前会自动备份原配置，例如：

```text
opencode.json.bak-2026-05-31T15-00-00-000Z
```

## OpenCode 写入示例

MCP Harness 会把 OpenCode 配置合并成类似这样：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "minimax-bridge": {
      "type": "local",
      "command": [
        "node",
        "/absolute/path/to/dist/index.js",
        "mcp",
        "minimax-bridge",
        "--profile",
        "default"
      ],
      "enabled": true,
      "timeout": 120000,
      "environment": {
        "MCP_HARNESS_HOME": "/absolute/path/to/local/harness/data"
      }
    }
  }
}
```

API Key 不写入 `opencode.json`。它保存在本机 Harness data 目录下的 `secrets.json`，OpenCode 启动 MCP 时只拿到 `MCP_HARNESS_HOME`，由内置 MCP 读取本地 profile。

## 本地数据目录

默认路径：

| 系统 | 路径 |
|---|---|
| Windows | `%LOCALAPPDATA%\McpHarness` |
| macOS | `~/Library/Application Support/McpHarness` |
| Linux | `~/.local/share/mcp-harness` |

可用环境变量覆盖：

```bash
MCP_HARNESS_HOME=/custom/path npm run app
```

目录中会保存：

```text
state.json       # 已安装 MCP、Harness 绑定状态
secrets.json     # 本机 profile secrets，POSIX 系统会尝试 chmod 600
catalog.json     # 内置市场快照
outputs/minimax  # 默认生成文件输出目录
logs/harness.log # 安装/配置日志
```

## 命令

```bash
# 启动桌面 App
node dist/index.js app

# 初始化 Harness 本地状态
node dist/index.js install

# 初始化并打开桌面 App
node dist/index.js install --open

# legacy localhost web dashboard，仅开发/兼容用途
node dist/index.js serve

# OpenCode 实际启动的 MCP stdio 命令
node dist/index.js mcp minimax-bridge --profile default

# 查看 MCP manifest
node dist/index.js --manifest

# 查看工具列表
node dist/index.js --tools
```

为了兼容旧版 `minimax-bridge-mcp`，直接运行 `node dist/index.js` 仍会启动 MiniMax Bridge MCP stdio server。

## MCP 市场预留

`web/` 页面和 `src/harness/catalog.ts` 已经预留市场结构。当前内置：

- `minimax-bridge`：可安装、可配置、可写入 OpenCode
- `github-mcp`：预留
- `playwright-mcp`：预留
- `filesystem-mcp`：预留

后续可以为每个 catalog entry 增加：

- 下载 URL / GitHub Release / npm / uvx / Docker
- 签名或 checksum 校验
- 安装目录和版本锁定
- secrets schema
- permission schema
- health check：`initialize`、`tools/list`、smoke test
- Adapter 输出：OpenCode、Codex、Claude Code、Cursor、VS Code

## 开发

```bash
npm install
npm run build
npm run app
```

MCP server 开发：

```bash
npm run dev:mcp
```

Legacy localhost dashboard：

```bash
npm run serve
```

## 重要说明

- 桌面 App 使用 Electron IPC 调用本地逻辑，不以 localhost HTTP server 作为主架构。
- `web/` 是桌面 renderer 资源，不代表传统服务器后端结构。
- 修改 OpenCode 配置前会自动备份。
- 读取 JSONC 时支持注释和 trailing comma，但写回会格式化成标准 JSON。
- v0.1 的 secrets 存储是本地文件；后续建议升级到 Windows Credential Manager、macOS Keychain、Linux Secret Service。

## 许可证

本项目基于 Apache License 2.0 协议开源。
