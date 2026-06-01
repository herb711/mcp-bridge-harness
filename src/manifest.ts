import { TOOLS } from "./toolSchemas.js";
import { isSea } from "node:sea";

function transportCommand() {
  if (isSea()) {
    return {
      command: process.execPath,
      args: ["mcp", "minimax-bridge", "--profile", "default"],
    };
  }

  return {
    command: "node",
    args: ["${installDir}/dist/index.js", "mcp", "minimax-bridge", "--profile", "default"],
  };
}

export function getAgentManifest() {
  const command = transportCommand();

  return {
    schemaVersion: "redou.agent.mcp.manifest/v1",
    id: "mcp-harness-minimax-bridge",
    name: "mcp-harness-minimax-bridge",
    displayName: "MCP Harness · MiniMax Bridge MCP",
    version: "0.1.0",
    description:
      "The bundled MiniMax Bridge MCP profile managed by MCP Harness. Use the local Harness UI to configure secrets and sync this MCP to OpenCode.",
    transport: {
      type: "stdio",
      command: command.command,
      args: command.args,
      env: {
        MCP_HARNESS_HOME: {
          required: false,
          description: "Optional custom MCP Harness data directory. Defaults to the platform-specific local app data directory.",
        },
      },
    },
    lifecycle: {
      managedByAgent: true,
      startOnDemand: true,
      restartOnCrash: true,
      shutdownWithAgent: true,
    },
    harness: {
      localUi: {
        command: command.command,
        args: isSea() ? ["harness"] : ["${installDir}/dist/index.js", "harness"],
        defaultUrl: "http://127.0.0.1:45321",
      },
      supportedTargets: ["opencode"],
      reservedTargets: ["codex", "claude-code", "cursor", "vscode"],
    },
    capabilities: {
      tools: TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
      artifacts: ["audio", "image", "video", "music", "json"],
      providers: ["minimax-token-plan-mcp", "minimax-http", "minimax-websocket"],
    },
    security: {
      permissions: ["network:minimax", "file:write:artifacts", "secret:read:harness-profile"],
      notes: [
        "OpenCode config receives a local command and MCP_HARNESS_HOME only; MiniMax API keys are stored in the local Harness profile.",
        "The MCP server must not print diagnostics to stdout because stdout is reserved for MCP JSON-RPC.",
        "Generated files are written under MINIMAX_MCP_BASE_PATH unless output_directory is provided per tool.",
      ],
    },
    links: {
      docs: "./README.md",
      architecture: "./docs/MCP_HARNESS_ARCHITECTURE.md",
      examples: "./examples",
    },
  };
}
