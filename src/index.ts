#!/usr/bin/env node
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { ArtifactStore } from "./artifacts.js";
import { loadAgnesConfig } from "./agnesConfig.js";
import { AgnesHttpClient } from "./agnesHttp.js";
import { AGNES_TOOLS } from "./agnesToolSchemas.js";
import { claudeCodeStatus, delegateToClaudeCode, readHarnessTask, sendMessageToHarness, workspaceAppendFile, workspaceFinalizeFile, workspaceRunCommand, type CcPermissionDecision, type CcPermissionRequest, type CcRunHooks, type CcRuntimeEvent } from "./ccBridge.js";
import { CC_CALLBACK_TOOLS, ccToolsFromEnv } from "./ccToolSchemas.js";
import { loadConfig } from "./config.js";
import { errorToJson } from "./errors.js";
import { MiniMaxHttpClient } from "./minimaxHttp.js";
import { enhanceImageToolResult, isCallToolResult, toCallToolResult } from "./mcpResults.js";
import { OfficialMiniMaxProxy } from "./officialMiniMaxProxy.js";
import { TokenPlanProxy } from "./tokenPlanProxy.js";
import { EXTENDED_MINIMAX_TOOL_NAME_SET, EXTENDED_TOOLS, LEGACY_MINIMAX_TOOLS, OFFICIAL_MINIMAX_TOOL_NAME_SET, TOOLS } from "./toolSchemas.js";
import { getAgentManifest } from "./manifest.js";
import { applyProfileToProcessEnv } from "./harness/state.js";
import { installHarness, startHarnessServer } from "./harness/server.js";

const BUNDLED_MCP_IDS = new Set(["minimax-bridge", "agnes", "cc-mcp", "cc-mcp-callback"]);

function argValue(argv: string[], name: string, fallback?: string): string | undefined {
  const eqPrefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(eqPrefix));
  if (inline) return inline.slice(eqPrefix.length);
  const index = argv.indexOf(name);
  if (index !== -1 && argv[index + 1] && !argv[index + 1]?.startsWith("--")) return argv[index + 1];
  return fallback;
}

