import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { delegateToClaudeCode, workspaceAppendFile, workspaceFinalizeFile, workspaceRunCommand } from "../dist/ccBridge.js";

function setEnv(values) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function writeFakeClaude(tempDir, prompt) {
  const fakeClaudePath = path.join(tempDir, "fake-claude.mjs");
  await fs.writeFile(fakeClaudePath, `
process.stdout.write(${JSON.stringify(`${prompt}\n`)});
process.stdin.setEncoding("utf8");
let input = "";
const timeout = setTimeout(() => {
  process.stderr.write("timed out waiting for permission input\\n");
  process.exit(2);
}, 5000);
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (!/[yn]/i.test(input)) return;
  clearTimeout(timeout);
  process.stdout.write(JSON.stringify({ result: "permission:" + input.trim().toLowerCase() }) + "\\n");
  process.exit(0);
});
`, "utf8");
  return fakeClaudePath;
}

function fakeClaudeEnv(tempDir, fakeClaudePath) {
  return {
    MCP_HARNESS_HOME: path.join(tempDir, "harness-home"),
    CC_CLAUDE_RUNTIME: "local",
    CC_CLAUDE_COMMAND: process.execPath,
    CC_CLAUDE_COMMAND_ARGS: JSON.stringify([fakeClaudePath]),
    CC_CLAUDE_WORKDIR: tempDir,
    CC_CLAUDE_OUTPUT_FORMAT: "stream-json",
    CC_CLAUDE_INCLUDE_PARTIAL_MESSAGES: "true",
    CC_CLAUDE_MAX_TURNS: "1",
    CC_CLAUDE_TIMEOUT_MS: "10000",
    CC_CLAUDE_SKIP_PERMISSIONS: "false",
    CC_MCP_PERMISSION_MODE: "main-harness",
    CC_CLAUDE_PERMISSION_APPROVE_INPUT: "y",
    CC_CLAUDE_PERMISSION_DENY_INPUT: "n",
    CC_CLAUDE_STRICT_MCP_CONFIG: "true",
    CC_CLAUDE_USE_CALLBACK_MCP: "false",
    CC_CLAUDE_WSL: "false",
  };
}

test("cc-mcp forwards detected Claude Code permission prompts through hooks", { concurrency: false }, async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-harness-cc-permission-"));
  const fakeClaudePath = await writeFakeClaude(tempDir, "Claude Code wants to run this command. Allow? [y/N]");
  const restoreEnv = setEnv(fakeClaudeEnv(tempDir, fakeClaudePath));
  const events = [];
  const permissionPrompts = [];

  try {
    const result = await delegateToClaudeCode({
      mode: "implement",
      task: "Run the fake permission flow.",
      acceptance_criteria: ["The fake permission prompt is approved."],
      timeout_ms: 10000,
      max_turns: 1,
    }, "default", {
      onEvent(event) {
        events.push(event);
      },
      async authorizePermission(request) {
        permissionPrompts.push(request.prompt);
        return {
          approved: true,
          source: "main_harness_elicitation",
          reason: "test approval",
          responseText: "y",
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "completed");
    assert.equal(result.resultText, "permission:y");
    assert.equal(result.permissionRequests?.length, 1);
    assert.equal(result.permissionRequests?.[0]?.status, "approved");
    assert.equal(result.permissionRequests?.[0]?.responseSent, "y");
    assert.equal(permissionPrompts.length, 1);
    assert.ok(permissionPrompts[0].includes("Allow?"));
    assert.ok(events.some((event) => event.kind === "permission"), "permission events should be emitted");
    assert.ok(result.terminalLog?.text.includes("Permission approved"), "terminal log should include the decision");
  } finally {
    restoreEnv();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("cc-mcp auto-approves permission prompts when no elicitation channel is available", { concurrency: false }, async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-harness-cc-auto-permission-"));
  const fakeClaudePath = await writeFakeClaude(tempDir, "Claude Code wants to use Write. Allow? [y/N]");
  const restoreEnv = setEnv(fakeClaudeEnv(tempDir, fakeClaudePath));

  try {
    const result = await delegateToClaudeCode({
      mode: "implement",
      task: "Run the fake permission flow.",
      acceptance_criteria: ["The fake permission prompt is auto-approved."],
      timeout_ms: 10000,
      max_turns: 1,
    });

    assert.equal(result.ok, true);
    assert.equal(result.resultText, "permission:y");
    assert.equal(result.permissionRequests?.length, 1);
    assert.equal(result.permissionRequests?.[0]?.status, "approved");
    assert.equal(result.permissionRequests?.[0]?.source, "fallback");
  } finally {
    restoreEnv();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("cc-mcp stages large workspace files in base64 chunks and runs commands", { concurrency: false }, async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-harness-workspace-transfer-"));
  const restoreEnv = setEnv({
    MCP_HARNESS_HOME: path.join(tempDir, "harness-home"),
    CC_CLAUDE_WORKDIR: tempDir,
  });
  const data = Buffer.from("hello from staged file\n", "utf8");
  const base64 = data.toString("base64");
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  const chunks = base64.match(/.{1,5}/g) || [];

  try {
    for (const [index, chunk] of chunks.entries()) {
      const appended = await workspaceAppendFile({
        workspace: tempDir,
        path: "scripts/hello.txt",
        chunk_base64: chunk,
        chunk_index: index,
        reset: index === 0,
      });
      assert.equal(appended.ok, true);
    }

    const finalized = await workspaceFinalizeFile({
      workspace: tempDir,
      path: "scripts/hello.txt",
      sha256,
    });
    assert.equal(finalized.ok, true);
    assert.equal(await fs.readFile(path.join(tempDir, "scripts", "hello.txt"), "utf8"), "hello from staged file\n");

    const ran = await workspaceRunCommand({
      workspace: tempDir,
      command: process.execPath,
      args: ["-e", "process.stdout.write(require('fs').readFileSync('scripts/hello.txt', 'utf8'))"],
    });
    assert.equal(ran.ok, true);
    assert.equal(ran.stdout, "hello from staged file\n");
  } finally {
    restoreEnv();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
