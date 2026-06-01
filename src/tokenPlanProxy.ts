import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "./config.js";
import { UserInputError } from "./errors.js";

export class TokenPlanProxy {
  private client?: Client;
  private transport?: StdioClientTransport;
  private connecting?: Promise<Client>;

  constructor(private readonly config: Config) {}

  private async connect(): Promise<Client> {
    if (!this.config.enableTokenPlanProxy) {
      throw new UserInputError("Token Plan proxy is disabled. Set MINIMAX_ENABLE_TOKEN_PLAN_PROXY=true to enable web_search/understand_image.");
    }
    if (!this.config.tokenPlanApiKey) {
      throw new UserInputError("Missing MINIMAX_PLAN_API_KEY or MINIMAX_API_KEY for the Token Plan MCP proxy.");
    }
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === "string") env[key] = value;
      }
      env.MINIMAX_API_KEY = this.config.tokenPlanApiKey;
      env.MINIMAX_API_HOST = this.config.apiHost;
      env.MINIMAX_MCP_BASE_PATH = this.config.basePath;
      env.MINIMAX_API_RESOURCE_MODE = this.config.resourceMode;

      const transport = new StdioClientTransport({
        command: this.config.tokenPlanCommand,
        args: this.config.tokenPlanArgs,
        env,
      });
      const client = new Client({
        name: "minimax-bridge-token-plan-proxy",
        version: "0.1.0",
      });
      await client.connect(transport);
      this.transport = transport;
      this.client = client;
      return client;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  async callTool(name: "web_search" | "understand_image", args: unknown): Promise<CallToolResult> {
    const client = await this.connect();
    const result = await client.callTool({
      name,
      arguments: args && typeof args === "object" ? args as Record<string, unknown> : {},
    });
    return result as CallToolResult;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
    } else if (this.transport) {
      await this.transport.close();
    }
    this.client = undefined;
    this.transport = undefined;
  }
}