function numberArg(argv: string[], name: string, fallback: number): number {
  const value = argValue(argv, name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hasArg(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function printHelp(): void {
  console.log(`MCP Harness

Usage:
  mcp-harness app
      Start the MCP Harness desktop app.

  mcp-harness serve [--port 45321] [--no-open]
      Start the legacy localhost web dashboard for development only.

  mcp-harness install [--open]
      Initialize local Harness data and install the bundled MiniMax MCP into Harness.
      With --open, launch the desktop app.

  mcp-harness mcp minimax-bridge [--profile default]
      Run the bundled MiniMax Bridge MCP over stdio. This is what OpenCode starts.

  mcp-harness mcp agnes [--profile default]
      Run the bundled Agnes MCP over stdio.

  mcp-harness mcp cc-mcp [--profile default]
      Run the bundled CC MCP bridge for the main harness to delegate work to Claude Code.

  mcp-harness mcp cc-mcp-callback [--profile default]
      Run the temporary CC MCP callback server used by Claude Code sessions.

  mcp-harness --manifest
      Print Redou/Harness style MCP manifest.

  mcp-harness --tools
      Print MCP tool schemas.

Backward compatibility:
  Running without a Harness command starts the MiniMax Bridge MCP stdio server.
`);
}

function toolsForMcp(mcpId: string) {
  if (mcpId === "agnes") return AGNES_TOOLS;
  if (mcpId === "cc-mcp") return ccToolsFromEnv(process.env);
  if (mcpId === "cc-mcp-callback") return CC_CALLBACK_TOOLS;
  return TOOLS;
}

function clipForNotification(value: string, max = 1200): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.floor(max / 2))}\n...\n${value.slice(value.length - Math.floor(max / 2))}`;
}

function mainHarnessLooksFullyAuthorized(): boolean {
  const values = [
    process.env.CC_MCP_MAIN_HARNESS_PERMISSION,
    process.env.MCP_HARNESS_MAIN_PERMISSION,
    process.env.MCP_HARNESS_PERMISSION_MODE,
    process.env.CODEX_SANDBOX_MODE,
    process.env.SANDBOX_MODE,
  ]
    .map((item) => item?.trim().toLowerCase())
    .filter(Boolean);
  return values.some((item) => /^(full|auto|auto-approve|danger-full-access|unrestricted|no-sandbox)$/.test(item || ""));
}

function ccEventMessage(event: CcRuntimeEvent): string {
  const prefix = event.kind === "permission" ? "Claude Code permission" : `Claude Code ${event.stream}`;
  return `${prefix}: ${clipForNotification(event.text, 900)}`;
}

function createCcRunHooks(server: Server, extra: { _meta?: { progressToken?: string | number }; sessionId?: string; sendNotification?: (notification: any) => Promise<void> }): CcRunHooks {
  const progressToken = extra._meta?.progressToken;
  return {
    async onEvent(event) {
      const message = ccEventMessage(event);
      if (progressToken != null && extra.sendNotification) {
        await extra.sendNotification({
          method: "notifications/progress",
          params: {
            progressToken,
            progress: event.sequence,
            message,
          },
        }).catch(() => undefined);
      }
      await server.sendLoggingMessage({
        level: event.kind === "permission" ? "warning" : "info",
        logger: "cc-mcp",
        data: {
          sessionId: event.sessionId,
          stream: event.stream,
          kind: event.kind,
          sequence: event.sequence,
          text: clipForNotification(event.text),
          metadata: event.metadata,
        },
      }, extra.sessionId).catch(() => undefined);
    },
    async authorizePermission(request): Promise<CcPermissionDecision> {
      if (mainHarnessLooksFullyAuthorized()) {
        return {
          approved: true,
          source: "main_harness_full",
          reason: "Main harness environment indicates full permission.",
          responseText: process.env.CC_CLAUDE_PERMISSION_APPROVE_INPUT || "y\n",
        };
      }

      const capabilities = server.getClientCapabilities();
      if (!capabilities?.elicitation?.form) {
        return {
          approved: true,
          source: "fallback",
          reason: "Main harness does not advertise MCP form elicitation support; cc-mcp auto-approved to avoid silent Write/Edit denial.",
          responseText: process.env.CC_CLAUDE_PERMISSION_APPROVE_INPUT || "y\n",
        };
      }

      const result = await server.elicitInput({
        mode: "form",
        message: [
          "Claude Code is requesting permission during delegated execution.",
          "",
          clipForNotification(request.prompt, 3000),
        ].join("\n"),
        requestedSchema: {
          type: "object",
          properties: {
            decision: {
              type: "string",
              title: "Decision",
              enum: ["allow", "deny"],
              enumNames: ["Allow once", "Deny"],
              default: "deny",
            },
            reason: {
              type: "string",
              title: "Reason",
              description: "Optional note for the permission decision.",
            },
          },
          required: ["decision"],
        },
      }, { timeout: Number(process.env.CC_MCP_PERMISSION_REQUEST_TIMEOUT_MS || 120000) });

      const content = result.content || {};
      const approved = result.action === "accept" && content.decision === "allow";
      return {
        approved,
        source: "main_harness_elicitation",
        reason: typeof content.reason === "string" && content.reason ? content.reason : `Elicitation action: ${result.action}`,
        responseText: approved
          ? process.env.CC_CLAUDE_PERMISSION_APPROVE_INPUT || "y\n"
          : process.env.CC_CLAUDE_PERMISSION_DENY_INPUT || "n\n",
      };
    },
  };
}

async function launchDesktopApp(): Promise<void> {
  const require = createRequire(import.meta.url);
  let electronBinary: string;
  try {
    const resolved = require("electron") as unknown;
    if (typeof resolved !== "string") {
      throw new Error("The electron package did not return an executable path.");
    }
    electronBinary = resolved;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Electron desktop runtime is not installed or cannot be resolved. Run npm install first, or use \`node dist/index.js serve\` only for legacy web development. Details: ${reason}`);
  }

  const desktopMain = fileURLToPath(new URL("../desktop/main.cjs", import.meta.url));
  await installHarness();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(electronBinary, [desktopMain], {
      cwd: path.dirname(desktopMain),
      stdio: "inherit",
      env: { ...process.env, MCP_HARNESS_DESKTOP: "1" },
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code && code !== 0) reject(new Error(`MCP Harness desktop exited with code ${code}.`));
      else resolve();
    });
  });
}

