import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { appDataDir, commandForBundledMcp } from "./harness/paths.js";

export interface CcDelegateResult {
  ok: boolean;
  sessionId: string;
  status: "completed" | "failed" | "timeout" | "missing_claude" | "invalid_request";
  exitCode: number | null;
  durationMs: number;
  resultText: string;
  callbacks: CcCallbackMessage[];
  rawClaudeOutput?: unknown;
  stderrTail?: string;
  error?: string;
}

export interface CcStatusResult {
  ok: boolean;
  available: boolean;
  command: string;
  version?: string;
  error?: string;
}

export interface CcCallbackMessage {
  sessionId: string;
  type: string;
  message: string;
  metadata?: unknown;
  timestamp: string;
}

interface CcConfig {
  runtime: "local" | "wsl";
  command: string;
  commandArgs: string[];
  model?: string;
  maxTurns: number;
  timeoutMs: number;
  workdir?: string;
  skipPermissions: boolean;
  strictMcpConfig: boolean;
  wsl: boolean;
}

interface DelegateArgs {
  workspace: string;
  mode: "implement" | "debug" | "refactor" | "test" | "review" | "inspect";
  task: string;
  context?: unknown;
  targetFiles: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  allowedCommands: string[];
  forbiddenActions: string[];
  returnFormat: string;
  timeout_ms?: number;
  max_turns?: number;
  model?: string;
}

interface SessionTask {
  sessionId: string;
  workspace: string;
  mode: DelegateArgs["mode"];
  task: string;
  context?: unknown;
  targetFiles: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  allowedCommands: string[];
  forbiddenActions: string[];
  returnFormat: string;
  cwd: string;
  createdAt: string;
}

interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: NodeJS.ErrnoException | Error;
}

const CALLBACK_FILE = "callbacks.jsonl";
const TASK_FILE = "task.json";
const MCP_CONFIG_FILE = "mcp-config.json";
const CALLBACK_SERVER_NAME = "openredou_callback";
const CALLBACK_SEND_TOOL = `mcp__${CALLBACK_SERVER_NAME}__send_message_to_openredou`;
const CALLBACK_READ_TOOL = `mcp__${CALLBACK_SERVER_NAME}__read_openredou_task`;
const MAX_CAPTURE_CHARS = 1024 * 1024 * 2;
const MAX_TAIL_CHARS = 8000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function parseArgsEnv(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    // Fall back to simple whitespace splitting for concise local overrides.
  }
  return raw.split(/\s+/g).filter(Boolean);
}

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadCcConfig(): CcConfig {
  const runtime = process.env.CC_CLAUDE_RUNTIME?.trim().toLowerCase() === "wsl" ? "wsl" : "local";
  const command = process.env.CC_CLAUDE_COMMAND?.trim() || (runtime === "wsl" ? "wsl.exe" : "claude");
  const commandName = path.basename(command).toLowerCase();
  return {
    runtime,
    command,
    commandArgs: parseArgsEnv("CC_CLAUDE_COMMAND_ARGS"),
    model: process.env.CC_CLAUDE_MODEL?.trim() || undefined,
    maxTurns: Math.max(1, Math.floor(numberFromEnv("CC_CLAUDE_MAX_TURNS", 20))),
    timeoutMs: Math.max(1000, Math.floor(numberFromEnv("CC_CLAUDE_TIMEOUT_MS", 1_800_000))),
    workdir: process.env.CC_CLAUDE_WORKDIR?.trim() || undefined,
    skipPermissions: boolFromEnv("CC_CLAUDE_SKIP_PERMISSIONS", true),
    strictMcpConfig: boolFromEnv("CC_CLAUDE_STRICT_MCP_CONFIG", true),
    wsl: boolFromEnv("CC_CLAUDE_WSL", runtime === "wsl" || commandName === "wsl.exe" || commandName === "wsl"),
  };
}

function sessionsBaseDir(): string {
  return path.join(appDataDir(), "cc-mcp", "sessions");
}

function makeSessionId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
}

function clipAppend(existing: string, chunk: Buffer): string {
  const combined = existing + chunk.toString("utf8");
  return combined.length > MAX_CAPTURE_CHARS ? combined.slice(combined.length - MAX_CAPTURE_CHARS) : combined;
}

function tail(value: string, max = MAX_TAIL_CHARS): string | undefined {
  if (!value.trim()) return undefined;
  return value.length > max ? value.slice(value.length - max) : value;
}

