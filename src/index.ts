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
import { loadConfig } from "./config.js";
import { errorToJson } from "./errors.js";
import { MiniMaxHttpClient } from "./minimaxHttp.js";
import { TokenPlanProxy } from "./tokenPlanProxy.js";
import { TOOLS } from "./toolSchemas.js";
import { getAgentManifest } from "./manifest.js";
import { applyProfileToProcessEnv } from "./harness/state.js";
import { installHarness, startHarnessServer } from "./harness/server.js";

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

  mcp-harness --manifest
      Print Redou/Harness style MCP manifest.

  mcp-harness --tools
      Print MCP tool schemas.

Backward compatibility:
  Running without a Harness command starts the MiniMax Bridge MCP stdio server.
`);
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

async function runMcpServer(): Promise<void> {
  const config = loadConfig();
  const store = new ArtifactStore(config.basePath);
  const minimax = new MiniMaxHttpClient(config, store);
  const tokenPlan = new TokenPlanProxy(config);

  const server = new Server(
    { name: "minimax-bridge-mcp", version: "0.2.0-harness.1" },
    { capabilities: { tools: {} } },
  );

  function asJsonContent(value: unknown, isError = false): CallToolResult {
    return {
      isError,
      content: [
        {
          type: "text",
          text: JSON.stringify(value, null, 2),
        },
      ],
    };
  }

  async function dispatchTool(name: string, args: unknown): Promise<unknown | CallToolResult> {
    switch (name) {
      // Token Plan branch. These two tools are proxied to MiniMax's Token Plan MCP.
      case "web_search":
        return tokenPlan.callTool("web_search", args);
      case "understand_image":
        return tokenPlan.callTool("understand_image", args);

      // HTTP/WebSocket branch. These tools call MiniMax public APIs directly.
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
        return minimax.generateVideo(args);
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
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await dispatchTool(request.params.name, request.params.arguments ?? {});

      // If a proxied child MCP already returned a valid MCP CallToolResult, pass it through.
      if (result && typeof result === "object" && "content" in result) {
        return result as CallToolResult;
      }
      return asJsonContent(result);
    } catch (error) {
      return asJsonContent(errorToJson(error), true);
    }
  });

  process.on("SIGINT", async () => {
    await tokenPlan.close().catch(() => undefined);
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await tokenPlan.close().catch(() => undefined);
    process.exit(0);
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
    console.log(JSON.stringify({ tools: TOOLS }, null, 2));
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
    if (mcpId !== "minimax-bridge") throw new Error(`Unknown bundled MCP: ${mcpId}`);
    await applyProfileToProcessEnv(mcpId, profileId);
    await runMcpServer();
    return;
  }

  // Backward compatibility: existing OpenCode/Codex configs that run node dist/index.js still get the stdio MCP.
  await runMcpServer();
}

main().catch((error) => {
  // Never write MCP diagnostics to stdout; stdio transport reserves stdout for JSON-RPC.
  console.error("mcp-harness failed", error);
  process.exit(1);
});
