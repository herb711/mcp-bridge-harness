import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "./config.js";
import { UserInputError } from "./errors.js";

const TOKEN_PLAN_TOOL_TIMEOUT_MS = 120_000;

const LOCAL_IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function stripAtPrefix(source: string): string {
  return source.startsWith("@") ? source.slice(1) : source;
}

function isPassThroughImageSource(source: string): boolean {
  return /^(?:https?:|data:)/i.test(source);
}

function filePathFromImageSource(source: string): string {
  if (!/^file:/i.test(source)) return source;
  try {
    return fileURLToPath(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UserInputError(`Invalid file URL for understand_image: ${source}. ${message}`);
  }
}

async function normalizeImageSource(source: string): Promise<string> {
  const cleaned = stripAtPrefix(source.trim());
  if (!cleaned || isPassThroughImageSource(cleaned)) return cleaned;

  const requestedPath = filePathFromImageSource(cleaned);
  const absolutePath = path.isAbsolute(requestedPath) ? requestedPath : path.resolve(process.cwd(), requestedPath);
  const mime = LOCAL_IMAGE_MIME_BY_EXT[path.extname(absolutePath).toLowerCase()];
  if (!mime) {
    throw new UserInputError("understand_image supports local JPEG, PNG, and WebP files. Use an HTTP/HTTPS URL or data URL for other sources.");
  }

  try {
    const buffer = await fs.readFile(absolutePath);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new UserInputError(`Failed to read local image for understand_image: ${absolutePath}.${detail}`);
  }
}

async function normalizeUnderstandImageArgs(args: unknown): Promise<Record<string, unknown>> {
  const input = args && typeof args === "object" && !Array.isArray(args)
    ? { ...(args as Record<string, unknown>) }
    : {};

  const source = input.image_source ?? input.image_url;
  if (typeof source === "string") {
    input.image_source = await normalizeImageSource(source);
  }
  delete input.image_url;
  return input;
}

export class TokenPlanProxy {
  private client?: Client;
  private transport?: StdioClientTransport;
  private connecting?: Promise<Client>;

  private async reset(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = undefined;
    this.transport = undefined;
    this.connecting = undefined;

    if (client) {
      await client.close().catch(() => undefined);
    } else if (transport) {
      await transport.close().catch(() => undefined);
    }
  }

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
    const toolArgs = name === "understand_image"
      ? await normalizeUnderstandImageArgs(args)
      : args && typeof args === "object" ? args as Record<string, unknown> : {};

    try {
      const client = await this.connect();
      const result = await client.callTool({
        name,
        arguments: toolArgs,
      }, undefined, { timeout: TOKEN_PLAN_TOOL_TIMEOUT_MS });
      return result as CallToolResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/not connected|disconnected|closed|transport/i.test(message)) throw error;

      await this.reset();
      const client = await this.connect();
      const result = await client.callTool({
        name,
        arguments: toolArgs,
      }, undefined, { timeout: TOKEN_PLAN_TOOL_TIMEOUT_MS });
      return result as CallToolResult;
    }
  }

  async close(): Promise<void> {
    await this.reset();
  }
}
