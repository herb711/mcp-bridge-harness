# MCP Harness

> Open-source local tool for managing MCP servers and connecting them to coding agents.

[English](README.md) · [中文](README.zh.md)

**mcp-bridge-harness** is an open-source local tool for managing MCP servers and connecting them to coding agents such as OpenCode, Codex-compatible workflows, Claude Code workflows, and other developer harnesses.

It is delivered as a cross-platform desktop application (Electron) that gives developers one local place to install, configure, version-pin, and distribute Model Context Protocol (MCP) servers into the AI coding agent of their choice — without hand-editing per-agent JSON config files or writing API keys into them.

## What it does

- **Local-first desktop app** — Electron shell; MCP binaries, secrets, and state live in a per-user data directory. No cloud account, no telemetry, no per-seat license.
- **Agent-agnostic distribution** — install an MCP server once and hand it off to OpenCode, Codex-compatible workflows, Claude Code workflows, Cursor, VS Code, and other developer harnesses through pluggable adapters.
- **Secret-safe configuration** — API keys stay in a local `secrets.json`; the agent config only receives `MCP_HARNESS_HOME` and a stdio command, never the key itself.
- **Cross-platform installers** — NSIS installer + portable `.exe` on Windows, `.dmg` on macOS, `.AppImage` on Linux, all built with `electron-builder`.
- **Catalog-ready** — built-in slots for download URL, checksum / signature, health check, version pinning, and per-agent adapter output.

## Current scope (v0.2)

- **Shipped** — desktop app shell (Electron + IPC); local Harness state / secrets / logs; OpenCode adapter that writes `opencode.json` with auto-backup; bundled `minimax-bridge` MCP (search, image, video, speech, music, voice clone).
- **Reserved** — Codex, Claude Code, Cursor, VS Code adapters; MCP marketplace UI (download, sign, health check, multi-agent sync).

## Architecture

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

`src/harness/server.ts` is still kept, but only as a legacy / development fallback:

```bash
npm run serve
```

The main entry point is the desktop App — users are not required to manually open a browser to `127.0.0.1`.

## Quick start

### Windows (end user)

Download the installer from the release page:

```text
mcp-harness-0.2.0-x64-setup.exe    # NSIS installer (recommended; creates desktop + Start Menu shortcuts)
mcp-harness-0.2.0-x64-portable.exe # Portable single-file build, double-click to run
```

After downloading, double-click `mcp-harness-0.2.0-x64-setup.exe`:

1. Pick an install directory (default `C:\Program Files\MCP Harness`).
2. Tick "Create desktop shortcut" and "Create Start Menu shortcut".
3. Finish the install. The **MCP Harness** icon appears on your desktop.
4. Double-click the icon to launch the local MCP manager.

### Video tutorials

