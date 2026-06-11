import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "./config.js";
import { UserInputError } from "./errors.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
    output_file: "outputFile",
    voice_id: "voiceId",
    sample_rate: "sampleRate",
    language_boost: "languageBoost",
    subtitle_enable: "subtitleEnable",
  });
  delete output.poll_interval_seconds;
  delete output.max_wait_seconds;
  delete output.transport;
  return output;
}

function normalizeListVoicesArgs(input: Record<string, unknown>): Record<string, unknown> {
  return mapKeys(input, { voice_type: "voiceType" });
}

function normalizePlayAudioArgs(input: Record<string, unknown>): Record<string, unknown> {
  return mapKeys(input, {
    input_file_path: "inputFilePath",
    input_file: "inputFilePath",
    file: "inputFilePath",
    is_url: "isUrl",
  });
}

function normalizeVoiceCloneArgs(input: Record<string, unknown>): Record<string, unknown> {
  return mapKeys(input, {
    voice_id: "voiceId",
    file: "audioFile",
    audio_file: "audioFile",
    output_directory: "outputDirectory",
    output_file: "outputFile",
    is_url: "isUrl",
  });
}

function normalizeTextToImageArgs(input: Record<string, unknown>): Record<string, unknown> {
  return mapKeys(input, {
    aspect_ratio: "aspectRatio",
    prompt_optimizer: "promptOptimizer",
    subject_reference: "subjectReference",
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
    output_file: "outputFile",
  });
}

function normalizeMusicArgs(input: Record<string, unknown>): Record<string, unknown> {
  return mapKeys(input, {
    sample_rate: "sampleRate",
    output_directory: "outputDirectory",
    output_file: "outputFile",
  });
}

function normalizeVoiceDesignArgs(input: Record<string, unknown>): Record<string, unknown> {
  return mapKeys(input, {
    preview_text: "previewText",
    voice_id: "voiceId",
    output_directory: "outputDirectory",
    output_file: "outputFile",
  });
}

function normalizeCommonArgs(input: Record<string, unknown>): Record<string, unknown> {
  return mapKeys(input, {
    output_directory: "outputDirectory",
    output_file: "outputFile",
  });
}

function normalizeOfficialArgs(name: string, args: unknown): Record<string, unknown> {
  const input = asRecord(args);
  switch (name) {
    case "text_to_audio":
      return normalizeTextToAudioArgs(input);
    case "list_voices":
      return normalizeListVoicesArgs(input);
    case "play_audio":
      return normalizePlayAudioArgs(input);
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
    case "voice_design":
      return normalizeVoiceDesignArgs(input);
    default:
      return normalizeCommonArgs(input);
  }
}

export class OfficialMiniMaxProxy {
  private client?: Client;
  private transport?: StdioClientTransport;
  private connecting?: Promise<Client>;
  private toolsCache?: Tool[];

  constructor(private readonly config: Config) {}

  get enabled(): boolean {
    return this.config.enableOfficialMcpProxy;
  }

  hasCredentials(): boolean {
    return Boolean(this.apiKey());
  }

  private apiKey(): string {
    return this.config.apiKey || this.config.tokenPlanApiKey;
  }

  private async reset(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = undefined;
    this.transport = undefined;
    this.connecting = undefined;
    this.toolsCache = undefined;

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
        version: "0.2.0",
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

  private async withReconnect<T>(action: (client: Client) => Promise<T>): Promise<T> {
    try {
      return await action(await this.connect());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/not connected|disconnected|closed|transport/i.test(message)) throw error;

      await this.reset();
      return action(await this.connect());
    }
  }

  async listTools(): Promise<Tool[]> {
    if (this.toolsCache) return this.toolsCache;
    const listed = await this.withReconnect((client) => client.listTools(undefined, { timeout: this.config.officialMcpTimeoutMs }));
    this.toolsCache = listed.tools;
    return this.toolsCache;
  }

  async hasTool(name: string): Promise<boolean> {
    if (!this.enabled || !getString(name)) return false;
    return (await this.listTools()).some((tool) => tool.name === name);
  }

  async callTool(name: string, args: unknown): Promise<CallToolResult> {
    const toolArgs = normalizeOfficialArgs(name, args);
    const result = await this.withReconnect((client) => client.callTool({
      name,
      arguments: toolArgs,
    }, undefined, { timeout: this.config.officialMcpTimeoutMs }));
    return result as CallToolResult;
  }

  async close(): Promise<void> {
    await this.reset();
  }
}
