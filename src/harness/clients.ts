import fs from "node:fs/promises";
import path from "node:path";
import type { HarnessId } from "./catalog.js";
import { applyOpenCodeConfig, previewOpenCodeConfig } from "./opencode.js";
import {
  appDataDir,
  commandForBundledMcp,
  defaultClaudeCodeConfigPath,
  defaultCodexConfigPath,
  defaultHermesConfigPath,
  defaultOpenCodeConfigPath,
} from "./paths.js";
import { readJsonCFile, writePrettyJson } from "./jsonc.js";
import { appendLog, getEffectiveEnv, markClientBinding } from "./state.js";
import { buildRemoteCcMcpCommand, isRemoteCcConfigured } from "./remoteCc.js";

export type ReadyHarnessId = Extract<HarnessId, "opencode" | "hermes" | "codex" | "claude-code">;

export interface StdioMcpServerEntry {
  type?: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

export interface HarnessConfigPreview {
  harnessId: ReadyHarnessId;
  mcpId: string;
  profileId: string;
  configPath: string;
  entry: unknown;
  instructionPath?: string;
  instructionRef?: string;
  preview: unknown;
}

export interface HarnessConfigApplyResult extends HarnessConfigPreview {
  backupPath?: string;
}

const READY_HARNESSES = new Set<string>(["opencode", "hermes", "codex", "claude-code"]);
const CLIENT_TIMEOUT_MS: Record<string, number> = {
  "minimax-bridge": 120000,
  agnes: 600000,
  "cc-mcp": 1800000,
};

function backupStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function backupIfExists(configPath: string): Promise<string | undefined> {
  try {
    await fs.access(configPath);
    const backupPath = `${configPath}.bak-${backupStamp()}`;
    await fs.copyFile(configPath, backupPath);
    return backupPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function assertReadyHarness(harnessId: string): asserts harnessId is ReadyHarnessId {
  if (!READY_HARNESSES.has(harnessId)) {
    throw new Error(`Unsupported harness adapter: ${harnessId}`);
  }
}

function timeoutSeconds(mcpId: string): number {
  return Math.ceil((CLIENT_TIMEOUT_MS[mcpId] || 120000) / 1000);
}

export async function buildStdioMcpServerEntry(mcpId: string, profileId = "default", enabled = true): Promise<StdioMcpServerEntry> {
  if (mcpId === "cc-mcp") {
    const env = await getEffectiveEnv(mcpId, profileId).catch(() => ({}));
    const remoteCommand = isRemoteCcConfigured(env) ? buildRemoteCcMcpCommand(env, profileId) : undefined;
    if (remoteCommand) {
      const [command, ...args] = remoteCommand;
      return {
        type: "stdio",
        command,
        args,
        env: {},
        enabled,
        timeout: timeoutSeconds(mcpId),
      };
    }
  }

  const [command, ...args] = commandForBundledMcp(mcpId, profileId);
  return {
    type: "stdio",
    command,
    args,
    env: {
      MCP_HARNESS_HOME: appDataDir(),
    },
    enabled,
    timeout: timeoutSeconds(mcpId),
  };
}

function codexConfigPath(configPath?: string): string {
  return path.resolve(configPath || defaultCodexConfigPath());
}

function claudeCodeConfigPath(configPath?: string): string {
  return path.resolve(configPath || defaultClaudeCodeConfigPath());
}

function hermesConfigPath(configPath?: string): string {
  return path.resolve(configPath || defaultHermesConfigPath());
}

function jsonString(value: string): string {
  return JSON.stringify(value);
}

function renderTomlStringArray(values: string[]): string {
  return `[${values.map(jsonString).join(", ")}]`;
}

function renderTomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : jsonString(key);
}

function renderTomlDottedKey(parts: string[]): string {
  return parts.map(renderTomlKey).join(".");
}

function renderCodexServerBlock(mcpId: string, entry: StdioMcpServerEntry): string {
  const serverKey = renderTomlDottedKey(["mcp_servers", mcpId]);
  const timeout = entry.timeout || timeoutSeconds(mcpId);
  const lines = [
    `[${serverKey}]`,
    `command = ${jsonString(entry.command)}`,
    `args = ${renderTomlStringArray(entry.args)}`,
    `enabled = ${entry.enabled === false ? "false" : "true"}`,
    `startup_timeout_sec = ${timeout}`,
    `tool_timeout_sec = ${timeout}`,
    "",
    `[${renderTomlDottedKey(["mcp_servers", mcpId, "env"])}]`,
  ];
  for (const [key, value] of Object.entries(entry.env)) {
    lines.push(`${renderTomlKey(key)} = ${jsonString(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

function splitTomlDottedKey(value: string): string[] | undefined {
  const parts: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (const char of value.trim()) {
    if (quote) {
      current += char;
      if (quote === "\"" && escaped) {
        escaped = false;
        continue;
      }
      if (quote === "\"" && char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === ".") {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (quote) return undefined;
  parts.push(current.trim());
  return parts.filter(Boolean);
}

function decodeTomlKeyPart(value: string): string | undefined {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return undefined;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function tomlHeaderParts(line: string): string[] | undefined {
  const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
  if (!match?.[1]) return undefined;
  const parts = splitTomlDottedKey(match[1]);
  if (!parts?.length) return undefined;
  const decoded = parts.map(decodeTomlKeyPart);
  if (decoded.some((part) => part == null)) return undefined;
  return decoded as string[];
}

function isCodexServerSection(parts: string[], mcpId: string): boolean {
  return parts.length >= 2 && parts[0] === "mcp_servers" && parts[1] === mcpId;
}

function startsTomlHeader(line: string): boolean {
  return /^\s*\[/.test(line);
}

interface TomlSection {
  headerLine: string;
  parts?: string[];
  block: string;
}

function tomlSections(raw: string): TomlSection[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const sections: TomlSection[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    if (!startsTomlHeader(line)) continue;

    const start = index;
    index += 1;
    while (index < lines.length && !startsTomlHeader(lines[index] || "")) {
      index += 1;
    }
    const block = lines.slice(start, index).join("\n").trimEnd();
    sections.push({
      headerLine: line.trim(),
      parts: tomlHeaderParts(line),
      block,
    });
    index -= 1;
  }

  return sections;
}

function removeCodexServerSections(raw: string, mcpId: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const header = tomlHeaderParts(line);
    if (header) {
      skipping = isCodexServerSection(header, mcpId);
      if (skipping) continue;
    } else if (skipping && startsTomlHeader(line)) {
      skipping = false;
    }
    if (!skipping) out.push(line);
  }

  return out.join("\n").trimEnd();
}

function assertCodexProtectedSectionsPreserved(raw: string, next: string, mcpId: string): void {
  for (const section of tomlSections(raw)) {
    if (section.parts && isCodexServerSection(section.parts, mcpId)) continue;
    if (!section.block) continue;
    if (next.includes(section.block)) continue;

    throw new Error(
      `Refusing to write Codex config: unrelated section ${section.headerLine} would be modified while configuring ${mcpId}.`,
    );
  }
}

function parseCodexTopLevelConfig(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (/^\s*\[/.test(line)) break;
    const match = line.match(/^\s*(\w+)\s*=\s*(.+)$/);
    if (match) {
      result[match[1]] = match[2].trim();
    }
  }
  return result;
}

export function mergeCodexConfig(raw: string, mcpId: string, entry: StdioMcpServerEntry): string {
  const withoutServer = removeCodexServerSections(raw, mcpId);
  const block = renderCodexServerBlock(mcpId, entry).trimEnd();
  const next = `${withoutServer ? `${withoutServer}\n\n` : ""}${block}\n`;
  assertCodexProtectedSectionsPreserved(raw, next, mcpId);
  return next;
}

interface ClaudeCodeConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function buildClaudeCodeServer(entry: StdioMcpServerEntry): StdioMcpServerEntry {
  return {
    type: "stdio",
    command: entry.command,
    args: entry.args,
    env: entry.env,
  };
}

function countLeadingSpaces(value: string): number {
  const match = value.match(/^ */);
  return match ? match[0].length : 0;
}

function isMeaningfulYamlLine(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== "" && !trimmed.startsWith("#");
}

function yamlKeyPattern(key: string): RegExp {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\s*:\\s*(?:#.*)?$`);
}

function renderYamlStringArray(values: string[], indent: string): string[] {
  if (!values.length) return [`${indent}[]`];
  return values.map((value) => `${indent}- ${jsonString(value)}`);
}

function renderHermesServerBlock(mcpId: string, entry: StdioMcpServerEntry, indent = ""): string[] {
  const serverIndent = `${indent}  `;
  const valueIndent = `${serverIndent}  `;
  const lines = [
    `${serverIndent}${mcpId}:`,
    `${valueIndent}command: ${jsonString(entry.command)}`,
    `${valueIndent}args:`,
    ...renderYamlStringArray(entry.args, `${valueIndent}  `),
    `${valueIndent}env:`,
  ];
  for (const [key, value] of Object.entries(entry.env)) {
    lines.push(`${valueIndent}  ${key}: ${jsonString(value)}`);
  }
  lines.push(`${valueIndent}enabled: ${entry.enabled === false ? "false" : "true"}`);
  lines.push(`${valueIndent}timeout: ${entry.timeout || timeoutSeconds(mcpId)}`);
  return lines;
}

function findTopLevelYamlSection(lines: string[], key: string): { index: number; indent: number } | undefined {
  const pattern = yamlKeyPattern(key);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    if (!isMeaningfulYamlLine(line)) continue;
    const indent = countLeadingSpaces(line);
    if (pattern.test(line.slice(indent))) return { index, indent };
  }
  return undefined;
}

function findYamlSectionEnd(lines: string[], startIndex: number, indent: number): number {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] || "";
    if (!isMeaningfulYamlLine(line)) continue;
    if (countLeadingSpaces(line) <= indent) return index;
  }
  return lines.length;
}