- **Install tutorial**: [MCP Harness install tutorial (YouTube)](https://youtu.be/TSdHCuhQUGA)
- **Advanced usage tutorial**: [MCP Harness advanced usage tutorial (YouTube)](https://youtu.be/G-Q3wbpxyR8)

### Windows (development)

Double-click:

```bat
install.bat
```

Or from the command line:

```bat
npm install
npm run build
npm run app
```

### macOS / Linux (end user)

Download `mcp-harness-0.2.0-*.dmg` or `mcp-harness-0.2.0-*.AppImage`. Drag the `.dmg` to `Applications`, or `chmod +x` the `.AppImage` and double-click to run.

### macOS / Linux (development)

```bash
chmod +x install.sh
./install.sh
```

Or:

```bash
npm install
npm run build
npm run app
```

## Building desktop installers

```bash
# Windows only (NSIS installer + portable build)
npm run dist:win

# Cross-platform
npm run dist:mac
npm run dist:linux
npm run release:desktop   # current platform + regenerates agent.manifest.json
```

All build artifacts go to `release/desktop/`:

```text
mcp-harness-0.2.0-x64-setup.exe       # NSIS installer
mcp-harness-0.2.0-x64-portable.exe    # Portable single-file
mcp-harness-0.2.0-arm64-dmg.dmg       # macOS
mcp-harness-0.2.0-x64-appimage.AppImage  # Linux
win-unpacked/                         # Unpacked runtime dir (for debugging)
```

The build is based on `electron-builder` + NSIS:

- `appId`: `com.mcpharness.desktop`
- Installer auto-creates the desktop icon and a "Start Menu → MCP Harness" shortcut.
- `oneClick=false` by default; the user can pick the install directory.
- `perMachine=false` — installed per user, no admin required.
- Uninstall keeps the local data under `appDataDir`.

> Note: when building on a host whose working directory is on a sync drive (Synology Drive, OneDrive, etc.), `rcedit` may be blocked from writing the icon (`Unable to commit changes`). This is a non-fatal warning — the installer is still produced and runs correctly, but won't embed the custom icon. The workaround is to `Copy-Item` the source tree to a local path (e.g. `%TEMP%`) and run `npm install && npm run dist:win` from there.

## Install scripts

`install.bat` / `install.sh` are for development only — they run Electron straight from source. End users should download the release installer.

They will:

1. Install dependencies, including the Electron desktop runtime.
2. Build the TypeScript project.
3. Initialize the local data directory.
4. Auto-install the bundled `minimax-bridge` MCP into the Harness state.
5. Open the MCP Harness desktop App.

## Usage

Start the desktop manager:

```bash
npm run app
```

Or:

```bash
npm run harness
```

Once the desktop app is open, go to:

```text
Harness target → OpenCode → Configure OpenCode
```

Then:

1. Fill in the MiniMax API Key.
2. Confirm the API host, output directory, and TTS mode.
3. The official MiniMax MCP Proxy is enabled by default; generation tools already supported by the official `minimax-mcp-js` will be proxied there first.
4. Optionally enable the Token Plan MCP Proxy.
5. Click **Save and configure into OpenCode**.
6. Reopen OpenCode, and the `minimax-bridge` MCP is available immediately.

MCP Harness writes to:

```text
~/.config/opencode/opencode.json
```

On Windows, the same path resolves to:

```text
%USERPROFILE%\.config\opencode\opencode.json
```

Before writing, the original config is backed up automatically, e.g.:

```text
opencode.json.bak-2026-05-31T15-00-00-000Z
```

## OpenCode write example

MCP Harness merges the OpenCode config into something like:

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

The API key is **not** written into `opencode.json`. It is stored in `secrets.json` inside the local Harness data directory. When OpenCode starts the MCP, it only receives `MCP_HARNESS_HOME`; the bundled MCP reads the local profile from there.

## Local data directory

Default paths:

| OS | Path |
|---|---|
| Windows | `%LOCALAPPDATA%\McpHarness` |
| macOS | `~/Library/Application Support/McpHarness` |
| Linux | `~/.local/share/mcp-harness` |

Override with the env var:

```bash
MCP_HARNESS_HOME=/custom/path npm run app
```

Files stored in the directory:

```text
state.json       # installed MCPs, harness binding state
secrets.json     # local profile secrets; POSIX systems attempt chmod 600
catalog.json     # bundled catalog snapshot
outputs/minimax  # default output dir for generated files
logs/harness.log # install / config logs
```

## Commands

```bash
# Start the desktop app
node dist/index.js app

# Initialize Harness local state
node dist/index.js install

# Initialize and open the desktop app
node dist/index.js install --open

# Legacy localhost web dashboard (dev / compatibility only)
node dist/index.js serve

# The actual stdio command OpenCode runs to start the MCP
node dist/index.js mcp minimax-bridge --profile default

# Print the MCP manifest
node dist/index.js --manifest

# List tools
node dist/index.js --tools
```

For backwards compatibility with the old `minimax-bridge-mcp`, running `node dist/index.js` directly still starts the MiniMax Bridge MCP stdio server.

## MCP marketplace (reserved)

The `web/` pages and `src/harness/catalog.ts` already reserve the marketplace structure. Currently bundled:

- `minimax-bridge` — installable, configurable, written into OpenCode
- `github-mcp` — reserved
- `playwright-mcp` — reserved
- `filesystem-mcp` — reserved

Each catalog entry can later grow:

- Download URL / GitHub Release / npm / uvx / Docker
- Signature or checksum verification
- Install directory and version pinning
- Secrets schema
- Permission schema
- Health check: `initialize`, `tools/list`, smoke test
- Adapter outputs: OpenCode, Codex, Claude Code, Cursor, VS Code

## Development

```bash
npm install
npm run build
npm run app
```

MCP server development:

```bash
npm run dev:mcp
```

Legacy localhost dashboard:

```bash
npm run serve
```

## Notes

- The desktop app uses Electron IPC to call local logic; it is **not** architected around a localhost HTTP server.
- `web/` holds the desktop renderer assets, not a traditional server backend.
- OpenCode config is auto-backed up before each write.
- JSONC reading supports comments and trailing commas; writes are reformatted as standard JSON.
- v0.1 stores secrets in a local file; future versions are expected to upgrade to Windows Credential Manager, macOS Keychain, and Linux Secret Service.
