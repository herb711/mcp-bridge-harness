# Security & Safety

MCP Harness 是本地桌面 MCP 管理器，安全与可控性是核心设计目标。本文档描述项目的安全模型、保护边界与审计能力。

---

## 1. 不自动执行未知命令

**MCP Harness 自身不自动执行代码。** 它仅响应 Agent（如 OpenCode）发起的 MCP 工具调用，每个工具都有明确的输入 schema 约束，在 `agent.manifest.json` 中声明。

### 调用链控制

```
用户 → Agent (OpenCode) → MCP 协议 → MCP Harness → 外部 API / 本地文件
```

- **CC MCP 子任务隔离**：当 Agent 将编码任务委托给 Claude Code 时，CC MCP 为每个会话创建独立的工作目录（`<appDataDir>/cc-mcp/sessions/<sessionId>/`），并传入 `--strict-mcp-config` 限制 Claude Code 只能访问临时回调 MCP 工具，防止越权。
- **命令白名单**：CC MCP 委托任务可配置 `allowed_commands` 和 `forbidden_actions`，确保子进程只能执行授权的指令集合。
- **无自触发机制**：MCP Harness 不会在终端中自动运行未知命令、不会监听外部网络触发执行、没有 cron/job 调度。

### 禁止的行为

- 不在用户未确认的情况下发起文件系统写操作（Agent 层的工具调用需经 Agent 调度，Harness 不跳过 Agent）
- CC MCP 使用 `sanitizeSessionId()` 过滤会话 ID 中非字母数字字符，防止路径注入
- 生成的文件名使用 `ISO 时间戳 + 4 字节随机 nonce`，防止覆盖用户已有文件

---

## 2. MCP Server 配置可审计

### 配置文件清单

| 文件 | 位置 | 内容 |
|---|---|---|
| `opencode.json` / `opencode.jsonc` | `~/.config/opencode/` | MCP 启动命令 + `MCP_HARNESS_HOME` 环境变量（**不含密钥**） |
| `state.json` | `<appDataDir>/` | 非敏感的 MCP 配置（API Host、路径、代理、工具开关） |
| `secrets.json` | `<appDataDir>/` | API Key 密存（独立文件，POSIX 上 `chmod 600`） |
| `harness.log` | `<appDataDir>/logs/` | 配置变更审计日志 |

### 审计能力

- `harness.log` 记录每次配置变更的时间戳和操作描述（如 "Updated profile minimax-bridge:default"）
- `opencode.json` 修改前自动创建备份 `opencode.json.bak-<timestamp>`，可回滚
- 可通过以下命令直接审查配置：
  ```bash
  # 查看 OpenCode 配置
  cat ~/.config/opencode/opencode.json

  # 查看 MCP Harness 状态（需自行读取）
  cat "$LOCALAPPDATA/McpHarness/state.json"   # Windows
  cat ~/.local/share/mcp-harness/state.json   # Linux
  cat ~/Library/Application\ Support/McpHarness/state.json  # macOS
  ```
- 所有被标记为 `secretKeys` 的字段在 UI 中始终显示为 `••••••••`（`maskEnv()`）
- 探针端点（probe）的响应自动过滤包含 `/api[_-]?key|authorization|secret|token/i` 模式的字段

### 配置分离原则

Agent 的 `opencode.json` **只包含启动命令和环境变量名**，不包含实际的 API Key。API Key 存储在 Harness 本地的 `secrets.json`，在 MCP 进程启动时通过 `process.env` 注入。即使 OpenCode 配置被导出或分享，Key 不会泄露。

---

## 3. API Key 本地保存策略

### 存储路径

| 平台 | 数据目录 |
|---|---|
| Windows | `%LOCALAPPDATA%\McpHarness` |
| macOS | `~/Library/Application Support/McpHarness` |
| Linux | `~/.local/share/mcp-harness` |

### 保护层级

1. **文件隔离**：`secrets.json` 与 `state.json` 分离，Key 只写入 `secrets.json`
2. **权限加固（POSIX）**：写入后调用 `fs.chmod(secretsPath, 0o600)` — 文件属主可读写，其他用户不可访问
3. **传输安全**：Key 从 UI 到 Harness 后端通过 Electron IPC 传递，不经过网络
4. **运行时注入**：MCP 进程通过 `applyProfileToProcessEnv()` 设置 `process.env`，Key 仅存在于当前进程的环境变量，不写入磁盘
5. **UI 掩码**：所有 Key 字段使用 `maskEnv()` 遮盖，返回值中的 Key 替换为 `••••••••`
6. **探针自检**：`probe.ts` 中 `redactSensitive()` 检测并遮蔽任何意外泄露的敏感字段

