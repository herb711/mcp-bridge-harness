import { spawn } from "node:child_process";
import os from "node:os";

export interface ClaudeCodeDetectionInput {
  env?: Record<string, string | undefined>;
}

export interface ClaudeCodeDetectionAttempt {
  id: string;
  label: string;
  runtime: "local" | "wsl";
  command: string;
  commandArgs: string[];
  ok: boolean;
  version?: string;
  error?: string;
}

export interface ClaudeCodeDetectionResult {
  ok: boolean;
  detected?: {
    label: string;
    runtime: "local" | "wsl";
    command: string;
    commandArgs: string[];
    wsl: boolean;
    version: string;
  };
  attempts: ClaudeCodeDetectionAttempt[];
}

interface CommandResult {
  exitCode: number | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  error?: NodeJS.ErrnoException | Error;
}

interface Candidate {
  id: string;
  label: string;
  runtime: "local" | "wsl";
  command: string;
  commandArgs: string[];
}

const VERSION_TIMEOUT_MS = 6000;
const WSL_LIST_TIMEOUT_MS = 4000;
const MAX_WSL_DISTROS = 8;

function parseArgsText(raw?: string): string[] {
  const value = raw?.trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    // Fall back to simple whitespace splitting for concise local overrides.
  }
  return value.split(/\s+/g).filter(Boolean);
}

function commandKey(candidate: Candidate): string {
  return JSON.stringify([candidate.command.toLowerCase(), candidate.commandArgs]);
}

function addUnique(out: Candidate[], candidate: Candidate): void {
  const key = commandKey(candidate);
  if (!out.some((item) => commandKey(item) === key)) out.push(candidate);
}

function clip(text: string, max = 1200): string {
  const value = text.trim();
  return value.length > max ? value.slice(value.length - max) : value;
}

function decodeCommandOutput(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  if (utf8.includes("\u0000")) return buffer.toString("utf16le").replace(/\u0000/g, "");
  return utf8;
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timedOut = false;

    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 1000).unref();
    }, timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: null, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), timedOut, error });
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), timedOut });
    });
  });
}

async function installedWslDistros(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const result = await runCommand("wsl.exe", ["-l", "-q"], WSL_LIST_TIMEOUT_MS);
  if (result.error || result.exitCode !== 0) return [];
  const text = decodeCommandOutput(Buffer.concat([result.stdout, result.stderr]));
  return text
    .split(/\r?\n/g)
    .map((line) => line.replace(/\u0000/g, "").trim())
    .filter((line) => line && !/^windows subsystem for linux/i.test(line))
    .slice(0, MAX_WSL_DISTROS);
}

async function buildCandidates(env: Record<string, string | undefined>): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const runtime = env.CC_CLAUDE_RUNTIME?.trim().toLowerCase() === "local" ? "local" : "wsl";
  const command = env.CC_CLAUDE_COMMAND?.trim() || (runtime === "wsl" ? "wsl.exe" : "claude");
  addUnique(out, {
    id: "current",
    label: "Current form configuration",
    runtime,
    command,
    commandArgs: parseArgsText(env.CC_CLAUDE_COMMAND_ARGS),
  });

  if (process.platform === "win32") {
    addUnique(out, {
      id: "wsl-default",
      label: "WSL default distribution",
      runtime: "wsl",
      command: "wsl.exe",
      commandArgs: ["--", "claude"],
    });
    for (const distro of await installedWslDistros()) {
      addUnique(out, {
        id: `wsl-${distro}`,
        label: `WSL distribution: ${distro}`,
        runtime: "wsl",
        command: "wsl.exe",
        commandArgs: ["-d", distro, "--", "claude"],
      });
    }
  }

  addUnique(out, {
    id: "local-path",
    label: `${os.platform() === "win32" ? "Windows" : "Local"} PATH command`,
    runtime: "local",
    command: "claude",
    commandArgs: [],
  });

  return out;
}

function errorForResult(result: CommandResult): string {
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return "Command not found.";
  if (result.error) return result.error instanceof Error ? result.error.message : String(result.error);
  if (result.timedOut) return `Timed out after ${VERSION_TIMEOUT_MS}ms.`;
  const stderr = clip(decodeCommandOutput(result.stderr));
  return stderr || `Exited with code ${result.exitCode}.`;
}

async function testCandidate(candidate: Candidate): Promise<ClaudeCodeDetectionAttempt> {
  const result = await runCommand(candidate.command, [...candidate.commandArgs, "--version"], VERSION_TIMEOUT_MS);
  const version = clip(decodeCommandOutput(Buffer.concat([result.stdout, result.stderr])));
  const ok = !result.error && !result.timedOut && result.exitCode === 0 && Boolean(version);
  return {
    ...candidate,
    ok,
    version: ok ? version : undefined,
    error: ok ? undefined : errorForResult(result),
  };
}

export async function detectClaudeCode(input: ClaudeCodeDetectionInput = {}): Promise<ClaudeCodeDetectionResult> {
  const candidates = await buildCandidates(input.env || {});
  const attempts: ClaudeCodeDetectionAttempt[] = [];

  for (const candidate of candidates) {
    const attempt = await testCandidate(candidate);
    attempts.push(attempt);
    if (attempt.ok && attempt.version) {
      return {
        ok: true,
        detected: {
          label: attempt.label,
          runtime: attempt.runtime,
          command: attempt.command,
          commandArgs: attempt.commandArgs,
          wsl: attempt.runtime === "wsl",
          version: attempt.version,
        },
        attempts,
      };
    }
  }

  return { ok: false, attempts };
}
