import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildOpenCodeMcpEntry } from "./opencode.js";

export type ProbeMode = "startup" | "api";

export interface ProbeResult {
  ok: boolean;
  mode: ProbeMode;
  command: string[];
  tools: string[];
  voiceProbe?: unknown;
  apiProbe?: unknown;
}

function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function parseTextContent(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("content" in result)) return result;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return result;
  const text = content
    .filter((item): item is { type: "text"; text: string } => {
      return Boolean(item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item);
    })
    .map((item) => item.text)
    .join("\n")
    .trim();
  if (!text) return result;
  try {
    return redactSensitive(JSON.parse(text));
  } catch {
    return text;
  }
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(api[_-]?key|authorization|secret|token)$/i.test(key) || /^(api[_-]?key|authorization|secret|token)$/i.test(key)) {
      out[key] = item ? "[redacted]" : item;
      continue;
    }
    out[key] = redactSensitive(item);
  }
  return out;
}

function probeFailed(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    "ok" in value &&
    (value as { ok?: unknown }).ok === false
  );
}

async function closeQuietly(client: Client | undefined, transport: StdioClientTransport | undefined): Promise<void> {
  await client?.close().catch(() => undefined);
  await transport?.close().catch(() => undefined);
}

export async function probeBundledMcp(mode: ProbeMode): Promise<ProbeResult> {
  const entry = buildOpenCodeMcpEntry("minimax-bridge", "default", true);
  const [command, ...args] = entry.command;
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;

  try {
    client = new Client({ name: "mcp-harness-probe", version: "0.1.0" }, { capabilities: {} });
    transport = new StdioClientTransport({
      command,
      args,
      env: {
        ...inheritedEnv(),
        ...(entry.environment || {}),
      },
      stderr: "pipe",
    });

    await client.connect(transport);
    const listed = await client.listTools(undefined, { timeout: 15000 });
    const tools = listed.tools.map((tool) => tool.name).sort();
    if (!tools.includes("list_voices")) {
      throw new Error("MCP started, but list_voices was not registered.");
    }

    const voiceProbe = parseTextContent(await client.callTool({
      name: "list_voices",
      arguments: { voice_type: "system", query: "female-shaonv", limit: 1 },
    }, undefined, { timeout: 15000 }));

    const result: ProbeResult = {
      ok: !probeFailed(voiceProbe),
      mode,
      command: entry.command,
      tools,
      voiceProbe,
    };

    if (mode === "api") {
      const apiProbe = parseTextContent(await client.callTool({
        name: "text_to_audio",
        arguments: {
          text: "MiniMax MCP test.",
          voice_id: "female-shaonv",
          async_mode: true,
          transport: "async",
        },
      }, undefined, { timeout: 30000 }));
      result.apiProbe = apiProbe;
      if (probeFailed(apiProbe)) result.ok = false;
    }

    return result;
  } finally {
    await closeQuietly(client, transport);
  }
}