### 待升级的安全方案

当前 `secrets.json` 是明文存储。我们推荐但尚未实现的增强方案：

- Windows: credentials 迁移到 **Windows Credential Manager** (`wincred`)
- macOS: credentials 迁移到 **Keychain** (`security` CLI / `keytar`)
- Linux: credentials 迁移到 **Secret Service API** (`libsecret` / `keytar`)

本地的 `secrets.json` 方案适用于受信任的单用户桌面环境，这也是 MCP 本地执行的典型场景。

### 开发者注意事项

- `.gitignore` 已配置拒绝 `*.env*`、`*apikey*`、`*api_key*`、`*.pem`、`*.key` 文件进入版本控制
- 请勿将包含真实 Key 的测试文件提交到 Git。若误提交，立即轮换 Key 并执行 `git filter-branch` / `BFG Repo-Cleaner`

---

## 4. 工具调用日志

### 当前日志覆盖

| 日志 | 位置 | 记录内容 |
|---|---|---|
| Harness 操作日志 | `<appDataDir>/logs/harness.log` | 配置文件变更（保存、写入 OpenCode） |
| CC MCP 会话日志 | `<appDataDir>/cc-mcp/sessions/<sessionId>/` | 委托任务 JSON、回调 JSONL、临时 MCP 配置 |

### 日志格式

```
[2025-06-03T12:00:00.000Z] Updated profile minimax-bridge:default
[2025-06-03T12:00:01.000Z] Applied OpenCode config for minimax-bridge
```

### 当前不做的事

- **不在 stdout 输出日志**：stdout 专用于 MCP JSON-RPC 传输，任何非协议输出会破坏通信
- **不记录工具调用参数**：出于隐私考虑，当前不记录 `web_search` 的 `query` 或是 `understand_image` 的 `image_source` 等用户内容
- **不记录生成结果**：`output_directory` 写入的图片/音频/视频文件不产生额外日志条目

### 推荐的审计增强（未来版本）

- 在 `harness.log` 中增加结构化 MCP 工具调用摘要（工具名 + 时间 + 参数摘要，排除 Key 和敏感输入）
- 添加日志轮转（`harness.log.1`, `harness.log.2`...）防止日志无限增长
- 支持用户配置日志级别（`silent / normal / verbose`）

---

## 5. 危险命令提示

MCP Harness 的以下行为可能涉及风险，用户应了解：

### CC MCP 子任务隔离模式

CC MCP 封装了 Claude Code 的命令执行能力，默认启用 `--dangerously-skip-permissions`（见 `src/ccBridge.ts:CC_CLAUDE_SKIP_PERMISSIONS`）。这意味着委托给 CC MCP 的编码任务会**跳过 Claude Code 的交互式权限确认**。

**何时安全**：
- CC MCP 由 Agent（OpenCode）编排，Agent 已在调用前确认了用户意图
- 每个任务有明确的 `allowed_commands` 和 `forbidden_actions` 约束
- 会话隔离保证不同任务之间不会相互影响

**建议**：
- 对于有高安全要求的部署环境，可设置 `CC_CLAUDE_SKIP_PERMISSIONS: "false"` 恢复 Claude Code 交互确认
- 委托任务时始终提供明确的 `allowed_commands` 白名单

### `output_directory` 参数

所有生成类工具都接受 `output_directory` 参数。如果不指定，文件写入 `MINIMAX_MCP_BASE_PATH/<tool>/`；如果指定任意路径，文件将写入该路径。

**请注意**：
- 当前版本**不限制** `output_directory` 的写入范围，可写入任意本地路径
- 建议始终使用默认路径或显式限制到项目内的 `outputs/` 目录

### `understand_image` 本地文件访问

该工具在 `image_source` 参数为本地路径时，会读取 JPEG/PNG/WebP 文件内容并将其编码为 base64 data URL 发送至 MiniMax API（见 `src/tokenPlanProxy.ts:normalizeImageSource()`）。

**请注意**：
- 仅限 `.jpg`/`.jpeg`/`.png`/`.webp` 扩展名的文件
- 文件内容会被发送到 MiniMax 服务端
- 请勿将包含敏感信息的图片路径传入此工具

### Electron 安全边界

| 配置项 | 值 | 说明 |
|---|---|---|
| `contextIsolation` | `true` | 渲染进程无法直接访问 Node.js API |
| `nodeIntegration` | `false` | 渲染进程不加载 Node.js 模块 |
| `sandbox` | `false` | Electron 沙箱未启用（需 `preload.cjs` 桥接功能） |

