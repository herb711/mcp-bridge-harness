import fs from "node:fs/promises";
import path from "node:path";
import { defaultOpenCodeConfigPath, appDataDir, commandForBundledMcp } from "./paths.js";
import { readJsonCFile, writePrettyJson } from "./jsonc.js";
import { appendLog, markClientBinding } from "./state.js";
import { ensureMcpShim } from "./shim.js";

export interface OpenCodeMcpEntry {
  type: "local";
  command: string[];
  enabled: boolean;
  environment?: Record<string, string>;
  timeout?: number;
}

export interface OpenCodeConfig {
  $schema?: string;
  instructions?: unknown;
  mcp?: Record<string, unknown>;
  [key: string]: unknown;
}

const MINIMAX_INSTRUCTION_FILE = "mcp-harness-minimax.instructions.md";
const MINIMAX_MCP_TIMEOUT_MS = 120000;
const MINIMAX_INSTRUCTION_TEXT = `# MCP Harness MiniMax Routing

Use the MiniMax Bridge MCP proactively. The user should not need to explicitly name MCP tools.

- For current, external, real-time, or web information, call minimax-bridge_web_search.
- For image, screenshot, logo, UI, OCR, or visual analysis when a local file path or URL is available, call minimax-bridge_understand_image.
- For minimax-bridge_understand_image, pass image_source and prompt. If the user provides image_url, treat it as image_source. Local paths, file:// URLs, HTTP(S) URLs, and data URLs are accepted.
- If the user pasted or attached an image but no file path, URL, or accessible image source is available to tools, ask for the local path or URL.
- For speech, image, video, music, lyrics, voice clone, or query tasks, use the relevant minimax-bridge tool when the request is explicit enough.
`;

function backupStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function instructionPathForConfig(configPath: string): string {
  return path.join(path.dirname(configPath), MINIMAX_INSTRUCTION_FILE);
}

function instructionRefForConfig(configPath: string): string {
  return instructionPathForConfig(configPath).replace(/\\/g, "/");
}

function refsEqual(a: unknown, b: string): boolean {
  return typeof a === "string" && a.replace(/\\/g, "/").toLowerCase() === b.toLowerCase();
}

function mergeInstruction(existing: OpenCodeConfig, instructionRef: string): void {
  const instructions = Array.isArray(existing.instructions) ? [...existing.instructions] : [];
  if (!instructions.some((item) => refsEqual(item, instructionRef))) {
    instructions.push(instructionRef);
  }
  existing.instructions = instructions;
}

async function writeInstructionFile(configPath: string): Promise<string> {
  const instructionPath = instructionPathForConfig(configPath);
  await fs.writeFile(instructionPath, MINIMAX_INSTRUCTION_TEXT, "utf8");
  return instructionPath;
}

export function buildOpenCodeMcpEntry(mcpId: string, profileId = "default", enabled = true): OpenCodeMcpEntry {
  return {
    type: "local",
    command: commandForBundledMcp(mcpId, profileId),
    enabled,
    timeout: MINIMAX_MCP_TIMEOUT_MS,
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
}): Promise<{ configPath: string; entry: OpenCodeMcpEntry; instructionPath: string; instructionRef: string }> {
  const configPath = path.resolve(options.configPath || defaultOpenCodeConfigPath());
  return {
    configPath,
    entry: buildOpenCodeMcpEntry(options.mcpId, options.profileId || "default", options.enabled ?? true),
    instructionPath: instructionPathForConfig(configPath),
    instructionRef: instructionRefForConfig(configPath),
  };
}

export async function applyOpenCodeConfig(options: {
  mcpId: string;
  profileId?: string;
  enabled?: boolean;
  configPath?: string;
}): Promise<{ configPath: string; backupPath?: string; entry: OpenCodeMcpEntry; instructionPath: string; instructionRef: string }> {
  await ensureMcpShim();
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
  const instructionRef = instructionRefForConfig(configPath);
  existing.mcp[options.mcpId] = entry;
  mergeInstruction(existing, instructionRef);
  const instructionPath = await writeInstructionFile(configPath);
  await writePrettyJson(configPath, existing);

  await markClientBinding({
    harnessId: "opencode",
    mcpId: options.mcpId,
    profileId,
    enabled: options.enabled ?? true,
    configPath,
    lastAppliedAt: new Date().toISOString(),
  });
  await appendLog(`Applied ${options.mcpId}/${profileId} to OpenCode config ${configPath} with instructions ${instructionPath}`);

  return { configPath, backupPath, entry, instructionPath, instructionRef };
}
