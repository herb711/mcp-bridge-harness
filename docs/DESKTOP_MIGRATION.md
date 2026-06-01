# Desktop Migration Notes

本次迁移完成两件事：

1. 将 MCP Harness 主架构从 localhost Web Dashboard 改为 Electron 桌面 App。
2. 将 `配置 OpenCode` 从左侧一级导航移动到 `Harness 目标 → OpenCode` 下面。

## 新入口

```bash
npm install
npm run build
npm run app
```

兼容入口：

```bash
npm run harness
node dist/index.js app
```

开发/兼容用 localhost server：

```bash
npm run serve
node dist/index.js serve
```

## 桌面架构

```text
desktop/main.cjs
  └─ 创建 Electron BrowserWindow
  └─ ipcMain.handle('harness:api')
       └─ import dist/harness/api.js

web/app.js
  └─ 优先使用 window.harnessApi.invoke(...)
  └─ 没有 Electron bridge 时 fallback 到 fetch，用于 legacy server
```

## UI 导航

左侧栏现在只保留：

```text
总览
MCP 市场
Harness 目标
```

OpenCode 配置入口为：

```text
Harness 目标 → OpenCode → 进入配置 OpenCode
```

## 验证

已验证：

```bash
npm run build
node dist/index.js --tools
node dist/index.js --manifest
node --check desktop/main.cjs
node --check desktop/preload.cjs
node --check web/app.js
```

桌面窗口需要 Electron 运行时。当前执行环境没有 Electron 二进制，因此没有在容器中实际打开桌面窗口。