原因：`preload.cjs` 需要 `contextBridge` 暴露 `harnessApi`，这在严格沙箱下不可用。应用本身是本地桌面工具，不加载远程内容。

### 遗留 HTTP 服务

`src/harness/server.ts` 中有一个遗留的本地 HTTP 服务器（默认 `http://127.0.0.1:45321`），使用随机生成的 `X-Harness-Token` 保护状态变更端点。当前架构主要通过 Electron IPC 而非这个 HTTP 服务工作。

---

## 6. 本地文件访问边界

### 生成输出（写入）

| 行为 | 边界 |
|---|---|
| 默认写入路径 | `<MINIMAX_MCP_BASE_PATH>/<tool>/` |
| 自定义写入路径 | 用户通过 `output_directory` 参数指定，无路径沙箱限制 |
| 文件名生成 | `ISO时间戳_随机Nonce.扩展名`，不会覆盖已有文件 |
| 支持的类型 | `.mp3` / `.wav` / `.flac` / `.png` / `.jpg` / `.mp4` / `.json` |

### 本地文件读取

| 行为 | 边界 |
|---|---|
| `understand_image` 读取 | 仅 `.jpg` / `.jpeg` / `.png` / `.webp` 扩展名；文件读取后编码为 data URL 发送至 MiniMax API |
| `voice_clone` 文件读取 | 读取音频文件（`.mp3` / `.m4a` / `.wav`，10s-5min，≤20MB）上传至 MiniMax 服务 |
| CC MCP 会话文件 | 写入 `<appDataDir>/cc-mcp/sessions/`，限当前会话作用域 |

### OpenCode 配置读写

| 行为 | 边界 |
|---|---|
| 读取配置 | `~/.config/opencode/opencode.json` 或 `opencode.jsonc` |
| 写入配置 | 同文件，写入前自动备份为 `opencode.json.bak-<timestamp>` |
| 指令文件 | 写入 `~/.config/opencode/*.md` 指令文件供 Agent 参考 |

### 不做的事

- 不读取 `.env` 文件（API Key 完全由 Harness 管理）
- 不访问用户的家目录以外的配置文件
- 不访问 `~/.ssh`、`~/.gnupg`、`~/.aws` 等凭据目录
- 不修改系统注册表或系统文件

### 文件访问声明

Harness 在 `agent.manifest.json` 的 `security.permissions` 中声明了以下权限：

```json
{
  "security": {
    "permissions": [
      "network:minimax",       // 网络访问 MiniMax API
      "file:write:artifacts",  // 写入生成的图片/音频/视频文件
      "secret:read:harness-profile"  // 读取本地保存的 API Key
    ]
  }
}
```

### 路径处理安全

- 所有路径使用 `path.resolve()` 规范化，防止 `../` 穿越
- CC MCP 会话 ID 经过 `sanitizeSessionId()` 移除特殊字符
- WSL 环境自动转换路径格式（Windows ↔ Linux 路径）

---

## 安全模型总结

```
┌──────────────────────────────────────────────────────┐
│  用户桌面                                              │
│  ┌─────────────┐    Electron IPC    ┌──────────────┐ │
│  │ Harness UI  │ ◄───────────────► │ Harness Core  │ │
│  │ (renderer)  │   contextIsolation │ (main/node)   │ │
│  └─────────────┘                    └──────┬───────┘ │
│                                           │          │
│                      ┌────────────────────┼───────┐  │
│                      │  secrets.json      │       │  │
│                      │  state.json    chmod 600    │  │
│                      │  harness.log          │     │  │
│                      └────────────────────────┘     │
│                                                     │
│  ┌──────────────┐         stdio MCP                 │
│  │ Agent        │ ◄─────────────────────────────►  │
│  │ (OpenCode)   │   只传命令 + MCP_HARNESS_HOME     │
│  └──────────────┘                                   │
│                                                     │
│  ┌──────────────────────┐                           │
│  │ ~/.config/opencode/  │                           │
│  │ opencode.json        │  ← 无 API Key             │
│  │ opencode.json.bak-*  │                           │
│  │ mcp-harness-*.md     │                           │
│  └──────────────────────┘                           │
└──────────────────────────────────────────────────────┘
```

MCP Harness 的设计哲学：**密钥与配置分离、本地优先、最小权限、行为可审计。**

---

*最后更新: 2025-06-03*
*版本: v0.2.2*
