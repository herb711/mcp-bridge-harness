import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { appDataDir } from "./paths.js";

export interface PackagedRuntime {
  installDir: string;
  resourcesDir: string;
  asarEntry: string;
  executable: string;
}

export function isElectronPackaged(): boolean {
  return process.env.MCP_HARNESS_PACKAGED === "1";
}

export function packagedRuntime(): PackagedRuntime | null {
  if (!isElectronPackaged()) return null;
  const installDir = process.env.MCP_HARNESS_INSTALL_DIR;
  const resourcesDir = process.env.MCP_HARNESS_RESOURCES_DIR;
  if (!installDir || !resourcesDir) return null;
  const asarEntry = path.join(resourcesDir, "app.asar", "dist", "index.js");
  const executable = process.env.MCP_HARNESS_EXECUTABLE || path.join(installDir, executableName());
  return { installDir, resourcesDir, asarEntry, executable };
}

function executableName(): string {
  return process.platform === "win32" ? "MCP Harness.exe" : "MCP Harness";
}

function shimFileName(): string {
  return process.platform === "win32" ? "mcp-harness-mcp.cmd" : "mcp-harness-mcp";
}

export function mcpShimDir(): string {
  return path.join(appDataDir(), "bin");
}

export function mcpShimPath(): string {
  return path.join(mcpShimDir(), shimFileName());
}

function windowsShimBody(executable: string, asarEntry: string): string {
  const exe = executable.replace(/"/g, '""');
  const entry = asarEntry.replace(/"/g, '""');
  return [
    "@echo off",
    "setlocal",
    "set \"ELECTRON_RUN_AS_NODE=1\"",
    `set \"MCP_HARNESS_PACKAGED=1\"`,
    `set \"MCP_HARNESS_INSTALL_DIR=${installDirForShim()}"`.replace(/"/g, ""),
    `"${exe}" "${entry}" %*`,
    "endlocal",
    "",
  ].join("\r\n");
}

function posixShimBody(executable: string, asarEntry: string): string {
  const exe = executable.replace(/"/g, '\\"');
  const entry = asarEntry.replace(/"/g, '\\"');
  return [
    "#!/bin/sh",
    "set -e",
    'export ELECTRON_RUN_AS_NODE="1"',
    'export MCP_HARNESS_PACKAGED="1"',
    `export MCP_HARNESS_INSTALL_DIR="${installDirForShim()}"`,
    `exec "${exe}" "${entry}" "$@"`,
    "",
  ].join("\n");
}

function installDirForShim(): string {
  return process.env.MCP_HARNESS_INSTALL_DIR || "";
}

export async function ensureMcpShim(): Promise<string> {
  const runtime = packagedRuntime();
  if (!runtime) return "";
  await fsp.mkdir(mcpShimDir(), { recursive: true });
  const shimFile = mcpShimPath();
  const body = process.platform === "win32"
    ? windowsShimBody(runtime.executable, runtime.asarEntry)
    : posixShimBody(runtime.executable, runtime.asarEntry);
  await fsp.writeFile(shimFile, body, "utf8");
  if (process.platform !== "win32") {
    try {
      await fsp.chmod(shimFile, 0o755);
    } catch {
      // POSIX-only; ignored on Windows.
    }
  }
  return shimFile;
}

export function packagedMcpCommand(mcpId: string, profileId: string): string[] {
  const shim = mcpShimPath();
  return [shim, "mcp", mcpId, "--profile", profileId];
}

export function shimExists(): boolean {
  try {
    return fs.existsSync(mcpShimPath());
  } catch {
    return false;
  }
}
