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
} from "@modelcontextprotocol/sdk/types.js";
import { ArtifactStore } from "./artifacts.js";
import { loadAgnesConfig } from "./agnesConfig.js";
import { AgnesHttpClient } from "./agnesHttp.js";
import { AGNES_TOOLS } from "./agnesToolSchemas.js";
import { loadConfig } from "./config.js";
import { errorToJson } from "./errors.js";
import { MiniMaxHttpClient } from "./minimaxHttp.js";
import { enhanceImageToolResult, isCallToolResult, toCallToolResult } from "./mcpResults.js";
import { OfficialMiniMaxProxy } from "./officialMiniMaxProxy.js";
import { TokenPlanProxy } from "./tokenPlanProxy.js";
import { TOOLS } from "./toolSchemas.js";
import { getAgentManifest } from "./manifest.js";
import { applyProfileToProcessEnv } from "./harness/state.js";
import { installHarness, startHarnessServer } from "./harness/server.js";

const BUNDLED_MCP_IDS = new Set(["minimax-bridge", "agnes"]);

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

  mcp-harness --manifest
      Print Redou/Harness style MCP manifest.

  mcp-harness --tools
      Print MCP tool schemas.

Backward compatibility:
  Running without a Harness command starts the MiniMax Bridge MCP stdio server.
`);
}

function toolsForMcp(mcpId: string) {
  return mcpId === "agnes" ? AGNES_TOOLS : TOOLS;
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

async function runMcpServer(mcpId = "minimax-bridge"): Promise<void> {
  if (mcpId === "agnes") {
    await runAgnesMcpServer();
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

  async function dispatchTool(name: string, args: unknown): Promise<unknown | CallToolResult> {
    switch (name) {
      // Token Plan branch. These two tools are proxied to MiniMax's Token Plan MCP.
      case "web_search":
        return tokenPlan.callTool("web_search", args);
      case "understand_image":
        return tokenPlan.callTool("understand_image", args);

      // Official MiniMax MCP branch first where its tool surface matches our request.
      // Extended or unsupported requests fall through to our HTTP/WebSocket implementation.
      case "text_to_audio":
        if (officialMiniMax.canHandle(name, args)) return officialMiniMax.callTool(name, args);
        return minimax.textToAudio(args);
      case "query_text_to_audio":
        return minimax.queryTextToAudio(args);
      case "list_voices":
        if (officialMiniMax.canHandle(name, args)) return officialMiniMax.callTool(name, args);
        return minimax.listVoices(args);
      case "voice_clone":
        if (officialMiniMax.canHandle(name, args)) return officialMiniMax.callTool(name, args);
        return minimax.voiceClone(args);
      case "text_to_image":
        if (officialMiniMax.canHandle(name, args)) return officialMiniMax.callTool(name, args);
        return minimax.textToImage(args);
      case "generate_video":
        if (officialMiniMax.canHandle(name, args)) return officialMiniMax.callTool(name, args);
        return minimax.generateVideo(args);
      case "image_to_video":
        if (officialMiniMax.canHandle(name, args)) return officialMiniMax.callTool(name, args);
        return minimax.generateVideo(args);
      case "query_video_generation":
        if (officialMiniMax.canHandle(name, args)) return officialMiniMax.callTool(name, args);
        return minimax.queryVideoGeneration(args);
      case "video_template_generation":
        return minimax.videoTemplateGeneration(args);
      case "query_video_template_generation":
        return minimax.queryVideoTemplateGeneration(args);
      case "lyrics_generation":
        return minimax.lyricsGeneration(args);
      case "music_generation":
        if (officialMiniMax.canHandle(name, args)) return officialMiniMax.callTool(name, args);
        return minimax.musicGeneration(args);
      case "music_cover_preprocess":
        return minimax.musicCoverPreprocess(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

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
    await applyProfileToProcessEnv(mcpId, profileId);
    await runMcpServer(mcpId);
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
