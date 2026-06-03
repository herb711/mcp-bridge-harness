# Roadmap

MCP Harness 的规划方向：从本地 MCP 管家演进为 Agent-通用的 MCP 分发与安全管理平台。

---

## 当前版本 (v0.2.2)

- [x] Electron 桌面 App（Win/Mac/Linux 安装包）
- [x] 内置 MiniMax Bridge MCP（多模态生成 + 搜索）
- [x] 内置 CC MCP（Claude Code 编码任务委托）
- [x] 内置 Agnes MCP（图片/视频生成）
- [x] OpenCode Adapter（自动写入 `opencode.json`）
- [x] 密钥与配置分离（`secrets.json` + `chmod 600`）
- [x] Agent 配置自动备份
- [x] 配置变更日志（`harness.log`）
- [x] 安全文档（`SECURITY.md`）

---

## v0.3（近期规划）

### Secrets 安全升级

- [ ] **Windows Credential Manager 集成**：`secrets.json` 中的 API Key 迁移至系统 Credential Manager
- [ ] **macOS Keychain 集成**：通过 `security` CLI 或 `keytar` 存储 Key
- [ ] **Linux Secret Service 集成**：通过 `libsecret` 存储 Key
- [ ] UI 中“迁移 secrets 到系统钥匙串”一键操作按钮

### 新的 Harness Adapter

- [ ] **Codex Adapter**：检测 Codex 安装，预览/应用/移除 MCP 配置
- [ ] **Claude Code Adapter**：写入 Claude Code 的 MCP 配置文件
- [ ] **Cursor Adapter**：写入 Cursor 的 `.cursor/mcp.json`
- [ ] **VS Code Adapter**：写入 VS Code Copilot Chat MCP 设置

每个 Adapter 实现统一的接口：

```ts
interface HarnessAdapter {
  id: string;
  detect(): Promise<DetectResult>;
  preview(mcp: InstalledMcp): Promise<unknown>;
  apply(mcp: InstalledMcp): Promise<ApplyResult>;
  remove(mcpId: string): Promise<ApplyResult>;
}
```

### 审计与日志增强

- [ ] 结构化工具调用摘要日志（工具名 + 时间，不含 Key/敏感参数）
- [ ] 日志轮转（`harness.log.1`、`harness.log.2`…）
- [ ] 日志级别配置（`silent` / `normal` / `verbose`）

### CC MCP 安全增强

- [ ] 配置化 `CC_CLAUDE_SKIP_PERMISSIONS`（支持用户开关）
- [ ] 委托任务历史记录与重放
- [ ] 执行超时与资源上限控制

---

## v0.4（中期规划）

### MCP 市场

- [ ] 安装 `github-mcp`（GitHub API MCP server）
- [ ] 安装 `playwright-mcp`（Headless 浏览器自动化 MCP）
- [ ] 安装 `filesystem-mcp`（安全本地文件系统 MCP）
- [ ] Catalog 元数据增强：
  - 下载 URL / GitHub Release / npm / uvx / Docker 安装方式
  - SHA256 checksum 或 GPG 签名校验
  - Health check：`initialize` → `tools/list` → smoke test
  - 版本锁定与回滚
  - 多 Agent 同步（一键推送到所有已配置的 Agent）

### 文件访问沙箱

- [ ] `output_directory` 路径限制（默认限 `MCP_HARNESS_HOME/outputs/` 子树）
- [ ] 可配置的 `allowedPaths` 白名单
- [ ] `understand_image` 本地路径访问日志提示

### Agent 指令管理

- [ ] 可视化编辑 Agent 指令文件（`.md` instructions）
- [ ] 指令模板库：常见工具路由、安全策略、自动触发规则
- [ ] 多 Agent 共享指令模板

---

## v1.0（远期规划）

### 全平台稳定

- [ ] Windows ARM64 支持
- [ ] macOS x64 CI 恢复（macos-13 runner 问题解决后）
- [ ] Linux ARM64 AppImage
- [ ] Electron 沙箱启用（`sandbox: true`）同时保持 `preload` 功能性

### MCP 社区生态

- [ ] 社区 MCP 注册表 / 索引
- [ ] 一键安装任意 npm/uvx/pipx 发布的 MCP server
- [ ] 版本管理：升级/降级任意 MCP 到指定版本
- [ ] 配置导入/导出（团队共享 MCP 配置模板）

### 安全与合规

- [ ] 完整的工具调用审计日志（本地 SQLite/Better SQLite3）
- [ ] API Key 使用量统计面板
- [ ] 按 Agent、MCP、工具维度的权限矩阵
- [ ] `electron-builder` 代码签名（Windows Authenticode、macOS notarization）
- [ ] 自动更新管道（`electron-updater` + release feed）

### 开发者体验

- [ ] 内置 MCP 调试工具：协议嗅探、工具调用时间线、错误回放
- [ ] MCP 性能指标：延迟分布、吞吐量
- [ ] 自定义 MCP 开发模板（TypeScript/Python 快速启动）

---

## 设计原则

1. **本地优先**：数据不出设备，无云账户，无遥测。
2. **密钥与配置分离**：Agent 永远不拿到 API Key。
3. **最小权限**：每个 MCP 声明自己的权限边界，Agent 按声明调度。
4. **可审计**：配置变更、工具调用均有日志可查。
5. **Agent 通用**：不绑定单一 Agent，一次配置多端分发。

---

*最后更新: 2025-06-03*
