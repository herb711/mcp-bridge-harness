# MCP Harness Architecture

## 目标

MCP Harness 要解决的问题不是“再做一个 MCP 列表”，而是做本地 MCP 管理器：

```text
发现 MCP → 安装 MCP → 配置密钥 → 选择 Harness → 写入对应配置 → 健康检查 → 启停/卸载
```

第一版只实现 OpenCode Adapter，保留 Codex、Claude Code、Cursor、VS Code 的扩展点。

## v0.1.1 架构调整

这一版把原来的 localhost Web Dashboard 移植为桌面 App 架构：

```text
Electron Desktop App
  ├─ BrowserWindow 加载 web/index.html
  ├─ preload.cjs 暴露 window.harnessApi
  ├─ ipcMain.handle('harness:api')
  └─ dist/harness/api.js 直接调用本地 Harness 逻辑
        ├─ catalog
        ├─ state / secrets
        ├─ OpenCode Adapter
        └─ MCP probe
```

关键点：

- 用户入口是桌面 App，不需要理解端口、localhost 或本地 HTTP server。
- UI 通过 Electron IPC 调用本地 Harness API。
- `src/harness/server.ts` 仍保留为 legacy / development fallback，不再是主架构。
- `web/` 继续作为桌面 App 的 renderer 资源，不代表传统前后端拆分。

## 模块

```text
desktop/main.cjs         # Electron 主进程，创建桌面窗口和 IPC handler
desktop/preload.cjs      # Electron preload，只暴露最小 window.harnessApi
web/                     # 桌面 renderer 静态资源，可被 file:// 加载
src/harness/api.ts       # Harness API 核心逻辑，供 Electron IPC 和 legacy server 复用
src/harness/catalog.ts   # 市场元数据
src/harness/state.ts     # 本地安装状态和 profile secrets
src/harness/opencode.ts  # OpenCode 配置 Adapter
src/harness/server.ts    # legacy localhost server，仅开发/兼容用途
src/harness/paths.ts     # 跨平台路径和启动命令
```

## UI 路由约定

左侧栏只保留一级入口：

```text
总览
MCP 市场
Harness 目标
```

`配置 OpenCode` 不再作为左侧一级入口，而是在：

```text
Harness 目标 → OpenCode → 进入配置 OpenCode
```

这样后续加入 Codex、Claude Code、Cursor、VS Code 时，每个目标都可以拥有自己的配置页。

## OpenCode Adapter

输出格式：

```json
{
  "mcp": {
    "minimax-bridge": {
      "type": "local",
      "command": ["node", "<dist/index.js>", "mcp", "minimax-bridge", "--profile", "default"],
      "enabled": true,
      "environment": {
        "MCP_HARNESS_HOME": "<local data dir>"
      }
    }
  }
}
```

OpenCode 只拿到启动命令和 `MCP_HARNESS_HOME`。MiniMax API Key 不写入 OpenCode 配置。

## Secrets 策略

v0.1：

- `opencode.json` 不保存 MiniMax API Key。
- API Key 保存到 `MCP_HARNESS_HOME/secrets.json`。
- POSIX 系统尝试 `chmod 600`。

v0.2 建议：

- Windows Credential Manager
- macOS Keychain
- Linux Secret Service
- UI 中增加“迁移 secrets 到系统钥匙串”按钮

## 市场扩展点

Catalog entry 后续应加入：

```ts
interface CatalogEntry {
  id: string;
  installMode: "bundled" | "npx" | "uvx" | "binary" | "remote";
  artifacts?: {
    platform: string;
    url: string;
    sha256: string;
  }[];
  fields: CatalogField[];
  permissions: string[];
  healthcheck?: HealthcheckSpec;
}
```

## Adapter 扩展点

每个 Harness Adapter 至少实现：

```ts
interface HarnessAdapter {
  id: string;
  detect(): Promise<DetectResult>;
  preview(mcp: InstalledMcp): Promise<unknown>;
  apply(mcp: InstalledMcp): Promise<ApplyResult>;
  remove(mcpId: string): Promise<ApplyResult>;
}
```
