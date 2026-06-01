import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "./config.js";
import { UserInputError } from "./errors.js";

type OfficialToolName =
  | "text_to_audio"
  | "list_voices"
  | "voice_clone"
  | "text_to_image"
  | "generate_video"
  | "image_to_video"
  | "query_video_generation"
  | "music_generation";

const OFFICIAL_VIDEO_MODELS = new Set([
  "T2V-01",
  "T2V-01-Director",
  "I2V-01",
  "I2V-01-Director",
  "I2V-01-live",
  "S2V-01",
  "MiniMax-Hailuo-02",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function hasAny(input: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => input[key] != null && input[key] !== "");
}

function hasAbsoluteOutputDirectory(input: Record<string, unknown>): boolean {
  const outputDirectory = getString(input.output_directory) || getString(input.outputDirectory);
  return Boolean(outputDirectory && path.isAbsolute(outputDirectory));
}

function mapKeys(input: Record<string, unknown>, mapping: Record<string, string>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null || value === "") continue;
    output[mapping[key] || key] = value;
  }
  return output;
}

function normalizeTextToAudioArgs(input: Record<string, unknown>): Record<string, unknown> {
  const output = mapKeys(input, {
    output_directory: "outputDirectory",
    voice_id: "voiceId",
    sample_rate: "sampleRate",
    language_boost: "languageBoost",
    subtitle_enable: "subtitleEnable",
    output_file: "outputFile",
  });
  delete output.async_mode;
  delete output.poll_interval_seconds;
  delete output.max_wait_seconds;
  delete output.transport;
  return output;
}

function normalizeListVoicesArgs(input: Record<string, unknown>): Record<string, unknown> {
  return mapKeys(input, { voice_type: "voiceType" });
}

function normalizeVoiceCloneArgs(input: Record<string, unknown>): Record<string, unknown> {
  return mapKeys(input, {
    voice_id: "voiceId",
    file: "audioFile",
    output_directory: "outputDirectory",
    is_url: "isUrl",
  });
}

function normalizeTextToImageArgs(input: Record<string, unknown>): Record<string, unknown> {
  return mapKeys(input, {
    aspect_ratio: "aspectRatio",
    prompt_optimizer: "promptOptimizer",
    output_directory: "outputDirectory",
    output_file: "outputFile",
  });
}

function normalizeVideoArgs(input: Record<string, unknown>): Record<string, unknown> {
  return mapKeys(input, {
    first_frame_image: "firstFrameImage",
    output_directory: "outputDirectory",
    output_file: "outputFile",
    async_mode: "asyncMode",
  });
}

function normalizeQueryVideoArgs(input: Record<string, unknown>): Record<string, unknown> {
  return mapKeys(input, {
    task_id: "taskId",
    output_directory: "outputDirectory",
  });
}

function normalizeMusicArgs(input: Record<string, unknown>): Record<string, unknown> {
  return mapKeys(input, {
    sample_rate: "sampleRate",
    output_directory: "outputDirectory",
  });
}