function findNestedYamlKey(lines: string[], startIndex: number, endIndex: number, indent: number, key: string): number | undefined {
  const pattern = yamlKeyPattern(key);
  const nestedIndent = indent + 2;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const line = lines[index] || "";
    if (!isMeaningfulYamlLine(line)) continue;
    if (countLeadingSpaces(line) !== nestedIndent) continue;
    if (pattern.test(line.slice(nestedIndent))) return index;
  }
  return undefined;
}

function mergeHermesConfig(raw: string, mcpId: string, entry: StdioMcpServerEntry): string {
  const normalized = raw.replace(/\r\n/g, "\n").trimEnd();
  const lines = normalized ? normalized.split("\n") : [];
  const section = findTopLevelYamlSection(lines, "mcp_servers");
  const block = renderHermesServerBlock(mcpId, entry, section ? " ".repeat(section.indent) : "");

  if (!section) {
    return `${normalized ? `${normalized}\n\n` : ""}mcp_servers:\n${block.join("\n")}\n`;
  }

  const sectionEnd = findYamlSectionEnd(lines, section.index, section.indent);
  const serverIndex = findNestedYamlKey(lines, section.index, sectionEnd, section.indent, mcpId);
  if (serverIndex == null) {
    lines.splice(sectionEnd, 0, ...block);
    return `${lines.join("\n").trimEnd()}\n`;
  }

  const serverIndent = countLeadingSpaces(lines[serverIndex] || "");
  let serverEnd = sectionEnd;
  for (let index = serverIndex + 1; index < sectionEnd; index += 1) {
    const line = lines[index] || "";
    if (!isMeaningfulYamlLine(line)) continue;
    if (countLeadingSpaces(line) <= serverIndent) {
      serverEnd = index;
      break;
    }
  }
  lines.splice(serverIndex, serverEnd - serverIndex, ...block);
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function previewHarnessConfig(options: {
  harnessId: HarnessId;
  mcpId: string;
  profileId?: string;
  enabled?: boolean;
  configPath?: string;
}): Promise<HarnessConfigPreview> {
  assertReadyHarness(options.harnessId);
  const profileId = options.profileId || "default";

  if (options.harnessId === "opencode") {
    const preview = await previewOpenCodeConfig({
      mcpId: options.mcpId,
      profileId,
      enabled: options.enabled,
      configPath: options.configPath,
    });
    return {
      harnessId: "opencode",
      mcpId: options.mcpId,
      profileId,
      configPath: preview.configPath,
      entry: preview.entry,
      instructionPath: preview.instructionPath,
      instructionRef: preview.instructionRef,
      preview: {
        path: preview.configPath,
        instructions: [preview.instructionRef],
        mcp: {
          [options.mcpId]: preview.entry,
        },
      },
    };
  }

  const entry = await buildStdioMcpServerEntry(options.mcpId, profileId, options.enabled ?? true);
  if (options.harnessId === "codex") {
    const configPath = codexConfigPath(options.configPath);
    const raw = await readTextIfExists(configPath);
    const topLevel = parseCodexTopLevelConfig(raw);
    return {
      harnessId: "codex",
      mcpId: options.mcpId,
      profileId,
      configPath,
      entry,
      preview: {
        hasCodexConfig: Object.keys(topLevel).length > 0,
        existingModel: topLevel.model || undefined,
        existingProvider: topLevel.model_provider || undefined,
        existingReasoningEffort: topLevel.model_reasoning_effort || undefined,
        mcpTestPassed: true,
        mergedToml: mergeCodexConfig(raw, options.mcpId, entry),
      },
    };
  }

  if (options.harnessId === "claude-code") {
    const configPath = claudeCodeConfigPath(options.configPath);
    const claudeEntry = buildClaudeCodeServer(entry);
    return {
      harnessId: "claude-code",
      mcpId: options.mcpId,
      profileId,
      configPath,
      entry: claudeEntry,
      preview: {
        path: configPath,
        mcpServers: {
          [options.mcpId]: claudeEntry,
        },
      },
    };
  }

  const configPath = hermesConfigPath(options.configPath);
  return {
    harnessId: "hermes",
    mcpId: options.mcpId,
    profileId,
    configPath,
    entry,
    preview: mergeHermesConfig("", options.mcpId, entry),
  };
}

export async function applyHarnessConfig(options: {
  harnessId: HarnessId;
  mcpId: string;
  profileId?: string;
  enabled?: boolean;
  configPath?: string;
}): Promise<HarnessConfigApplyResult> {
  assertReadyHarness(options.harnessId);
  const profileId = options.profileId || "default";
  const enabled = options.enabled ?? true;

  if (options.harnessId === "opencode") {
    const result = await applyOpenCodeConfig({
      mcpId: options.mcpId,
      profileId,
      enabled,
      configPath: options.configPath,
    });
    return {
      harnessId: "opencode",
      mcpId: options.mcpId,
      profileId,
      configPath: result.configPath,
      backupPath: result.backupPath,
      entry: result.entry,
      instructionPath: result.instructionPath,
      instructionRef: result.instructionRef,
      preview: {
        path: result.configPath,
        instructions: [result.instructionRef],
        mcp: {
          [options.mcpId]: result.entry,
        },
      },
    };
  }

  const entry = await buildStdioMcpServerEntry(options.mcpId, profileId, enabled);
  let configPath: string;
  let preview: unknown;
  let writtenEntry: unknown = entry;

  if (options.harnessId === "codex") {
    configPath = codexConfigPath(options.configPath);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const backupPath = await backupIfExists(configPath);
    const raw = await readTextIfExists(configPath);
    const next = mergeCodexConfig(raw, options.mcpId, entry);
    await fs.writeFile(configPath, next, "utf8");
    preview = next;
    await markClientBinding({ harnessId: "codex", mcpId: options.mcpId, profileId, enabled, configPath, lastAppliedAt: new Date().toISOString() });
    await appendLog(`Applied ${options.mcpId}/${profileId} to Codex config ${configPath}`);
    return { harnessId: "codex", mcpId: options.mcpId, profileId, configPath, backupPath, entry, preview };
  }

  if (options.harnessId === "claude-code") {
    configPath = claudeCodeConfigPath(options.configPath);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const backupPath = await backupIfExists(configPath);
    const existing = await readJsonCFile<ClaudeCodeConfig>(configPath, {});
    if (!existing.mcpServers || typeof existing.mcpServers !== "object" || Array.isArray(existing.mcpServers)) {
      existing.mcpServers = {};
    }
    writtenEntry = buildClaudeCodeServer(entry);
    existing.mcpServers[options.mcpId] = writtenEntry;
    await writePrettyJson(configPath, existing);
    preview = {
      path: configPath,
      mcpServers: {
        [options.mcpId]: writtenEntry,
      },
    };
    await markClientBinding({ harnessId: "claude-code", mcpId: options.mcpId, profileId, enabled, configPath, lastAppliedAt: new Date().toISOString() });
    await appendLog(`Applied ${options.mcpId}/${profileId} to Claude Code config ${configPath}`);
    return { harnessId: "claude-code", mcpId: options.mcpId, profileId, configPath, backupPath, entry: writtenEntry, preview };
  }

  configPath = hermesConfigPath(options.configPath);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const backupPath = await backupIfExists(configPath);
  let raw = "";
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const next = mergeHermesConfig(raw, options.mcpId, entry);
  await fs.writeFile(configPath, next, "utf8");
  preview = next;
  await markClientBinding({ harnessId: "hermes", mcpId: options.mcpId, profileId, enabled, configPath, lastAppliedAt: new Date().toISOString() });
  await appendLog(`Applied ${options.mcpId}/${profileId} to Hermes config ${configPath}`);
  return { harnessId: "hermes", mcpId: options.mcpId, profileId, configPath, backupPath, entry, preview };
}

export function defaultConfigPathForHarness(harnessId: HarnessId): string | null {
  if (harnessId === "opencode") return defaultOpenCodeConfigPath();
  if (harnessId === "codex") return defaultCodexConfigPath();
  if (harnessId === "claude-code") return defaultClaudeCodeConfigPath();
  if (harnessId === "hermes") return defaultHermesConfigPath();
  return null;
}