async function runMcpServer(mcpId = "minimax-bridge", profileId = "default"): Promise<void> {
  if (mcpId === "agnes") {
    await runAgnesMcpServer();
    return;
  }
  if (mcpId === "cc-mcp") {
    await runCcMcpServer(profileId);
    return;
  }
  if (mcpId === "cc-mcp-callback") {
    await runCcCallbackMcpServer();
    return;
  }

  const config = loadConfig();
  const store = new ArtifactStore(config.basePath);
  const minimax = new MiniMaxHttpClient(config, store);
  const tokenPlan = new TokenPlanProxy(config);
  const officialMiniMax = new OfficialMiniMaxProxy(config);

  const server = new Server(
    { name: "minimax-bridge-mcp", version: "0.2.0-harness.1" },
    { capabilities: { tools: {} } },
  );

  function mergeTools(primary: Tool[], secondary: Tool[]): Tool[] {
    const seen = new Set<string>();
    const merged: Tool[] = [];
    for (const tool of [...primary, ...secondary]) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      merged.push(tool);
    }
    return merged;
  }

  async function officialToolsOrFallback(): Promise<Tool[]> {
    if (!officialMiniMax.enabled) return [];
    try {
      return await officialMiniMax.listTools();
    } catch {
      return TOOLS.filter((tool) => OFFICIAL_MINIMAX_TOOL_NAME_SET.has(tool.name));
    }
  }

  async function bridgeTools(): Promise<Tool[]> {
    if (!officialMiniMax.enabled) return LEGACY_MINIMAX_TOOLS;
    const officialTools = await officialToolsOrFallback();
    return config.enableExtendedTools
      ? mergeTools(officialTools, EXTENDED_TOOLS)
      : officialTools;
  }

  async function officialToolNames(): Promise<Set<string>> {
    if (!officialMiniMax.enabled) return new Set();
    return new Set((await officialToolsOrFallback()).map((tool) => tool.name));
  }

  async function dispatchExtendedTool(name: string, args: unknown): Promise<unknown | CallToolResult> {
    switch (name) {
      case "web_search":
        return tokenPlan.callTool("web_search", args);
      case "understand_image":
        return tokenPlan.callTool("understand_image", args);
      case "query_text_to_audio":
        return minimax.queryTextToAudio(args);
      case "video_template_generation":
        return minimax.videoTemplateGeneration(args);
      case "query_video_template_generation":
        return minimax.queryVideoTemplateGeneration(args);
      case "lyrics_generation":
        return minimax.lyricsGeneration(args);
      case "music_cover_preprocess":
        return minimax.musicCoverPreprocess(args);
      default:
        throw new Error(`Unknown MiniMax extended tool: ${name}`);
    }
  }

  async function dispatchLegacyTool(name: string, args: unknown): Promise<unknown | CallToolResult> {
    switch (name) {
      case "web_search":
        return tokenPlan.callTool("web_search", args);
      case "understand_image":
        return tokenPlan.callTool("understand_image", args);
      case "text_to_audio":
        return minimax.textToAudio(args);
      case "query_text_to_audio":
        return minimax.queryTextToAudio(args);
      case "list_voices":
        return minimax.listVoices(args);
      case "voice_clone":
        return minimax.voiceClone(args);
      case "text_to_image":
        return minimax.textToImage(args);
      case "generate_video":
      case "image_to_video":
        return minimax.generateVideo(args);
      case "query_video_generation":
        return minimax.queryVideoGeneration(args);
      case "video_template_generation":
        return minimax.videoTemplateGeneration(args);
      case "query_video_template_generation":
        return minimax.queryVideoTemplateGeneration(args);
      case "lyrics_generation":
        return minimax.lyricsGeneration(args);
      case "music_generation":
        return minimax.musicGeneration(args);
      case "music_cover_preprocess":
        return minimax.musicCoverPreprocess(args);
      default:
        throw new Error(`Unknown legacy MiniMax tool: ${name}`);
    }
  }

  async function dispatchTool(name: string, args: unknown): Promise<unknown | CallToolResult> {
    const officialNames = await officialToolNames();
    if (officialNames.has(name)) {
      return officialMiniMax.callTool(name, args);
    }

    if (config.enableExtendedTools && EXTENDED_MINIMAX_TOOL_NAME_SET.has(name)) {
      return dispatchExtendedTool(name, args);
    }

    if (!officialMiniMax.enabled) return dispatchLegacyTool(name, args);

    throw new Error(`Unknown tool: ${name}`);
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await bridgeTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await dispatchTool(request.params.name, request.params.arguments ?? {});

      // If a proxied child MCP already returned a valid MCP CallToolResult, pass it through.
      if (isCallToolResult(result)) {
        return request.params.name === "text_to_image"
          ? enhanceImageToolResult(result)
          : result;
      }
      return toCallToolResult(request.params.name, result);
    } catch (error) {
      return toCallToolResult(request.params.name, errorToJson(error), true);
    }
  });

  process.on("SIGINT", async () => {
    await tokenPlan.close().catch(() => undefined);
    await officialMiniMax.close().catch(() => undefined);
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await tokenPlan.close().catch(() => undefined);
    await officialMiniMax.close().catch(() => undefined);
    process.exit(0);
  });

  await store.ensureBasePath();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runCcMcpServer(profileId = "default"): Promise<void> {
  const tools = ccToolsFromEnv(process.env);
  const server = new Server(
    { name: "cc-mcp", version: "0.1.0-harness.1" },
    { capabilities: { tools: {}, logging: {} } },
  );

  function delegateAction(args: unknown): string {
    const record = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
    const action = typeof record.action === "string" ? record.action.trim().toLowerCase() : "";
    return action || "task";
  }

  function isTaskDelegationCall(name: string, args: unknown): boolean {
    if (name === "delegate_coding_task" || name === "delegate_to_claude_code") return true;
    return name === "delegate" && ["", "task", "delegate", "run_task"].includes(delegateAction(args));
  }

  async function dispatchDelegate(args: unknown, hooks: CcRunHooks): Promise<unknown | CallToolResult> {
    switch (delegateAction(args)) {
      case "task":
      case "delegate":
      case "run_task":
        return delegateToClaudeCode(args, profileId, hooks);
      case "status":
        return claudeCodeStatus();
      case "append_file":
        return workspaceAppendFile(args);
      case "finalize_file":
        return workspaceFinalizeFile(args);
      case "run_command":
        return workspaceRunCommand(args);
      default:
        throw new Error(`Unknown delegate action: ${delegateAction(args)}`);
    }
  }

  async function dispatchTool(name: string, args: unknown, hooks: CcRunHooks = {}): Promise<unknown | CallToolResult> {
    switch (name) {
      case "delegate":
        return dispatchDelegate(args, hooks);
      case "delegate_coding_task":
      case "delegate_to_claude_code":
        return delegateToClaudeCode(args, profileId, hooks);
      case "claude_code_status":
        return claudeCodeStatus();
      case "workspace_append_file":
        return workspaceAppendFile(args);
      case "workspace_finalize_file":
        return workspaceFinalizeFile(args);
      case "workspace_run_command":
        return workspaceRunCommand(args);
      default:
        throw new Error(`Unknown CC MCP tool: ${name}`);
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const isTask = isTaskDelegationCall(request.params.name, request.params.arguments ?? {});
      const hooks = isTask
        ? createCcRunHooks(server, extra)
        : {};
      const result = await dispatchTool(request.params.name, request.params.arguments ?? {}, hooks);
      if (isCallToolResult(result)) return result;
      const callToolResult = await toCallToolResult(request.params.name, result);
      if (isTask) {
        const textBlock = callToolResult.content.find((c): c is { type: "text"; text: string } => c.type === "text");
        if (textBlock) textBlock.text = `Claude Code:\n${textBlock.text}`;
      }
      return callToolResult;
    } catch (error) {
      const callToolResult = await toCallToolResult(request.params.name, errorToJson(error), true);
      if (isTaskDelegationCall(request.params.name, request.params.arguments ?? {})) {
        const textBlock = callToolResult.content.find((c): c is { type: "text"; text: string } => c.type === "text");
        if (textBlock) textBlock.text = `Claude Code:\n${textBlock.text}`;
      }
      return callToolResult;
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runCcCallbackMcpServer(): Promise<void> {
  const server = new Server(
    { name: "cc-mcp-callback", version: "0.1.0-harness.1" },
    { capabilities: { tools: {} } },
  );

  async function dispatchTool(name: string, args: unknown): Promise<unknown | CallToolResult> {
    switch (name) {
      case "send_message_to_harness":
        return sendMessageToHarness(args);
      case "read_harness_task":
        return readHarnessTask(args);
      default:
        throw new Error(`Unknown CC MCP callback tool: ${name}`);
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: CC_CALLBACK_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await dispatchTool(request.params.name, request.params.arguments ?? {});
      return isCallToolResult(result) ? result : toCallToolResult(request.params.name, result);
    } catch (error) {
      return toCallToolResult(request.params.name, errorToJson(error), true);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runAgnesMcpServer(): Promise<void> {
  const config = loadAgnesConfig();
  const store = new ArtifactStore(config.basePath);
  const agnes = new AgnesHttpClient(config, store);

  const server = new Server(
    { name: "agnes-mcp", version: "0.1.0-harness.1" },
    { capabilities: { tools: {} } },
  );

  async function dispatchTool(name: string, args: unknown): Promise<unknown | CallToolResult> {
    switch (name) {
      case "image_21_flash":
        return agnes.image21Flash(args);
      case "video_v20":
        return agnes.videoV20(args);
      case "query_video_v20":
        return agnes.queryVideoV20(args);
      default:
        throw new Error(`Unknown Agnes tool: ${name}`);
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: AGNES_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await dispatchTool(request.params.name, request.params.arguments ?? {});
      return isCallToolResult(result) ? result : toCallToolResult(request.params.name, result);
    } catch (error) {
      return toCallToolResult(request.params.name, errorToJson(error), true);
    }
  });

  await store.ensureBasePath();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (argv.includes("--manifest")) {
    console.log(JSON.stringify(getAgentManifest(), null, 2));
    return;
  }

  if (argv.includes("--tools")) {
    const mcpId = argValue(argv, "--mcp", "minimax-bridge") || "minimax-bridge";
    console.log(JSON.stringify({ tools: toolsForMcp(mcpId) }, null, 2));
    return;
  }

  if (argv.includes("--help") || argv.includes("-h") || command === "help") {
    printHelp();
    return;
  }

  if (command === "install" || argv.includes("--install-harness")) {
    await installHarness();
    console.log("MCP Harness local data initialized.");
    if (hasArg(argv, "--open")) {
      await launchDesktopApp();
    }
    return;
  }

  if (command === "app" || command === "desktop" || command === "harness" || argv.includes("--harness")) {
    await launchDesktopApp();
    return;
  }

  if (command === "serve" || command === "web") {
    await startHarnessServer({
      port: numberArg(argv, "--port", 45321),
      open: !hasArg(argv, "--no-open"),
    });
    return;
  }

  if (command === "mcp") {
    const mcpId = argv[1] || "minimax-bridge";
    const profileId = argValue(argv, "--profile", "default") || "default";
    if (!BUNDLED_MCP_IDS.has(mcpId)) throw new Error(`Unknown bundled MCP: ${mcpId}`);
    await applyProfileToProcessEnv(mcpId === "cc-mcp-callback" ? "cc-mcp" : mcpId, profileId);
    await runMcpServer(mcpId, profileId);
    return;
  }

  // Backward compatibility: existing OpenCode/Codex configs that run node dist/index.js still get the stdio MCP.
  await runMcpServer("minimax-bridge");
}

main().catch((error) => {
  // Never write MCP diagnostics to stdout; stdio transport reserves stdout for JSON-RPC.
  console.error("mcp-harness failed", error);
  process.exit(1);
});