function canUseOfficialTool(name: string, input: Record<string, unknown>): name is OfficialToolName {
  if (hasAbsoluteOutputDirectory(input)) return false;

  switch (name) {
    case "list_voices":
      return !hasAny(input, ["language", "query", "limit"]);

    case "text_to_audio":
      return !getBoolean(input.async_mode)
        && !hasAny(input, [
          "transport",
          "poll_interval_seconds",
          "max_wait_seconds",
          "pronunciation_dict",
          "voice_modify",
        ]);

    case "voice_clone":
      return !hasAny(input, ["prompt_audio", "prompt_is_url", "prompt_text", "model"]);

    case "text_to_image": {
      const model = getString(input.model);
      return !hasAny(input, ["subject_reference"]) && (!model || model === "image-01");
    }

    case "generate_video": {
      const model = getString(input.model);
      return Boolean(getString(input.prompt))
        && !hasAny(input, ["last_frame_image", "subject_reference", "poll_interval_seconds", "max_wait_seconds"])
        && (!model || OFFICIAL_VIDEO_MODELS.has(model));
    }

    case "image_to_video": {
      const model = getString(input.model);
      return Boolean(getString(input.first_frame_image) || getString(input.firstFrameImage))
        && !hasAny(input, ["duration", "resolution"])
        && (!model || OFFICIAL_VIDEO_MODELS.has(model));
    }

    case "query_video_generation":
      return !hasAny(input, ["poll_until_done", "poll_interval_seconds", "max_wait_seconds"]);

    case "music_generation":
      return Boolean(getString(input.lyrics))
        && !hasAny(input, [
          "model",
          "lyrics_optimizer",
          "is_instrumental",
          "audio_url",
          "audio_base64",
          "cover_feature_id",
          "output_format",
        ]);

    default:
      return false;
  }
}

function normalizeOfficialArgs(name: OfficialToolName, args: unknown): Record<string, unknown> {
  const input = asRecord(args);
  switch (name) {
    case "text_to_audio":
      return normalizeTextToAudioArgs(input);
    case "list_voices":
      return normalizeListVoicesArgs(input);
    case "voice_clone":
      return normalizeVoiceCloneArgs(input);
    case "text_to_image":
      return normalizeTextToImageArgs(input);
    case "generate_video":
    case "image_to_video":
      return normalizeVideoArgs(input);
    case "query_video_generation":
      return normalizeQueryVideoArgs(input);
    case "music_generation":
      return normalizeMusicArgs(input);
  }
}

export class OfficialMiniMaxProxy {
  private client?: Client;
  private transport?: StdioClientTransport;
  private connecting?: Promise<Client>;

  constructor(private readonly config: Config) {}

  private apiKey(): string {
    return this.config.apiKey || this.config.tokenPlanApiKey;
  }

  canHandle(name: string, args: unknown): name is OfficialToolName {
    if (!this.config.enableOfficialMcpProxy || !this.apiKey()) return false;
    return canUseOfficialTool(name, asRecord(args));
  }

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

  private async connect(): Promise<Client> {
    if (!this.config.enableOfficialMcpProxy) {
      throw new UserInputError("Official MiniMax MCP proxy is disabled. Set MINIMAX_ENABLE_OFFICIAL_MCP_PROXY=true to enable it.");
    }
    const apiKey = this.apiKey();
    if (!apiKey) {
      throw new UserInputError("Missing MINIMAX_API_KEY or MINIMAX_PLAN_API_KEY for the official MiniMax MCP proxy.");
    }
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === "string") env[key] = value;
      }
      env.MINIMAX_API_KEY = apiKey;
      env.MINIMAX_API_HOST = this.config.apiHost;
      env.MINIMAX_MCP_BASE_PATH = this.config.basePath;
      env.MINIMAX_RESOURCE_MODE = this.config.resourceMode;

      const transport = new StdioClientTransport({
        command: this.config.officialMcpCommand,
        args: this.config.officialMcpArgs,
        env,
      });
      const client = new Client({
        name: "minimax-bridge-official-proxy",
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

  async callTool(name: OfficialToolName, args: unknown): Promise<CallToolResult> {
    const toolArgs = normalizeOfficialArgs(name, args);

    try {
      const client = await this.connect();
      const result = await client.callTool({
        name,
        arguments: toolArgs,
      }, undefined, { timeout: this.config.officialMcpTimeoutMs });
      return result as CallToolResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/not connected|disconnected|closed|transport/i.test(message)) throw error;

      await this.reset();
      const client = await this.connect();
      const result = await client.callTool({
        name,
        arguments: toolArgs,
      }, undefined, { timeout: this.config.officialMcpTimeoutMs });
      return result as CallToolResult;
    }
  }

  async close(): Promise<void> {
    await this.reset();
  }
}
