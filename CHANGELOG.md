# Changelog

All notable changes to MCP Harness.

---

## [0.2.2] — 2026-06

### Added

- Auto-update check on app launch.
- Agnes MCP tools: image generation (`agnes_image_21_flash`), video generation (`agnes_video_v20`), video query (`agnes_query_video_v20`).
- Multi-MCP configure: configure both MiniMax Bridge and CC MCP from the same Harness UI.
- Profile state view: inspect current profile config in the UI.
- Image probe / artifact descriptors: generated image files carry metadata and display in a built-in gallery.
- Official MCP proxy routing improvements: more MiniMax tools proxied through the official `minimax-mcp-js` when available.
- Config defaults: pre-filled default values for API host, TTS mode, output directory.
- OpenCode install guide accessible from the desktop app.
- Web UI refresh: layout and interaction polish.

### Changed

- Tool parameter `image_url` → `image_source` for `understand_image` (align with MiniMax MCP).
- MCP timeout increased from 15s to 120s.
- Logo and icon refresh.
- Web search auto-triggers: agent instructions register proactive web search tool routing.

### Fixed

- Mac/Linux icon: use `logo.png` (≥512×512) for `.dmg` / `.AppImage`, `logo.ico` for Windows NSIS.
- CI: Windows build step shell fixed (OS-specific steps instead of shell override).
- CI: macOS x64 matrix dropped (macos-13 runner instability); arm64 only for now.

---

## [0.2.1] — 2026-05

### Changed

- Version bump, internal cleanup.

---

## [0.2.0] — 2026-05

### Added

- **Desktop installer build pipeline**: `electron-builder` producing NSIS installer + portable `.exe` (Windows), `.dmg` (macOS), `.AppImage` (Linux).
- **MCP shim for packaged mode**: MCP binaries callable from within the Electron ASAR bundle.
- **NSIS shortcuts**: Desktop + Start Menu shortcuts with `install --open` entry point.
- **Multi-platform CI**: GitHub Actions workflow for Win/Mac/Linux release artifacts.
- Electron main process environment detection for correct `NODE_PATH` and install dir resolution.

### Changed

- Build system migrated from SEA CLI to `electron-builder`.
- `npm run har`-family scripts aliased for desktop-first workflow.

---

## [0.1.1] — 2026-05

### Added

- Electron desktop app shell (`desktop/main.cjs` + `preload.cjs`).
- IPC-based Harness API bridge through `window.harnessApi` (`contextIsolation: true`, `nodeIntegration: false`).
- Shared `src/harness/api.ts` usable by both Electron IPC and legacy localhost server.

### Changed

- **Architecture shift**: MCP Harness is now a desktop app, not a localhost web dashboard.
- OpenCode configuration entry moved to `Harness 目标 → OpenCode → 进入配置 OpenCode`.
- Left sidebar reduced to: `总览`, `MCP 市场`, `Harness 目标`.
- `install --open` launches the desktop app instead of opening a browser.

---

## [0.1.0] — 2026-05

### Added

- Local Harness web UI (`web/`).
- Harness API server (`src/harness/server.ts`, legacy HTTP).
- OpenCode Adapter (`src/harness/opencode.ts`): writes `opencode.json` with auto-backup.
- Local state + secrets storage (`src/harness/state.ts`).
- Built-in catalog model (`src/harness/catalog.ts`) with reserved marketplace slots.
- Cross-platform paths and command generation (`src/harness/paths.ts`).
- CLI modes:
  - `node dist/index.js harness` — start desktop / harness
  - `node dist/index.js install` — init Harness data dir + register bundled MCPs
  - `node dist/index.js mcp minimax-bridge --profile default` — stdio MCP server for OpenCode
- Auto-merge into OpenCode config with backup file.
- Bundled MiniMax Bridge MCP: `web_search`, `understand_image`, `text_to_audio`, `voice_clone`, `text_to_image`, `generate_video`, `image_to_video`, `query_video_generation`, `lyrics_generation`, `music_generation`, `music_cover_preprocess`.
- CC MCP: `delegate_coding_task` / `delegate_to_claude_code` / `claude_code_status`.
- Reserved marketplace entries: `github-mcp`, `playwright-mcp`, `filesystem-mcp`.
- Reserved harness adapters: Codex, Claude Code, Cursor, VS Code.

### Changed

- Package rebranded from `minimax-bridge-mcp` to `mcp-harness`.
- OpenCode config only receives MCP command + `MCP_HARNESS_HOME`; API keys never written into agent config.
- `node dist/index.js` still runs MiniMax MCP for backward compatibility.

---

## [0.0.1] — 2026-04

### Added

- Initial `mcp-bridge-harness` project scaffold.
- MiniMax Bridge MCP: speech, image, video, music, voice clone, web search via MiniMax APIs.
- Token Plan and HTTP/WebSocket provider branches.
