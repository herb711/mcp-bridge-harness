# MCP Harness

MCP Harness 是一个本地 MCP 管家桌面程序：它在本机提供可视化界面，用来安装、配置、启用和分发 MCP 到不同的编程 Agent / Harness。

当前版本已经完成：

- 桌面 App 入口：`npm run app` / `npm run harness`
- Electron IPC 调用本地 Harness 逻辑，不再把 localhost Web Dashboard 作为主架构
- 安装时自动注册内置 `MiniMax Bridge MCP`
- 可视化配置 MiniMax API Key、输出目录、Token Plan Proxy 等参数
- OpenCode 自动配置入口移动到：`Harness 目标 → OpenCode → 进入配置 OpenCode`
- 一键写入 OpenCode 全局配置
- OpenCode 重启后可直接使用 `minimax-bridge` MCP
- 预留 MCP 市场页面：后续可扩展下载、签名校验、健康检查、多 Harness 同步
- 预留 Harness Adapter：Codex、Claude Code、Cursor、VS Code

> 第一版重点先打通 OpenCode。OpenCode 配置文件只写入 MCP 启动命令和 `MCP_HARNESS_HOME`，不会写入 MiniMax API Key。

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

### Windows

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

### macOS / Linux

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

安装脚本会：

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
3. 按需启用 Token Plan MCP Proxy。
4. 点击 **保存并配置到 OpenCode**。
5. 重新打开 OpenCode，即可直接使用 `minimax-bridge` MCP。

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
      "timeout": 15000,
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
