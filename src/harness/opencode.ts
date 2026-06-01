import fs from "node:fs/promises";
import path from "node:path";
import { defaultOpenCodeConfigPath, appDataDir, commandForBundledMcp } from "./paths.js";
import { readJsonCFile, writePrettyJson } from "./jsonc.js";
import { appendLog, markClientBinding } from "./state.js";

export interface OpenCodeMcpEntry {
  type: "local";
  command: string[];
  enabled: boolean;
  environment?: Record<string, string>;
  timeout?: number;
}

export interface OpenCodeConfig {
  $schema?: string;
  mcp?: Record<string, unknown>;
  [key: string]: unknown;
}

function backupStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function buildOpenCodeMcpEntry(mcpId: string, profileId = "default", enabled = true): OpenCodeMcpEntry {
  return {
    type: "local",
    command: commandForBundledMcp(mcpId, profileId),
    enabled,
    timeout: 15000,
    environment: {
      MCP_HARNESS_HOME: appDataDir(),
    },
  };
}

export async function previewOpenCodeConfig(options: {
  mcpId: string;
  profileId?: string;
  enabled?: boolean;
  configPath?: string;
}): Promise<{ configPath: string; entry: OpenCodeMcpEntry }> {
  const configPath = path.resolve(options.configPath || defaultOpenCodeConfigPath());
  return {
    configPath,
    entry: buildOpenCodeMcpEntry(options.mcpId, options.profileId || "default", options.enabled ?? true),
  };
}

export async function applyOpenCodeConfig(options: {
  mcpId: string;
  profileId?: string;
  enabled?: boolean;
  configPath?: string;
}): Promise<{ configPath: string; backupPath?: string; entry: OpenCodeMcpEntry }> {
  const configPath = path.resolve(options.configPath || defaultOpenCodeConfigPath());
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  const existing = await readJsonCFile<OpenCodeConfig>(configPath, {});
  existing.$schema ||= "https://opencode.ai/config.json";
  if (!existing.mcp || typeof existing.mcp !== "object" || Array.isArray(existing.mcp)) existing.mcp = {};

  let backupPath: string | undefined;
  try {
    await fs.access(configPath);
    backupPath = `${configPath}.bak-${backupStamp()}`;
    await fs.copyFile(configPath, backupPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const profileId = options.profileId || "default";
  const entry = buildOpenCodeMcpEntry(options.mcpId, profileId, options.enabled ?? true);
  existing.mcp[options.mcpId] = entry;
  await writePrettyJson(configPath, existing);

  await markClientBinding({
    harnessId: "opencode",
    mcpId: options.mcpId,
    profileId,
    enabled: options.enabled ?? true,
    configPath,
    lastAppliedAt: new Date().toISOString(),
  });
  await appendLog(`Applied ${options.mcpId}/${profileId} to OpenCode config ${configPath}`);

  return { configPath, backupPath, entry };
}
