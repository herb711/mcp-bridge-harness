# OpenCode 自动配置说明

MCP Harness v0.1 已实现 OpenCode Adapter。目标是：用户在 MCP Harness 桌面 App 里点一次按钮后，OpenCode 不需要再手动执行 `opencode mcp add`，重启即可使用 MCP。

## 配置入口

```bash
npm install
npm run build
npm run app
```

打开桌面 App 后进入：

```text
Harness 目标 → OpenCode → 进入配置 OpenCode → 保存并配置到 OpenCode
```

## 写入位置

默认写入 OpenCode 全局配置：

```text
~/.config/opencode/opencode.json
```

如果设置了 `OPENCODE_CONFIG`，则写入该自定义路径。

## 写入内容

MCP Harness 会合并 `mcp.minimax-bridge`：

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
        "MCP_HARNESS_HOME": "/absolute/path/to/McpHarness"
      }
    }
  }
}
```

说明：

- 不覆盖用户已有的其他 OpenCode 配置。
- 不删除用户已有的其他 MCP。
- 写入前会备份 `opencode.json`。
- MiniMax API Key 不写入 `opencode.json`，而是保存在本地 Harness `secrets.json`。

## 重启 OpenCode

配置写入成功后，重新打开 OpenCode，然后在对话中可以要求它使用：

```text
use the minimax-bridge MCP
```

或直接让它列出 MCP 工具。

## 排错

1. 确认 `node dist/index.js --tools` 能输出工具列表。
2. 确认 OpenCode 配置里有 `mcp.minimax-bridge`。
3. 确认 `MCP_HARNESS_HOME` 指向的目录存在 `state.json` 和 `secrets.json`。
4. 修改配置后需要重启 OpenCode。
