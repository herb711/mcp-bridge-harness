import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { appDataDir, commandForBundledMcp, defaultClaudeCodeWorkdir } from "./harness/paths.js";

export interface CcDelegateResult {
  ok: boolean;
  sessionId: string;
  status: "completed" | "failed" | "timeout" | "missing_claude" | "invalid_request";
  exitCode: number | null;
  durationMs: number;
  resultText: string;
  callbacks: CcCallbackMessage[];
  terminalLog?: CcTerminalLog;
  events?: CcRuntimeEvent[];
  permissionRequests?: CcPermissionRequest[];
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

export interface CcTerminalLog {
  path: string;
  format: "jsonl";
  bytes: number;
  text: string;
  truncated: boolean;
  error?: string;
}

export interface CcRuntimeEvent {
  sessionId: string;
  sequence: number;
  timestamp: string;
  kind: "output" | "process" | "permission";
  stream: "stdout" | "stderr" | "process";
  text: string;
  metadata?: unknown;
}

export interface CcPermissionRequest {
  id: string;
  sessionId: string;
  prompt: string;
  raw: string;
  status: "pending" | "auto_approved" | "approved" | "denied" | "unhandled" | "failed";
  source?: "skip_permissions" | "main_harness_full" | "main_harness_elicitation" | "fallback" | "no_elicitation";
  responseSent?: string;
  reason?: string;
  timestamp: string;
  resolvedAt?: string;
}

export interface CcPermissionDecision {
  approved: boolean;
  source: CcPermissionRequest["source"];
  reason?: string;
  responseText?: string;
}

export interface CcRunHooks {
  onEvent?: (event: CcRuntimeEvent) => void | Promise<void>;
  authorizePermission?: (request: CcPermissionRequest) => Promise<CcPermissionDecision>;
}

interface CcConfig {
  runtime: "local" | "wsl";
  command: string;
  commandArgs: string[];
  model?: string;
  outputFormat: "json" | "stream-json";
  includePartialMessages: boolean;
  maxTurns: number;
  timeoutMs: number;
  workdir?: string;
  skipPermissions: boolean;
  strictMcpConfig: boolean;
  useCallbackMcp: boolean;
  permissionMode: "main-harness" | "auto-approve" | "ask" | "deny";
  permissionApproveInput: string;
  permissionDenyInput: string;
  wsl: boolean;
}

interface DelegateArgs {
  workspace?: string;
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

interface WorkspaceAppendFileArgs {
  workspace?: string;
  path: string;
  transferId?: string;
  chunkBase64: string;
  chunkIndex?: number;
  reset?: boolean;
}

interface WorkspaceFinalizeFileArgs {
  workspace?: string;
  path: string;
  transferId?: string;
  sha256: string;
  mode?: string;
}

interface WorkspaceRunCommandArgs {
  workspace?: string;
  command: string;
  args: string[];
  shell: boolean;
  timeoutMs: number;
  env: Record<string, string>;
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
  terminalLog?: CcTerminalLog;
  events: CcRuntimeEvent[];
  permissionRequests: CcPermissionRequest[];
  error?: NodeJS.ErrnoException | Error;
}

interface PreparedClaudeRun {
  start: number;
  args: DelegateArgs;
  config: CcConfig;
  sessionId: string;
  sessionDir: string;
  task: SessionTask;
  timeoutMs: number;
  claudeArgs: string[];
  terminalLogPath: string;
}

const CALLBACK_FILE = "callbacks.jsonl";
const TASK_FILE = "task.json";
const MCP_CONFIG_FILE = "mcp-config.json";
const TERMINAL_LOG_FILE = "terminal.jsonl";
const CALLBACK_SERVER_NAME = "cc_mcp_callback";
const CALLBACK_SEND_TOOL_NAME = "send_message_to_harness";
const CALLBACK_READ_TOOL_NAME = "read_harness_task";
const CALLBACK_SEND_TOOL = `mcp__${CALLBACK_SERVER_NAME}__${CALLBACK_SEND_TOOL_NAME}`;
const CALLBACK_READ_TOOL = `mcp__${CALLBACK_SERVER_NAME}__${CALLBACK_READ_TOOL_NAME}`;
const MAX_CAPTURE_CHARS = 1024 * 1024 * 2;
const MAX_TAIL_CHARS = 8000;
const MAX_EVENTS = 500;
const MAX_PERMISSION_PROMPT_CHARS = 4000;
const MAX_WORKSPACE_TRANSFER_CHUNK_CHARS = 4096;

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

function booleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.trim()) return /^(1|true|yes|on)$/i.test(value.trim());
  return fallback;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function stringRecordValue(value: unknown): Record<string, string> {
  const record = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") out[key] = item;
    else if (typeof item === "boolean") out[key] = item ? "true" : "false";
    else if (item != null) out[key] = String(item);
  }
  return out;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function permissionModeFromEnv(): CcConfig["permissionMode"] {
  const value = process.env.CC_MCP_PERMISSION_MODE?.trim().toLowerCase();
  if (value === "auto" || value === "auto-approve" || value === "full") return "auto-approve";
  if (value === "ask" || value === "prompt") return "ask";
  if (value === "deny" || value === "reject") return "deny";
  return "main-harness";
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

function outputFormatFromEnv(): CcConfig["outputFormat"] {
  const value = process.env.CC_CLAUDE_OUTPUT_FORMAT?.trim().toLowerCase();
  return value === "json" ? "json" : "stream-json";
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
    outputFormat: outputFormatFromEnv(),
    includePartialMessages: boolFromEnv("CC_CLAUDE_INCLUDE_PARTIAL_MESSAGES", true),
    maxTurns: Math.max(1, Math.floor(numberFromEnv("CC_CLAUDE_MAX_TURNS", 20))),
    timeoutMs: Math.max(1000, Math.floor(numberFromEnv("CC_CLAUDE_TIMEOUT_MS", 1_800_000))),
    workdir: process.env.CC_CLAUDE_WORKDIR?.trim() || undefined,
    skipPermissions: boolFromEnv("CC_CLAUDE_SKIP_PERMISSIONS", false),
    strictMcpConfig: boolFromEnv("CC_CLAUDE_STRICT_MCP_CONFIG", true),
    useCallbackMcp: boolFromEnv("CC_CLAUDE_USE_CALLBACK_MCP", false),
    permissionMode: permissionModeFromEnv(),
    permissionApproveInput: process.env.CC_CLAUDE_PERMISSION_APPROVE_INPUT ?? "y\n",
    permissionDenyInput: process.env.CC_CLAUDE_PERMISSION_DENY_INPUT ?? "n\n",
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
  const raw = requested || loadCcConfig().workdir || defaultClaudeCodeWorkdir();
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
  if (!task) throw new Error("delegate requires a non-empty task for action=task.");
  const workspace = stringValue(record.workspace) || stringValue(record.cwd);
  const rawMode = stringValue(record.mode) || "implement";
  const mode = ["implement", "debug", "refactor", "test", "review", "inspect"].includes(rawMode)
    ? rawMode as DelegateArgs["mode"]
    : "implement";
  const acceptanceCriteria = stringArrayValue(record.acceptance_criteria);
  if (!acceptanceCriteria.length && !record.instruction) {
    throw new Error("delegate requires at least one acceptance_criteria item for action=task.");
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

function workspaceAppendFileArgs(value: unknown): WorkspaceAppendFileArgs {
  const record = asRecord(value);
  const filePath = stringValue(record.path) || stringValue(record.file_path) || stringValue(record.relative_path);
  const chunkBase64 = stringValue(record.chunk_base64) || stringValue(record.chunk) || "";
  if (!filePath) throw new Error("workspace_append_file requires path.");
  if (!chunkBase64) throw new Error("workspace_append_file requires chunk_base64.");
  if (chunkBase64.replace(/\s+/g, "").length > MAX_WORKSPACE_TRANSFER_CHUNK_CHARS) {
    throw new Error(`workspace_append_file chunk_base64 is too large; use chunks of 1500 characters or less.`);
  }
  return {
    workspace: stringValue(record.workspace) || stringValue(record.cwd),
    path: filePath,
    transferId: stringValue(record.transfer_id) || stringValue(record.transferId),
    chunkBase64,
    chunkIndex: numberValue(record.chunk_index) == null ? undefined : Math.floor(numberValue(record.chunk_index) as number),
    reset: booleanValue(record.reset, false),
  };
}

function workspaceFinalizeFileArgs(value: unknown): WorkspaceFinalizeFileArgs {
  const record = asRecord(value);
  const filePath = stringValue(record.path) || stringValue(record.file_path) || stringValue(record.relative_path);
  const sha256 = stringValue(record.sha256) || stringValue(record.expected_sha256);
  if (!filePath) throw new Error("workspace_finalize_file requires path.");
  if (!sha256) throw new Error("workspace_finalize_file requires sha256.");
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error("workspace_finalize_file sha256 must be a 64-character hex digest.");
  return {
    workspace: stringValue(record.workspace) || stringValue(record.cwd),
    path: filePath,
    transferId: stringValue(record.transfer_id) || stringValue(record.transferId),
    sha256: sha256.toLowerCase(),
    mode: stringValue(record.mode),
  };
}

function workspaceRunCommandArgs(value: unknown): WorkspaceRunCommandArgs {
  const record = asRecord(value);
  const command = stringValue(record.command);
  if (!command) throw new Error("workspace_run_command requires command.");
  const args = stringArrayValue(record.args);
  return {
    workspace: stringValue(record.workspace) || stringValue(record.cwd),
    command,
    args,
    shell: booleanValue(record.shell, args.length === 0),
    timeoutMs: Math.max(1000, Math.floor(numberValue(record.timeout_ms) || 120000)),
    env: stringRecordValue(record.env),
  };
}

function assertPathInsideWorkspace(cwd: string, candidate: string): void {
  const relative = path.relative(cwd, candidate);
  if (relative === "") return;
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path must stay inside workspace ${cwd}: ${candidate}`);
  }
}

function resolveWorkspaceFile(cwd: string, requested: string): string {
  const resolved = path.resolve(path.isAbsolute(requested) ? requested : path.join(cwd, requested));
  assertPathInsideWorkspace(cwd, resolved);
  return resolved;
}

function cleanBase64Chunk(value: string): string {
  const cleaned = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
    throw new Error("chunk_base64 contains characters outside base64/base64url.");
  }
  return cleaned;
}

function transferIdFor(cwd: string, targetPath: string, requested?: string): string {
  const raw = requested?.trim();
  if (raw) return raw.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
  return crypto.createHash("sha256").update(`${cwd}\0${targetPath}`).digest("hex").slice(0, 32);
}

async function transferPaths(cwd: string, targetPath: string, transferId?: string): Promise<{ id: string; dir: string; payload: string; metadata: string }> {
  const id = transferIdFor(cwd, targetPath, transferId);
  const dir = path.join(appDataDir(), "cc-mcp", "transfers");
  await ensureDirectory(dir);
  return {
    id,
    dir,
    payload: path.join(dir, `${id}.b64`),
    metadata: path.join(dir, `${id}.json`),
  };
}

async function readTransferMetadata(metadataPath: string): Promise<{ chunks: number; chars: number; targetPath?: string; workspace?: string }> {
  try {
    return JSON.parse(await fs.readFile(metadataPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { chunks: 0, chars: 0 };
    throw error;
  }
}

export async function workspaceAppendFile(rawArgs: unknown): Promise<unknown> {
  const args = workspaceAppendFileArgs(rawArgs);
  const workdir = await resolveWorkdir(args.workspace);
  if (!workdir.ok) throw new Error(workdir.error);
  const targetPath = resolveWorkspaceFile(workdir.cwd, args.path);
  const transfer = await transferPaths(workdir.cwd, targetPath, args.transferId);
  const chunk = cleanBase64Chunk(args.chunkBase64);
  const metadata = args.reset ? { chunks: 0, chars: 0 } : await readTransferMetadata(transfer.metadata);
  if (args.chunkIndex != null && args.chunkIndex !== metadata.chunks) {
    throw new Error(`workspace_append_file expected chunk_index ${metadata.chunks}, received ${args.chunkIndex}.`);
  }

  if (args.reset) await fs.writeFile(transfer.payload, "", "utf8");
  await fs.appendFile(transfer.payload, chunk, "utf8");
  const nextMetadata = {
    transferId: transfer.id,
    workspace: workdir.cwd,
    targetPath,
    chunks: metadata.chunks + 1,
    chars: metadata.chars + chunk.length,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(transfer.metadata, JSON.stringify(nextMetadata, null, 2) + "\n", "utf8");
  return {
    ok: true,
    transferId: transfer.id,
    workspace: workdir.cwd,
    path: targetPath,
    chunks: nextMetadata.chunks,
    chars: nextMetadata.chars,
  };
}

function parseFileMode(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/^0o/i, "");
  if (!/^[0-7]{3,4}$/.test(normalized)) throw new Error("mode must be an octal value such as 644 or 755.");
  return Number.parseInt(normalized, 8);
}

export async function workspaceFinalizeFile(rawArgs: unknown): Promise<unknown> {
  const args = workspaceFinalizeFileArgs(rawArgs);
  const workdir = await resolveWorkdir(args.workspace);
  if (!workdir.ok) throw new Error(workdir.error);
  const targetPath = resolveWorkspaceFile(workdir.cwd, args.path);
  const transfer = await transferPaths(workdir.cwd, targetPath, args.transferId);
  const metadata = await readTransferMetadata(transfer.metadata);
  const base64 = (await fs.readFile(transfer.payload, "utf8")).replace(/\s+/g, "");
  if (!base64) throw new Error("workspace_finalize_file has no uploaded chunks.");
  if (base64.length % 4 !== 0) throw new Error("workspace_finalize_file base64 payload is incomplete; upload all chunks before finalizing.");
  const data = Buffer.from(base64, "base64");
  const actualSha256 = crypto.createHash("sha256").update(data).digest("hex");
  if (actualSha256 !== args.sha256) {
    throw new Error(`workspace_finalize_file sha256 mismatch: expected ${args.sha256}, got ${actualSha256}.`);
  }
  await ensureDirectory(path.dirname(targetPath));
  await fs.writeFile(targetPath, data);
  const mode = parseFileMode(args.mode);
  if (mode != null) await fs.chmod(targetPath, mode).catch(() => undefined);
  return {
    ok: true,
    transferId: transfer.id,
    workspace: workdir.cwd,
    path: targetPath,
    bytes: data.length,
    chunks: metadata.chunks,
    sha256: actualSha256,
    mode: args.mode,
  };
}

export async function workspaceRunCommand(rawArgs: unknown): Promise<unknown> {
  const args = workspaceRunCommandArgs(rawArgs);
  const workdir = await resolveWorkdir(args.workspace);
  if (!workdir.ok) throw new Error(workdir.error);
  const started = Date.now();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(args.command, args.shell ? [] : args.args, {
      cwd: workdir.cwd,
      env: { ...process.env, ...args.env, MCP_HARNESS_HOME: appDataDir() },
      shell: args.shell,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    }, args.timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => { stdout = clipAppend(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = clipAppend(stderr, chunk); });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        workspace: workdir.cwd,
        command: args.command,
        exitCode: null,
        durationMs: Date.now() - started,
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        workspace: workdir.cwd,
        command: args.command,
        exitCode: code,
        durationMs: Date.now() - started,
        timedOut,
        stdout,
        stderr,
      });
    });
  });
}

function promptForTask(task: SessionTask, useCallbackMcp: boolean): string {
  const contextText = task.context === undefined
    ? "No extra context was provided."
    : typeof task.context === "string"
      ? task.context
      : JSON.stringify(task.context, null, 2);

  const lines = [
    "You are Claude Code, running as a local coding execution worker for the main harness through cc-mcp.",
    "The main harness is the orchestrator: it owns planning, task decomposition, user communication, and final verification.",
    "You are the delegated executor: perform only the concrete coding subtask described below inside the specified workspace.",
    "",
    useCallbackMcp
      ? `Use the temporary MCP callback tool ${CALLBACK_SEND_TOOL} when you have meaningful progress, errors, or final status to report.`
      : "cc-mcp captures your stdout/stderr stream automatically, so no callback MCP call is required.",
    ...(useCallbackMcp
      ? [
        `Call ${CALLBACK_SEND_TOOL} with type "progress" for progress updates and type "final" when the task is complete.`,
        `You may call ${CALLBACK_READ_TOOL} if you need to re-read the original delegation payload.`,
      ]
      : []),
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
    "- Do not ask the main harness to run local shell commands or edit files for this subtask; execute the necessary operations yourself in this worker workspace.",
    "- When operating inside the working directory, prefer relative paths over absolute workspace paths to avoid Claude Code path allowlist false positives.",
    "- Avoid bash heredocs for generated scripts. Prefer writing normal files with your file tools. If a long script was staged by the main harness through cc-mcp workspace tools, run that staged script instead of reconstructing it inline.",
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

function buildClaudeArgs(config: CcConfig, args: DelegateArgs, mcpConfigPath: string | undefined, prompt: string): string[] {
  const out = [
    ...config.commandArgs,
    "-p",
    "--output-format",
    config.outputFormat,
  ];
  const permissionModeArg = claudePermissionModeArg(config);
  if (permissionModeArg) out.push("--permission-mode", permissionModeArg);
  if (config.outputFormat === "stream-json") out.push("--verbose");
  if (config.outputFormat === "stream-json" && config.includePartialMessages) out.push("--include-partial-messages");
  if (mcpConfigPath) {
    out.push("--mcp-config", config.wsl ? toWslPath(mcpConfigPath) : mcpConfigPath);
  }
  if (mcpConfigPath && config.strictMcpConfig) out.push("--strict-mcp-config");
  if (config.skipPermissions) out.push("--dangerously-skip-permissions");
  if (mcpConfigPath) out.push("--allowedTools", `${CALLBACK_SEND_TOOL},${CALLBACK_READ_TOOL}`);
  const maxTurns = Math.max(1, Math.floor(args.max_turns || config.maxTurns));
  if (maxTurns > 0) out.push("--max-turns", String(maxTurns));
  const model = args.model || config.model;
  if (model) out.push("--model", model);
  out.push(prompt);
  return out;
}

function claudePermissionModeArg(config: CcConfig): string | undefined {
  if (config.skipPermissions) return undefined;
  if (config.permissionMode === "auto-approve" || config.permissionMode === "main-harness") return "acceptEdits";
  if (config.permissionMode === "deny") return "dontAsk";
  return undefined;
}

interface SpawnCaptureOptions {
  sessionId?: string;
  config?: CcConfig;
  terminalLogPath?: string;
  hooks?: CcRunHooks;
}

function normalizePermissionInput(value: string): string {
  return value.endsWith("\n") || value.endsWith("\r") ? value : `${value}\n`;
}

function clipEventText(value: string, max = 6000): string {
  if (value.length <= max) return value;
  return value.slice(value.length - max);
}

function parseJsonLineForPermission(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    const record = asRecord(parsed);
    const candidates = [record.message, record.content, record.text, record.result, record.error, record.permission];
    return candidates
      .map((item) => typeof item === "string" ? item : item == null ? "" : JSON.stringify(item))
      .filter(Boolean)
      .join("\n") || undefined;
  } catch {
    return undefined;
  }
}

function detectPermissionPrompt(recentOutput: string): string | undefined {
  const text = recentOutput.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  const permissionLike = /(permission|authorize|authorization|approval|allow|proceed|continue|run this command|execute this command|wants to run|would like to run|tool use|bash command)/i;
  const questionLike = /(\?|yes|no|allow|deny|approve|reject|proceed|continue|\[[yYnN]\])/i;
  let candidateText = text;
  if (!permissionLike.test(candidateText) || !questionLike.test(candidateText)) {
    candidateText = text
      .split(/\r?\n/)
      .map(parseJsonLineForPermission)
      .filter((item): item is string => Boolean(item))
      .join("\n");
  }
  if (!permissionLike.test(candidateText) || !questionLike.test(candidateText)) return undefined;

  const lines = candidateText.split(/\r?\n/).filter((line) => line.trim());
  const prompt = lines.slice(-20).join("\n").trim();
  return prompt ? clipEventText(prompt, MAX_PERMISSION_PROMPT_CHARS) : undefined;
}

async function spawnAndCapture(command: string, args: string[], cwd: string, timeoutMs: number, options: SpawnCaptureOptions = {}): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let terminalText = "";
    let terminalTextChars = 0;
    let terminalLogBytes = 0;
    let terminalLogError: string | undefined;
    let eventSequence = 0;
    let recentOutput = "";
    let permissionInFlight = false;
    let lastPermissionFingerprint = "";
    let settled = false;
    let timedOut = false;
    const events: CcRuntimeEvent[] = [];
    const permissionRequests: CcPermissionRequest[] = [];
    const terminalLogPath = options.terminalLogPath;
    const terminalStream = terminalLogPath ? createWriteStream(terminalLogPath, { flags: "a", encoding: "utf8" }) : undefined;

    terminalStream?.on("error", (error) => {
      terminalLogError = error instanceof Error ? error.message : String(error);
    });

    function recordTerminal(stream: "stdout" | "stderr" | "process", text: string, kind: CcRuntimeEvent["kind"] = stream === "process" ? "process" : "output", metadata?: unknown): void {
      if (!text) return;
      const timestamp = new Date().toISOString();
      const jsonLine = JSON.stringify({ timestamp, stream, kind, text, metadata }) + "\n";
      terminalLogBytes += Buffer.byteLength(jsonLine, "utf8");
      terminalStream?.write(jsonLine);

      const formatted = `[${timestamp} ${stream}]\n${text}${text.endsWith("\n") ? "" : "\n"}`;
      terminalTextChars += formatted.length;
      terminalText = clipAppend(terminalText, Buffer.from(formatted, "utf8"));
      const event: CcRuntimeEvent = {
        sessionId: options.sessionId || "",
        sequence: ++eventSequence,
        timestamp,
        kind,
        stream,
        text: clipEventText(text),
        metadata,
      };
      events.push(event);
      if (events.length > MAX_EVENTS) events.shift();
      void Promise.resolve(options.hooks?.onEvent?.(event)).catch(() => undefined);
    }

    function withTerminalLog(result: Omit<SpawnResult, "terminalLog">): SpawnResult {
      if (!terminalLogPath) return result;
      return {
        ...result,
        terminalLog: {
          path: terminalLogPath,
          format: "jsonl",
          bytes: terminalLogBytes,
          text: terminalText,
          truncated: terminalTextChars > MAX_CAPTURE_CHARS,
          error: terminalLogError,
        },
      };
    }

    function finish(result: Omit<SpawnResult, "terminalLog">): void {
      const finalResult = withTerminalLog(result);
      if (!terminalStream) {
        resolve(finalResult);
        return;
      }
      terminalStream.end(() => resolve(finalResult));
    }

    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, MCP_HARNESS_HOME: appDataDir() },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    async function handlePermissionPrompt(prompt: string): Promise<void> {
      if (permissionInFlight || settled) return;
      const fingerprint = prompt.replace(/\s+/g, " ").slice(-500);
      if (fingerprint && fingerprint === lastPermissionFingerprint) return;
      lastPermissionFingerprint = fingerprint;
      permissionInFlight = true;

      const request: CcPermissionRequest = {
        id: `${options.sessionId || "session"}-${permissionRequests.length + 1}`,
        sessionId: options.sessionId || "",
        prompt,
        raw: prompt,
        status: "pending",
        timestamp: new Date().toISOString(),
      };
      permissionRequests.push(request);
      recordTerminal("process", `Claude Code permission request detected:\n${prompt}`, "permission", { permissionRequestId: request.id });

      try {
        let decision: CcPermissionDecision | undefined;
        if (options.config?.skipPermissions) {
          decision = {
            approved: true,
            source: "skip_permissions",
            reason: "CC_CLAUDE_SKIP_PERMISSIONS is enabled.",
            responseText: options.config.permissionApproveInput,
          };
        } else if (options.config?.permissionMode === "auto-approve") {
          decision = {
            approved: true,
            source: "main_harness_full",
            reason: "Permission mode is auto-approve/full.",
            responseText: options.config.permissionApproveInput,
          };
        } else if (options.config?.permissionMode === "deny") {
          decision = {
            approved: false,
            source: "fallback",
            reason: "Permission mode is deny.",
            responseText: options.config.permissionDenyInput,
          };
        } else {
          decision = await options.hooks?.authorizePermission?.(request);
        }

        if (!decision) {
          decision = {
            approved: true,
            source: "fallback",
            reason: "Main harness did not provide an authorization channel; cc-mcp auto-approved to avoid silent Write/Edit denial.",
            responseText: options.config?.permissionApproveInput || "y\n",
          };
        }

        request.status = decision.approved
          ? decision.source === "main_harness_full" || decision.source === "skip_permissions" ? "auto_approved" : "approved"
          : decision.source === "no_elicitation" ? "unhandled" : "denied";
        request.source = decision.source;
        request.reason = decision.reason;
        request.resolvedAt = new Date().toISOString();

        const response = normalizePermissionInput(decision.responseText || (decision.approved
          ? options.config?.permissionApproveInput || "y\n"
          : options.config?.permissionDenyInput || "n\n"));
        request.responseSent = response.trim() || response;
        if (child.stdin.writable) child.stdin.write(response);
        recordTerminal("process", `Permission ${decision.approved ? "approved" : "denied"} by ${decision.source || "unknown"}.`, "permission", {
          permissionRequestId: request.id,
          approved: decision.approved,
          source: decision.source,
          reason: decision.reason,
        });
      } catch (error) {
        request.status = "failed";
        request.reason = error instanceof Error ? error.message : String(error);
        request.resolvedAt = new Date().toISOString();
        const response = normalizePermissionInput(options.config?.permissionDenyInput || "n\n");
        request.responseSent = response.trim() || response;
        if (child.stdin.writable) child.stdin.write(response);
        recordTerminal("process", `Permission authorization failed: ${request.reason}`, "permission", { permissionRequestId: request.id });
      } finally {
        recentOutput = "";
        permissionInFlight = false;
      }
    }

    function inspectForPermission(text: string): void {
      if (!text || options.config?.skipPermissions) return;
      recentOutput = clipEventText(`${recentOutput}${text}`, 12000);
      const prompt = detectPermissionPrompt(recentOutput);
      if (prompt) void handlePermissionPrompt(prompt);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      recordTerminal("process", `timeout after ${timeoutMs}ms; sending SIGTERM`);
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) {
          recordTerminal("process", "process did not exit after SIGTERM; sending SIGKILL");
          child.kill("SIGKILL");
        }
      }, 3000).unref();
    }, timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout = clipAppend(stdout, chunk);
      recordTerminal("stdout", text);
      inspectForPermission(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr = clipAppend(stderr, chunk);
      recordTerminal("stderr", text);
      inspectForPermission(text);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      recordTerminal("process", `spawn error: ${error instanceof Error ? error.message : String(error)}`);
      finish({ exitCode: null, stdout, stderr, timedOut, events, permissionRequests, error });
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      recordTerminal("process", `process exited with code ${code ?? "null"}`);
      finish({ exitCode: code, stdout, stderr, timedOut, events, permissionRequests });
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

async function prepareClaudeCodeRun(rawArgs: unknown, profileId: string, start: number): Promise<
  { ok: true; run: PreparedClaudeRun } |
  { ok: false; result: CcDelegateResult }
> {
  const args = delegateArgs(rawArgs);
  const workdir = await resolveWorkdir(args.workspace);
  const sessionId = makeSessionId();
  const sessionDir = path.join(sessionsBaseDir(), sessionId);
  await ensureDirectory(sessionDir);

  if (!workdir.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        sessionId,
        status: "invalid_request",
        exitCode: null,
        durationMs: Date.now() - start,
        resultText: "",
        callbacks: [],
        error: workdir.error,
      },
    };
  }

  const task: SessionTask = {
    sessionId,
    workspace: args.workspace || workdir.cwd,
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
  const mcpConfigPath = config.useCallbackMcp
    ? await writeCallbackMcpConfig(sessionDir, sessionId, profileId, config.wsl)
    : undefined;
  const timeoutMs = Math.max(1000, Math.floor(args.timeout_ms || config.timeoutMs));
  const claudeArgs = buildClaudeArgs(config, args, mcpConfigPath, promptForTask(task, config.useCallbackMcp));
  return {
    ok: true,
    run: {
      start,
      args,
      config,
      sessionId,
      sessionDir,
      task,
      timeoutMs,
      claudeArgs,
      terminalLogPath: path.join(sessionDir, TERMINAL_LOG_FILE),
    },
  };
}

async function completeClaudeCodeRun(run: PreparedClaudeRun, spawned: SpawnResult): Promise<CcDelegateResult> {
  const callbacks = await readCallbacks(run.sessionDir);
  const parsed = parseClaudeOutput(spawned.stdout);
  const missingClaude = (spawned.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  const detectedStatus = missingClaude
    ? "missing_claude"
    : spawned.timedOut
      ? "timeout"
      : spawned.exitCode === 0
        ? "completed"
        : "failed";

  return {
    ok: detectedStatus === "completed",
    sessionId: run.sessionId,
    status: detectedStatus,
    exitCode: spawned.exitCode,
    durationMs: Date.now() - run.start,
    resultText: parsed.resultText,
    callbacks,
    terminalLog: spawned.terminalLog,
    events: spawned.events,
    permissionRequests: spawned.permissionRequests,
    rawClaudeOutput: parsed.rawClaudeOutput,
    stderrTail: tail(spawned.stderr),
    error: spawned.error ? (spawned.error instanceof Error ? spawned.error.message : String(spawned.error)) : undefined,
  };
}

export async function delegateToClaudeCode(rawArgs: unknown, profileId = "default", hooks: CcRunHooks = {}): Promise<CcDelegateResult> {
  const start = Date.now();
  const prepared = await prepareClaudeCodeRun(rawArgs, profileId, start);
  if (!prepared.ok) return prepared.result;

  const run = prepared.run;
  const spawned = await spawnAndCapture(run.config.command, run.claudeArgs, run.task.cwd, run.timeoutMs, {
    sessionId: run.sessionId,
    config: run.config,
    hooks,
    terminalLogPath: run.terminalLogPath,
  });
  return completeClaudeCodeRun(run, spawned);
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

export async function sendMessageToHarness(rawArgs: unknown): Promise<CcCallbackMessage> {
  const record = asRecord(rawArgs);
  const sessionId = stringValue(record.session_id) || process.env.CC_MCP_SESSION_ID || "";
  if (!sessionId) throw new Error("send_message_to_harness requires a session_id or active callback session.");
  const type = stringValue(record.type) || "progress";
  const message = stringValue(record.message);
  if (!message) throw new Error("send_message_to_harness requires a non-empty message.");
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

export async function readHarnessTask(rawArgs: unknown): Promise<SessionTask> {
  const sessionId = stringValue(asRecord(rawArgs).session_id) || process.env.CC_MCP_SESSION_ID;
  const dir = callbackSessionDir(sessionId);
  const text = await fs.readFile(path.join(dir, TASK_FILE), "utf8");
  return JSON.parse(text) as SessionTask;
}
