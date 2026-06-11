import fs from "node:fs/promises";
import path from "node:path";
import { defaultOpenCodeConfigPath, appDataDir, commandForBundledMcp } from "./paths.js";
import { readJsonCFile, writePrettyJson } from "./jsonc.js";
import { appendLog, getEffectiveEnv, markClientBinding } from "./state.js";
import { ensureMcpShim } from "./shim.js";
import { buildRemoteCcMcpCommand, isRemoteCcConfigured } from "./remoteCc.js";

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
  "cc-mcp": 1800000,
};

const INSTRUCTION_FILES: Record<string, string> = {
  "minimax-bridge": "mcp-harness-minimax.instructions.md",
  agnes: "mcp-harness-agnes.instructions.md",
  "cc-mcp": "mcp-harness-cc-mcp.instructions.md",
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

const CC_MCP_INSTRUCTION_TEXT = `# MCP Harness CC MCP Routing

Use CC MCP as a delegated coding executor, not as a chat assistant.

- You are the orchestrator: understand the user request, inspect the project when needed, decompose work, communicate with the user, and verify the result.
- Delegate only concrete coding subtasks to cc-mcp_delegate when the user or active workflow intentionally calls for cc-mcp or Claude Code execution. Good modes are implement, debug, refactor, test, review, and inspect.
- Delegate only work that can be completed inside the configured worker environment. Do not use cc-mcp for primary-machine-only files, local shell commands, desktop apps, or local-only paths unavailable to the worker.
- Once the user or active workflow intentionally chooses cc-mcp/Claude Code for a task, all file edits, shell commands, tests, and repository inspection for that task must happen through cc-mcp in the worker environment. The main harness should supervise, split work, read the returned terminalLog/result, and verify outcomes; it should not run parallel local Bash/Python/heredoc commands for that task.
- Do not place long scripts, large base64 payloads, or heredoc bodies in cc-mcp_delegate task text. For long script transfer, base64-encode locally, split into chunks around 1500 characters, call cc-mcp_delegate with action=append_file for each chunk, call cc-mcp_delegate with action=finalize_file and sha256, then call cc-mcp_delegate with action=run_command to execute it in the worker workspace.
- Do not delegate vague planning, product judgment, user-facing explanation, or tasks that require asking the user for clarification.
- Before delegation, provide mode, task, relevant context, constraints, target files when known, and acceptance criteria. Provide workspace/cwd only when the worker should run outside the configured default workdir.
- After the worker returns, review the structured report, inspect claimed changes when needed, decide whether acceptance criteria are met, and either continue with another delegated subtask or summarize the final result.
- Do not blindly trust the worker result. If the task is simple enough to complete directly, do it directly instead of delegating.
- cc-mcp captures Claude Code stdout/stderr into terminalLog. Read the final cc-mcp result, including terminalLog, before responding.
- cc-mcp may stream Claude Code progress while the tool call is running. If Claude Code asks for permissions and the main harness supports authorization prompts, answer them according to the active harness permissions.
- For diagnostics, call cc-mcp_delegate with action=status to check whether the configured Claude Code command is available.
`;

function remoteCcInstructionText(env: Record<string, string>): string {
  const nickname = env.CC_MCP_REMOTE_NICKNAME?.trim() || env.CC_MCP_REMOTE_HOST?.trim() || "the configured remote server";
  const workdir = env.CC_MCP_REMOTE_WORKDIR?.trim();
  return `${CC_MCP_INSTRUCTION_TEXT}

Remote cc-mcp target: ${nickname}
- Do not use this target for primary-machine-only files, local shell commands, desktop apps, or local-only paths.
- ${workdir ? `The configured default worker workspace is ${workdir}.` : "If delegation is intentional and needs a non-default workspace, pass the absolute path that is valid in the worker environment."}
- Claude Code is already running on this target; use workspace/cwd directly for files on this target instead of wrapping the work in another ssh command.
`;
}

function backupStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function instructionFileForMcp(mcpId: string): string {
  return INSTRUCTION_FILES[mcpId] || `mcp-harness-${mcpId}.instructions.md`;
}

async function instructionTextForMcp(mcpId: string, profileId = "default"): Promise<string> {
  if (mcpId === "cc-mcp") {
    const env = await getEffectiveEnv(mcpId, profileId).catch(() => ({}));
    return isRemoteCcConfigured(env) ? remoteCcInstructionText(env) : CC_MCP_INSTRUCTION_TEXT;
  }
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

async function writeInstructionFile(configPath: string, mcpId: string, profileId = "default"): Promise<string> {
  const instructionPath = instructionPathForConfig(configPath, mcpId);
  await fs.writeFile(instructionPath, await instructionTextForMcp(mcpId, profileId), "utf8");
  return instructionPath;
}

export async function buildOpenCodeMcpEntry(mcpId: string, profileId = "default", enabled = true): Promise<OpenCodeMcpEntry> {
  if (mcpId === "cc-mcp") {
    const env = await getEffectiveEnv(mcpId, profileId).catch(() => ({}));
    const remoteCommand = isRemoteCcConfigured(env) ? buildRemoteCcMcpCommand(env, profileId) : undefined;
    if (remoteCommand) {
      return {
        type: "local",
        command: remoteCommand,
        enabled,
        timeout: MCP_TIMEOUT_MS[mcpId] || 120000,
      };
    }
  }

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
    entry: await buildOpenCodeMcpEntry(options.mcpId, options.profileId || "default", options.enabled ?? true),
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
  const entry = await buildOpenCodeMcpEntry(options.mcpId, profileId, options.enabled ?? true);
  const instructionRef = instructionRefForConfig(configPath, options.mcpId);
  const instructionPath = instructionPathForConfig(configPath, options.mcpId);
  if (options.enabled === false) {
    delete existing.mcp[options.mcpId];
    if (Array.isArray(existing.instructions)) {
      existing.instructions = existing.instructions.filter((item) => !refsEqual(item, instructionRef));
    }
  } else {
    existing.mcp[options.mcpId] = entry;
    mergeInstruction(existing, instructionRef);
    await writeInstructionFile(configPath, options.mcpId, profileId);
  }
  await writePrettyJson(configPath, existing);

  await markClientBinding({
    harnessId: "opencode",
    mcpId: options.mcpId,
    profileId,
    enabled: options.enabled ?? true,
    configPath,
    lastAppliedAt: new Date().toISOString(),
  });
  await appendLog(`${options.enabled === false ? "Removed" : "Applied"} ${options.mcpId}/${profileId} ${options.enabled === false ? "from" : "to"} OpenCode config ${configPath}`);

  return { configPath, backupPath, entry, instructionPath, instructionRef };
}
