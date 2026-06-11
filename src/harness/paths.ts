import os from "node:os";
import path from "node:path";
import { isSea } from "node:sea";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { packagedMcpCommand } from "./shim.js";

export function appDataDir(): string {
  if (process.env.MCP_HARNESS_HOME?.trim()) return path.resolve(process.env.MCP_HARNESS_HOME.trim());

  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "McpHarness");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "McpHarness");
  }

  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "mcp-harness");
}

export function statePath(): string {
  return path.join(appDataDir(), "state.json");
}

export function secretsPath(): string {
  return path.join(appDataDir(), "secrets.json");
}

export function catalogSnapshotPath(): string {
  return path.join(appDataDir(), "catalog.json");
}

export function logPath(): string {
  return path.join(appDataDir(), "logs", "harness.log");
}

export function defaultOutputPath(provider = "minimax"): string {
  return path.join(appDataDir(), "outputs", provider);
}

export function defaultClaudeCodeWorkdir(): string {
  const explicit = process.env.MCP_HARNESS_PROJECT_DIR?.trim() || process.env.MCP_HARNESS_WORKDIR?.trim();
  if (explicit) return path.resolve(explicit);

  const initCwd = process.env.INIT_CWD?.trim();
  if (initCwd && existsSync(initCwd)) return path.resolve(initCwd);

  if (!isSea()) {
    const sourceRoot = fileURLToPath(new URL("../..", import.meta.url));
    if (!sourceRoot.includes(".asar")) return path.resolve(sourceRoot);
  }

  return process.cwd();
}

export function defaultOpenCodeConfigPath(): string {
  if (process.env.OPENCODE_CONFIG?.trim()) return path.resolve(process.env.OPENCODE_CONFIG.trim());
  const configDir = path.join(os.homedir(), ".config", "opencode");
  const jsonc = path.join(configDir, "opencode.jsonc");
  if (existsSync(jsonc)) return jsonc;
  return path.join(configDir, "opencode.json");
}

export function defaultCodexHomePath(): string {
  if (process.env.CODEX_HOME?.trim()) return path.resolve(process.env.CODEX_HOME.trim());
  if (process.env.CODEX_CONFIG?.trim()) return path.dirname(path.resolve(process.env.CODEX_CONFIG.trim()));
  return path.join(os.homedir(), ".codex");
}

export function defaultCodexConfigPath(): string {
  if (process.env.CODEX_CONFIG?.trim()) return path.resolve(process.env.CODEX_CONFIG.trim());
  return path.join(defaultCodexHomePath(), "config.toml");
}

function commandLookup(command: string): string | null {
  const result = process.platform === "win32"
    ? spawnSync("where.exe", [command], { encoding: "utf8", windowsHide: true })
    : spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });

  if (result.status !== 0 || !result.stdout) return null;
  const matches = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const first = process.platform === "win32"
    ? matches.find((line) => path.extname(line).toLowerCase() === ".exe") || matches[0]
    : matches[0];
  return first ? path.resolve(first) : null;
}

function executableCandidates(command: string): string[] {
  if (process.platform !== "win32") return [command];
  const ext = path.extname(command);
  if (ext) return [command];
  const pathExt = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD";
  return [command, ...pathExt.split(";").filter(Boolean).map((item) => `${command}${item.toLowerCase()}`)];
}

function findExecutableOnPath(command: string): string | null {
  const pathEnv = process.env.PATH || "";
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const candidate of executableCandidates(command)) {
      const fullPath = path.resolve(dir, candidate);
      if (existsSync(fullPath)) return fullPath;
    }
  }
  return null;
}

export function detectCodexExecutablePath(): string | null {
  const explicit = process.env.CODEX_EXECUTABLE?.trim()
    || process.env.CODEX_BIN?.trim()
    || process.env.CODEX_CLI?.trim();
  if (explicit) return path.resolve(explicit);

  return commandLookup("codex") || findExecutableOnPath("codex");
}

export function defaultClaudeCodeConfigPath(): string {
  if (process.env.CLAUDE_CODE_CONFIG?.trim()) return path.resolve(process.env.CLAUDE_CODE_CONFIG.trim());
  if (process.env.CLAUDE_CONFIG?.trim()) return path.resolve(process.env.CLAUDE_CONFIG.trim());
  return path.join(os.homedir(), ".claude.json");
}

export function defaultHermesConfigPath(): string {
  if (process.env.HERMES_CONFIG?.trim()) return path.resolve(process.env.HERMES_CONFIG.trim());
  if (process.env.HERMES_CONFIG_PATH?.trim()) return path.resolve(process.env.HERMES_CONFIG_PATH.trim());
  return path.join(os.homedir(), ".hermes", "config.yaml");
}

export function harnessEntryPath(): string {
  if (isSea()) return process.execPath;
  return fileURLToPath(new URL("../index.js", import.meta.url));
}

export function webRootPath(): string {
  if (process.env.MCP_HARNESS_WEB_DIR?.trim()) return path.resolve(process.env.MCP_HARNESS_WEB_DIR.trim());
  if (isSea()) return path.join(path.dirname(process.execPath), "web");
  return fileURLToPath(new URL("../../web", import.meta.url));
}

export function commandForBundledMcp(mcpId: string, profileId = "default"): string[] {
  if (process.env.MCP_HARNESS_PACKAGED === "1") {
    return packagedMcpCommand(mcpId, profileId);
  }
  if (isSea()) return [process.execPath, "mcp", mcpId, "--profile", profileId];
  return ["node", harnessEntryPath(), "mcp", mcpId, "--profile", profileId];
}

export function commandDisplay(command: string[]): string {
  return command.map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ");
}
