import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSea } from "node:sea";
import { existsSync } from "node:fs";

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

export function defaultOutputPath(): string {
  return path.join(appDataDir(), "outputs", "minimax");
}

export function defaultOpenCodeConfigPath(): string {
  if (process.env.OPENCODE_CONFIG?.trim()) return path.resolve(process.env.OPENCODE_CONFIG.trim());
  const configDir = path.join(os.homedir(), ".config", "opencode");
  const jsonc = path.join(configDir, "opencode.jsonc");
  if (existsSync(jsonc)) return jsonc;
  return path.join(configDir, "opencode.json");
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
  if (isSea()) return [process.execPath, "mcp", mcpId, "--profile", profileId];
  return ["node", harnessEntryPath(), "mcp", mcpId, "--profile", profileId];
}

export function commandDisplay(command: string[]): string {
  return command.map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ");
}
