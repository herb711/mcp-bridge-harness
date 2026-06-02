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

const MCP_TIMEOUT_MS: Record<string, number> = {
  "minimax-bridge": 120000,
  agnes: 600000,
};

const INSTRUCTION_FILES: Record<string, string> = {
  "minimax-bridge": "mcp-harness-minimax.instructions.md",
  agnes: "mcp-harness-agnes.instructions.md",
};

const MINIMAX_INSTRUCTION_TEXT = `# MCP Harness MiniMax Routing

Use the MiniMax Bridge MCP proactively. The user should not need to explicitly name MCP tools.

- For current, external, real-time, or web information, call minimax-bridge_web_search.
- For image, screenshot, logo, UI, OCR, or visual analysis when a local file path or URL is available, call minimax-bridge_understand_image.
- For minimax-bridge_understand_image, pass image_source and prompt. If the user provides image_url, treat it as image_source. Local paths, file:// URLs, HTTP(S) URLs, and data URLs are accepted.
- If the user pasted or attached an image but no file path, URL, or accessible image source is available to tools, ask for the local path or URL.
- For speech, image, video, music, lyrics, voice clone, or query tasks, use the relevant minimax-bridge tool when the request is explicit enough.
`;

const AGNES_INSTRUCTION_TEXT = `# MCP Harness Agnes Routing

Use the Agnes MCP proactively for Agnes image and video generation. The user should not need to explicitly name MCP tools.

- For image generation or image-to-image editing, call agnes_image_21_flash.
- For text-to-video, image-to-video, multi-image video, or keyframe animation, call agnes_video_v20.
- For agnes_video_v20, use model agnes-video-v2.0 unless the user explicitly asks for another model.
- For multi-image video, pass image URLs in images. For keyframe animation, pass images and mode: "keyframes".
- For an existing video task ID, call agnes_query_video_v20.
- If the user provides a local image file, ask for a URL that Agnes can fetch unless the file has already been uploaded somewhere accessible.
`;

function backupStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function instructionFileForMcp(mcpId: string): string {
  return INSTRUCTION_FILES[mcpId] || `mcp-harness-${mcpId}.instructions.md`;
}

function instructionTextForMcp(mcpId: string): string {
  return mcpId === "agnes" ? AGNES_INSTRUCTION_TEXT : MINIMAX_INSTRUCTION_TEXT;
}

function instructionPathForConfig(configPath: string, mcpId: string): string {
  return path.join(path.dirname(configPath), instructionFileForMcp(mcpId));
}

function instructionRefForConfig(configPath: string, mcpId: string): string {
  return instructionPathForConfig(configPath, mcpId).replace(/\\/g, "/");
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

async function writeInstructionFile(configPath: string, mcpId: string): Promise<string> {
  const instructionPath = instructionPathForConfig(configPath, mcpId);
  await fs.writeFile(instructionPath, instructionTextForMcp(mcpId), "utf8");
  return instructionPath;
}

export function buildOpenCodeMcpEntry(mcpId: string, profileId = "default", enabled = true): OpenCodeMcpEntry {
  return {
    type: "local",
    command: commandForBundledMcp(mcpId, profileId),
    enabled,
    timeout: MCP_TIMEOUT_MS[mcpId] || 120000,
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
    instructionPath: instructionPathForConfig(configPath, options.mcpId),
    instructionRef: instructionRefForConfig(configPath, options.mcpId),
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
  const instructionRef = instructionRefForConfig(configPath, options.mcpId);
  existing.mcp[options.mcpId] = entry;
  mergeInstruction(existing, instructionRef);
  const instructionPath = await writeInstructionFile(configPath, options.mcpId);
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