async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function resolveWorkdir(requested?: string): Promise<{ ok: true; cwd: string } | { ok: false; error: string }> {
  const raw = requested || loadCcConfig().workdir || process.cwd();
  const cwd = path.resolve(raw);
  try {
    const stat = await fs.stat(cwd);
    if (!stat.isDirectory()) return { ok: false, error: `Claude Code cwd is not a directory: ${cwd}` };
    return { ok: true, cwd };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Claude Code cwd is not accessible: ${cwd}. ${message}` };
  }
}

function toWslPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const match = /^([a-zA-Z]):[\\/](.*)$/.exec(resolved);
  if (!match) return resolved.replace(/\\/g, "/");
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, "/");
  return `/mnt/${drive}/${rest}`;
}

function commandForCallbackMcp(profileId: string, wsl: boolean): string[] {
  const command = commandForBundledMcp("cc-mcp-callback", profileId);
  if (!wsl) return command;
  return command.map((part, index) => {
    if (index === 0) return part;
    if (/^[a-zA-Z]:[\\/]/.test(part)) return toWslPath(part);
    return part;
  });
}

function delegateArgs(value: unknown): DelegateArgs {
  const record = asRecord(value);
  const task = stringValue(record.task) || stringValue(record.instruction);
  if (!task) throw new Error("delegate_coding_task requires a non-empty task.");
  const workspace = stringValue(record.workspace) || stringValue(record.cwd);
  if (!workspace) throw new Error("delegate_coding_task requires a workspace.");
  const rawMode = stringValue(record.mode) || "implement";
  const mode = ["implement", "debug", "refactor", "test", "review", "inspect"].includes(rawMode)
    ? rawMode as DelegateArgs["mode"]
    : "implement";
  const acceptanceCriteria = stringArrayValue(record.acceptance_criteria);
  if (!acceptanceCriteria.length && !record.instruction) {
    throw new Error("delegate_coding_task requires at least one acceptance_criteria item.");
  }
  return {
    workspace,
    mode,
    task,
    context: record.context,
    targetFiles: stringArrayValue(record.target_files),
    constraints: stringArrayValue(record.constraints),
    acceptanceCriteria,
    allowedCommands: stringArrayValue(record.allowed_commands),
    forbiddenActions: stringArrayValue(record.forbidden_actions),
    returnFormat: stringValue(record.return_format) || "structured_report",
    timeout_ms: numberValue(record.timeout_ms),
    max_turns: numberValue(record.max_turns),
    model: stringValue(record.model),
  };
}

function promptForTask(task: SessionTask): string {
  const contextText = task.context === undefined
    ? "No extra context was provided."
    : typeof task.context === "string"
      ? task.context
      : JSON.stringify(task.context, null, 2);

  const lines = [
    "You are Claude Code, running as a local coding execution worker for OpenRedou through cc-mcp.",
    "OpenRedou/OpenCode is the orchestrator: it owns planning, task decomposition, user communication, and final verification.",
    "You are the delegated executor: perform only the concrete coding subtask described below inside the specified workspace.",
    "",
    `Use the temporary MCP callback tool ${CALLBACK_SEND_TOOL} when you have meaningful progress, errors, or final status to report.`,
    `Call ${CALLBACK_SEND_TOOL} with type "progress" for progress updates and type "final" when the task is complete.`,
    `You may call ${CALLBACK_READ_TOOL} if you need to re-read the original delegation payload.`,
    "",
    `Session ID: ${task.sessionId}`,
    `Working directory: ${task.cwd}`,
    `Mode: ${task.mode}`,
    "",
    "Delegated coding task:",
    task.task,
    "",
    "Extra context:",
    contextText,
    "",
  ];

  if (task.targetFiles.length) lines.push("Target files or modules:", ...task.targetFiles.map((item) => `- ${item}`), "");
  if (task.constraints.length) lines.push("Constraints:", ...task.constraints.map((item) => `- ${item}`), "");
  if (task.acceptanceCriteria.length) lines.push("Acceptance criteria:", ...task.acceptanceCriteria.map((item) => `- ${item}`), "");
  if (task.allowedCommands.length) lines.push("Allowed commands:", ...task.allowedCommands.map((item) => `- ${item}`), "");
  if (task.forbiddenActions.length) lines.push("Forbidden actions:", ...task.forbiddenActions.map((item) => `- ${item}`), "");

  lines.push(
    "Execution rules:",
    "- Preserve existing project style and APIs.",
    "- Avoid unrelated changes.",
    "- Respect the forbidden actions and safety constraints.",
    "- Run relevant checks when allowed and practical.",
    "- Do not ask the user questions; report blockers in the structured result.",
    "",
    "Return a structured execution report with:",
    "- summary",
    "- modified_files",
    "- commands_run",
    "- test_results",
    "- acceptance_criteria_status",
    "- unresolved_issues",
    "- follow_up_recommendations",
  );

  return lines.join("\n");
}

async function writeCallbackMcpConfig(sessionDir: string, sessionId: string, profileId: string, wsl: boolean): Promise<string> {
  const callbackCommand = commandForCallbackMcp(profileId, wsl);
  const configPath = path.join(sessionDir, MCP_CONFIG_FILE);
  const config = {
    mcpServers: {
      [CALLBACK_SERVER_NAME]: {
        type: "stdio",
        command: callbackCommand[0],
        args: callbackCommand.slice(1),
        env: {
          MCP_HARNESS_HOME: wsl ? toWslPath(appDataDir()) : appDataDir(),
          CC_MCP_PROFILE_ID: profileId,
          CC_MCP_SESSION_ID: sessionId,
          CC_MCP_SESSION_DIR: wsl ? toWslPath(sessionDir) : sessionDir,
          CC_MCP_SESSIONS_DIR: wsl ? toWslPath(sessionsBaseDir()) : sessionsBaseDir(),
        },
      },
    },
  };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return configPath;
}

function buildClaudeArgs(config: CcConfig, args: DelegateArgs, mcpConfigPath: string, prompt: string): string[] {
  const out = [
    ...config.commandArgs,
    "-p",
    "--output-format",
    "json",
    "--mcp-config",
    config.wsl ? toWslPath(mcpConfigPath) : mcpConfigPath,
  ];
  if (config.strictMcpConfig) out.push("--strict-mcp-config");
  if (config.skipPermissions) out.push("--dangerously-skip-permissions");
  out.push("--allowedTools", `${CALLBACK_SEND_TOOL},${CALLBACK_READ_TOOL}`);
  const maxTurns = Math.max(1, Math.floor(args.max_turns || config.maxTurns));
  if (maxTurns > 0) out.push("--max-turns", String(maxTurns));
  const model = args.model || config.model;
  if (model) out.push("--model", model);
  out.push(prompt);
  return out;
}

async function spawnAndCapture(command: string, args: string[], cwd: string, timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, MCP_HARNESS_HOME: appDataDir() },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 3000).unref();
    }, timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = clipAppend(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = clipAppend(stderr, chunk);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr, timedOut, error });
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

function parseClaudeOutput(stdout: string): { resultText: string; rawClaudeOutput?: unknown } {
  const trimmed = stdout.trim();
  if (!trimmed) return { resultText: "" };

  try {
    const parsed = JSON.parse(trimmed);
    const record = asRecord(parsed);
    const result = stringValue(record.result) || stringValue(record.text) || stringValue(record.response);
    if (result) return { resultText: result, rawClaudeOutput: parsed };

    const content = record.content;
    if (Array.isArray(content)) {
      const text = content
        .map((item) => stringValue(asRecord(item).text))
        .filter(Boolean)
        .join("\n")
        .trim();
      if (text) return { resultText: text, rawClaudeOutput: parsed };
    }

    const messageContent = asRecord(record.message).content;
    if (Array.isArray(messageContent)) {
      const text = messageContent
        .map((item) => stringValue(asRecord(item).text))
        .filter(Boolean)
        .join("\n")
        .trim();
      if (text) return { resultText: text, rawClaudeOutput: parsed };
    }

    return { resultText: JSON.stringify(parsed, null, 2), rawClaudeOutput: parsed };
  } catch {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    const lastJsonLine = [...lines].reverse().find((line) => line.trim().startsWith("{"));
    if (lastJsonLine) {
      try {
        return parseClaudeOutput(lastJsonLine);
      } catch {
        // Fall through to raw stdout.
      }
    }
    return { resultText: trimmed, rawClaudeOutput: trimmed };
  }
}

async function readCallbacks(sessionDir: string): Promise<CcCallbackMessage[]> {
  try {
    const text = await fs.readFile(path.join(sessionDir, CALLBACK_FILE), "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CcCallbackMessage);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function delegateToClaudeCode(rawArgs: unknown, profileId = "default"): Promise<CcDelegateResult> {
  const start = Date.now();
  const args = delegateArgs(rawArgs);
  const workdir = await resolveWorkdir(args.workspace);
  const sessionId = makeSessionId();
  const sessionDir = path.join(sessionsBaseDir(), sessionId);
  await ensureDirectory(sessionDir);

  if (!workdir.ok) {
    return {
      ok: false,
      sessionId,
      status: "invalid_request",
      exitCode: null,
      durationMs: Date.now() - start,
      resultText: "",
      callbacks: [],
      error: workdir.error,
    };
  }

  const task: SessionTask = {
    sessionId,
    workspace: args.workspace,
    mode: args.mode,
    task: args.task,
    context: args.context,
    targetFiles: args.targetFiles,
    constraints: args.constraints,
    acceptanceCriteria: args.acceptanceCriteria,
    allowedCommands: args.allowedCommands,
    forbiddenActions: args.forbiddenActions,
    returnFormat: args.returnFormat,
    cwd: workdir.cwd,
    createdAt: new Date(start).toISOString(),
  };
  await fs.writeFile(path.join(sessionDir, TASK_FILE), JSON.stringify(task, null, 2) + "\n", "utf8");
  const config = loadCcConfig();
  const mcpConfigPath = await writeCallbackMcpConfig(sessionDir, sessionId, profileId, config.wsl);
  const timeoutMs = Math.max(1000, Math.floor(args.timeout_ms || config.timeoutMs));
  const claudeArgs = buildClaudeArgs(config, args, mcpConfigPath, promptForTask(task));
  const spawned = await spawnAndCapture(config.command, claudeArgs, workdir.cwd, timeoutMs);
  const callbacks = await readCallbacks(sessionDir);
  const parsed = parseClaudeOutput(spawned.stdout);
  const missingClaude = (spawned.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  const status = missingClaude
    ? "missing_claude"
    : spawned.timedOut
      ? "timeout"
      : spawned.exitCode === 0
        ? "completed"
        : "failed";

  return {
    ok: status === "completed",
    sessionId,
    status,
    exitCode: spawned.exitCode,
    durationMs: Date.now() - start,
    resultText: parsed.resultText,
    callbacks,
    rawClaudeOutput: parsed.rawClaudeOutput,
    stderrTail: tail(spawned.stderr),
    error: spawned.error ? (spawned.error instanceof Error ? spawned.error.message : String(spawned.error)) : undefined,
  };
}

export async function claudeCodeStatus(): Promise<CcStatusResult> {
  const config = loadCcConfig();
  const result = await spawnAndCapture(config.command, [...config.commandArgs, "--version"], process.cwd(), 5000);
  const missing = (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  if (missing) {
    return {
      ok: false,
      available: false,
      command: config.command,
      error: `Claude Code command not found: ${config.command}`,
    };
  }
  if (result.error || result.exitCode !== 0) {
    return {
      ok: false,
      available: false,
      command: config.command,
      error: result.error instanceof Error ? result.error.message : tail(result.stderr) || `Claude Code exited with ${result.exitCode}`,
    };
  }
  return {
    ok: true,
    available: true,
    command: config.command,
    version: (result.stdout || result.stderr).trim(),
  };
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_.-]/g, "");
}

function callbackSessionDir(sessionId?: string): string {
  const envSessionId = process.env.CC_MCP_SESSION_ID;
  const envSessionDir = process.env.CC_MCP_SESSION_DIR;
  if (envSessionDir && (!sessionId || sessionId === envSessionId)) return envSessionDir;
  const requested = sessionId || envSessionId;
  if (!requested) throw new Error("No active cc-mcp session id is available.");
  const base = process.env.CC_MCP_SESSIONS_DIR || sessionsBaseDir();
  return path.join(base, sanitizeSessionId(requested));
}

export async function sendMessageToOpenRedou(rawArgs: unknown): Promise<CcCallbackMessage> {
  const record = asRecord(rawArgs);
  const sessionId = stringValue(record.session_id) || process.env.CC_MCP_SESSION_ID || "";
  if (!sessionId) throw new Error("send_message_to_openredou requires a session_id or active callback session.");
  const type = stringValue(record.type) || "progress";
  const message = stringValue(record.message);
  if (!message) throw new Error("send_message_to_openredou requires a non-empty message.");
  const item: CcCallbackMessage = {
    sessionId,
    type,
    message,
    metadata: record.metadata,
    timestamp: new Date().toISOString(),
  };
  const dir = callbackSessionDir(sessionId);
  await ensureDirectory(dir);
  await fs.appendFile(path.join(dir, CALLBACK_FILE), JSON.stringify(item) + "\n", "utf8");
  return item;
}

export async function readOpenRedouTask(rawArgs: unknown): Promise<SessionTask> {
  const sessionId = stringValue(asRecord(rawArgs).session_id) || process.env.CC_MCP_SESSION_ID;
  const dir = callbackSessionDir(sessionId);
  const text = await fs.readFile(path.join(dir, TASK_FILE), "utf8");
  return JSON.parse(text) as SessionTask;
}
