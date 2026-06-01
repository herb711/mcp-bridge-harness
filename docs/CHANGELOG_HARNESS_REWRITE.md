# Harness Rewrite Changelog

## 0.1.1

### Added

- Added Electron desktop app shell under `desktop/`.
- Added IPC-based Harness API bridge through `window.harnessApi`.
- Added shared `src/harness/api.ts`, so desktop IPC and legacy localhost server reuse the same business logic.
- Added desktop run commands:
  - `npm run app`
  - `npm run desktop`
  - `npm run harness`
  - `node dist/index.js app`
- Kept legacy web server as development fallback:
  - `npm run serve`
  - `node dist/index.js serve`

### Changed

- MCP Harness is now oriented around a desktop app, not a visible localhost dashboard.
- Moved `配置 OpenCode` out of the left sidebar.
- OpenCode configuration now lives under `Harness 目标 → OpenCode → 进入配置 OpenCode`.
- Left sidebar only contains top-level areas: `总览`、`MCP 市场`、`Harness 目标`.
- `install --open` now launches the desktop app instead of opening localhost in a browser.

### Notes

- Electron must be installed before running the desktop app from source: `npm install`.
- In this source package, Electron packaging into a final Windows installer is still a release pipeline task.

## 0.1.0

### Added

- Added local Web UI under `web/`.
- Added Harness API server under `src/harness/server.ts`.
- Added OpenCode Adapter under `src/harness/opencode.ts`.
- Added local state/secrets storage under `src/harness/state.ts`.
- Added built-in catalog/marketplace model under `src/harness/catalog.ts`.
- Added cross-platform Harness paths and command generation under `src/harness/paths.ts`.
- Added CLI modes:
  - `node dist/index.js harness`
  - `node dist/index.js install`
  - `node dist/index.js mcp minimax-bridge --profile default`
- Added OpenCode auto-merge with backup.
- Added reserved market entries for GitHub MCP, Playwright MCP, Filesystem MCP.
- Added reserved Harness targets for Codex, Claude Code, Cursor, VS Code.

### Changed

- Rebranded package from `minimax-bridge-mcp` to `mcp-harness` while keeping the original MiniMax Bridge MCP as the bundled default MCP.
- OpenCode config no longer needs MiniMax API Key inline; it receives only the MCP command and `MCP_HARNESS_HOME`.
- `node dist/index.js` still runs the MiniMax MCP server for backward compatibility.

### Notes

- Secrets are stored locally in `secrets.json` in v0.1. POSIX systems attempt `chmod 600`.
- A future version should migrate secrets to system keychains.
