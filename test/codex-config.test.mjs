import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyHarnessConfig, mergeCodexConfig } from "../dist/harness/clients.js";
import { applyOpenCodeConfig, buildOpenCodeMcpEntry, previewOpenCodeConfig } from "../dist/harness/opencode.js";
import { updateMcpProfile } from "../dist/harness/state.js";

const entry = {
  command: "node",
  args: ["dist/index.js", "mcp", "cc-mcp", "--profile", "default"],
  env: {
    MCP_HARNESS_HOME: "C:\\Users\\Administrator\\AppData\\Local\\McpHarness",
  },
  enabled: true,
  timeout: 1800,
};

test("Codex config merge adds a server without removing unrelated config", () => {
  const raw = [
    'model = "gpt-5.5"',
    "",
    "[mcp_servers.node_repl]",
    "command = \"node_repl.exe\"",
    "",
    "[mcp_servers.node_repl.env]",
    'CODEX_HOME = "C:\\\\Users\\\\Administrator\\\\.codex"',
    "",
  ].join("\n");

  const next = mergeCodexConfig(raw, "cc-mcp", entry);

  assert.match(next, /model = "gpt-5\.5"/);
  assert.match(next, /\[mcp_servers\.node_repl\]/);
  assert.match(next, /\[mcp_servers\.cc-mcp\]/);
  assert.match(next, /enabled = true/);
  assert.match(next, /startup_timeout_sec = 1800/);
  assert.match(next, /tool_timeout_sec = 1800/);
  assert.match(next, /\[mcp_servers\.cc-mcp\.env\]/);
  assert.match(next, /MCP_HARNESS_HOME = /);
});

test("Codex config merge replaces existing bare and quoted server sections", () => {
  const raw = [
    "[mcp_servers.\"cc-mcp\"]",
    'command = "old"',
    "",
    "[mcp_servers.\"cc-mcp\".env]",
    'OLD_VALUE = "remove-me"',
    "",
    "[mcp_servers.\"cc-mcp\".tools.run]",
    'approval_mode = "prompt"',
    "",
    "[mcp_servers.other]",
    'command = "keep"',
    "",
  ].join("\n");

  const next = mergeCodexConfig(raw, "cc-mcp", entry);

  assert.doesNotMatch(next, /old/);
  assert.doesNotMatch(next, /OLD_VALUE/);
  assert.doesNotMatch(next, /approval_mode/);
  assert.match(next, /\[mcp_servers\.other\]/);
  assert.equal((next.match(/\[mcp_servers\.cc-mcp\]/g) || []).length, 1);
  assert.equal((next.match(/\[mcp_servers\.cc-mcp\.env\]/g) || []).length, 1);
});

test("Codex config merge preserves bundled plugin and computer-use node_repl settings", () => {
  const raw = [
    'notify = [ "C:\\\\Users\\\\Administrator\\\\.codex\\\\plugins\\\\cache\\\\openai-bundled\\\\computer-use\\\\26.601.21317\\\\node_modules\\\\@oai\\\\sky\\\\bin\\\\windows\\\\codex-computer-use.exe", "turn-ended" ]',
    "",
    "[plugins.\"computer-use@openai-bundled\"]",
    "enabled = true",
    "",
    "[plugins.\"chrome@openai-bundled\"]",
    "enabled = true",
    "",
    "[plugins.\"browser@openai-bundled\"]",
    "enabled = true",
    "",
    "[mcp_servers.node_repl]",
    "command = \"node_repl.exe\"",
    "",
    "[mcp_servers.node_repl.env]",
    "NODE_REPL_NODE_MODULE_DIRS = 'C:\\Users\\Administrator\\.codex\\plugins\\cache\\openai-bundled\\computer-use\\26.601.21317\\node_modules'",
    'SKY_CUA_NATIVE_PIPE = "1"',
    "SKY_CUA_NATIVE_PIPE_DIRECTORY = '\\\\.\\pipe\\codex-computer-use-test'",
    "",
  ].join("\n");

  const next = mergeCodexConfig(raw, "cc-mcp", entry);

  assert.match(next, /\[plugins\."computer-use@openai-bundled"\]/);
  assert.match(next, /\[plugins\."chrome@openai-bundled"\]/);
  assert.match(next, /\[plugins\."browser@openai-bundled"\]/);
  assert.match(next, /NODE_REPL_NODE_MODULE_DIRS = 'C:\\Users\\Administrator\\.codex\\plugins\\cache\\openai-bundled\\computer-use\\26\.601\.21317\\node_modules'/);
  assert.match(next, /SKY_CUA_NATIVE_PIPE = "1"/);
  assert.match(next, /SKY_CUA_NATIVE_PIPE_DIRECTORY = '\\\\.\\pipe\\codex-computer-use-test'/);
  assert.match(next, /\[mcp_servers\.cc-mcp\]/);
});

test("Codex config merge stops removing at malformed headers after the target server", () => {
  const raw = [
    "[mcp_servers.cc-mcp]",
    'command = "old"',
    "",
    "[projects.'D:\\SynologyDrive\\broken]",
    'trust_level = "trusted"',
    "",
    '[plugins."computer-use@openai-bundled"]',
    "enabled = true",
    "",
    "[mcp_servers.node_repl]",
    'command = "node_repl.exe"',
    "",
  ].join("\n");

  const next = mergeCodexConfig(raw, "cc-mcp", entry);

  assert.doesNotMatch(next, /command = "old"/);
  assert.match(next, /\[projects\.'D:\\SynologyDrive\\broken\]/);
  assert.match(next, /\[plugins\."computer-use@openai-bundled"\]/);
  assert.match(next, /\[mcp_servers\.node_repl\]/);
  assert.match(next, /\[mcp_servers\.cc-mcp\]/);
});

test("Codex apply preserves bundled plugins and node_repl when reconfiguring cc-mcp", { concurrency: false }, async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-harness-codex-"));
  const configPath = path.join(tempDir, "config.toml");
  const previousHarnessHome = process.env.MCP_HARNESS_HOME;
  process.env.MCP_HARNESS_HOME = path.join(tempDir, "harness-home");

  const raw = [
    'model = "gpt-5.5"',
    "",
    "[marketplaces.openai-bundled]",
    'last_updated = "2026-06-04T02:37:10Z"',
    'source_type = "local"',
    "source = '\\\\?\\C:\\Users\\Administrator\\.codex\\.tmp\\bundled-marketplaces\\openai-bundled'",
    "",
    '[plugins."computer-use@openai-bundled"]',
    "enabled = true",
    "",
    '[plugins."chrome@openai-bundled"]',
    "enabled = true",
    "",
    '[plugins."browser@openai-bundled"]',
    "enabled = true",
    "",
    "[mcp_servers.node_repl]",
    "args = []",
    "command = 'C:\\Users\\Administrator\\AppData\\Local\\OpenAI\\Codex\\bin\\node_repl.exe'",
    "startup_timeout_sec = 120",
    "",
    "[mcp_servers.node_repl.env]",
    'NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS = "1000"',
    "NODE_REPL_NODE_MODULE_DIRS = 'C:\\Users\\Administrator\\.codex\\plugins\\cache\\openai-bundled\\computer-use\\26.601.21317\\node_modules'",
    'SKY_CUA_NATIVE_PIPE = "1"',
    "SKY_CUA_NATIVE_PIPE_DIRECTORY = '\\\\.\\pipe\\codex-computer-use-test'",
    "",
    "[mcp_servers.cc-mcp]",
    'command = "node"',
    'args = ["old"]',
    "",
    "[mcp_servers.cc-mcp.env]",
    'MCP_HARNESS_HOME = "old"',
    "",
  ].join("\n");

  try {
    await fs.writeFile(configPath, raw, "utf8");
    await applyHarnessConfig({ harnessId: "codex", mcpId: "cc-mcp", configPath });
    const next = await fs.readFile(configPath, "utf8");

    assert.match(next, /\[plugins\."computer-use@openai-bundled"\]/);
    assert.match(next, /\[plugins\."chrome@openai-bundled"\]/);
    assert.match(next, /\[plugins\."browser@openai-bundled"\]/);
    assert.match(next, /NODE_REPL_NODE_MODULE_DIRS = 'C:\\Users\\Administrator\\.codex\\plugins\\cache\\openai-bundled\\computer-use\\26\.601\.21317\\node_modules'/);
    assert.match(next, /SKY_CUA_NATIVE_PIPE = "1"/);
    assert.match(next, /SKY_CUA_NATIVE_PIPE_DIRECTORY = '\\\\.\\pipe\\codex-computer-use-test'/);
    assert.doesNotMatch(next, /args = \["old"\]/);
    assert.match(next, /startup_timeout_sec = 1800/);
    assert.match(next, /tool_timeout_sec = 1800/);
  } finally {
    if (previousHarnessHome == null) delete process.env.MCP_HARNESS_HOME;
    else process.env.MCP_HARNESS_HOME = previousHarnessHome;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("OpenCode buildOpenCodeMcpEntry returns ssh command when remote cc-mcp is configured", { concurrency: false }, async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-harness-opencode-"));
  const previousHarnessHome = process.env.MCP_HARNESS_HOME;
  process.env.MCP_HARNESS_HOME = path.join(tempHome, "harness-home");
  await fs.mkdir(process.env.MCP_HARNESS_HOME, { recursive: true });

  try {
    await updateMcpProfile({
      mcpId: "cc-mcp",
      profileId: "default",
      env: {
        CC_MCP_SERVER_MODE: "remote",
        CC_MCP_REMOTE_NICKNAME: "prod-box",
        CC_MCP_REMOTE_HOST: "203.0.113.10",
        CC_MCP_REMOTE_PORT: "22",
        CC_MCP_REMOTE_USER: "ubuntu",
        CC_MCP_REMOTE_INSTALL_DIR: "/srv/cc-mcp",
        CC_MCP_REMOTE_HARNESS_HOME: "/srv/mcp-harness",
        CC_MCP_REMOTE_NODE_COMMAND: "node",
        CC_MCP_REMOTE_CLAUDE_COMMAND: "claude",
        CC_MCP_REMOTE_WORKDIR: "/srv/work",
      },
    });

    const built = await buildOpenCodeMcpEntry("cc-mcp", "default", true);
    assert.equal(built.type, "local");
    assert.ok(Array.isArray(built.command), "command should be an array for local transport");
    assert.equal(built.command[0], "ssh", "first command entry should be ssh in remote mode");
    assert.ok(
      built.command.some((arg) => typeof arg === "string" && arg.includes("203.0.113.10")),
      "ssh target should embed the remote host",
    );
    assert.ok(
      built.command.some((arg) => typeof arg === "string" && arg.includes("dist/index.js mcp cc-mcp")),
      "ssh command should launch the remote cc-mcp server",
    );
    assert.equal(built.environment, undefined, "remote entry should not pin MCP_HARNESS_HOME locally");
  } finally {
    if (previousHarnessHome == null) delete process.env.MCP_HARNESS_HOME;
    else process.env.MCP_HARNESS_HOME = previousHarnessHome;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test("OpenCode applyHarnessConfig writes the ssh command for remote cc-mcp", { concurrency: false }, async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-harness-opencode-apply-"));
  const previousHarnessHome = process.env.MCP_HARNESS_HOME;
  process.env.MCP_HARNESS_HOME = path.join(tempDir, "harness-home");
  await fs.mkdir(process.env.MCP_HARNESS_HOME, { recursive: true });

  const configPath = path.join(tempDir, "opencode.jsonc");
  const existing = {
    $schema: "https://opencode.ai/config.json",
    model: "redou-codex/default",
    instructions: ["C:/Users/Administrator/.config/opencode/mcp-harness-agnes.instructions.md"],
  };
  await fs.writeFile(configPath, JSON.stringify(existing, null, 2), "utf8");

  try {
    await updateMcpProfile({
      mcpId: "cc-mcp",
      profileId: "default",
      env: {
        CC_MCP_SERVER_MODE: "remote",
        CC_MCP_REMOTE_NICKNAME: "prod-box",
        CC_MCP_REMOTE_HOST: "203.0.113.10",
        CC_MCP_REMOTE_PORT: "22",
        CC_MCP_REMOTE_USER: "ubuntu",
        CC_MCP_REMOTE_INSTALL_DIR: "/srv/cc-mcp",
        CC_MCP_REMOTE_HARNESS_HOME: "/srv/mcp-harness",
        CC_MCP_REMOTE_NODE_COMMAND: "node",
        CC_MCP_REMOTE_CLAUDE_COMMAND: "claude",
        CC_MCP_REMOTE_WORKDIR: "/srv/work",
      },
    });

    const preview = await previewOpenCodeConfig({ mcpId: "cc-mcp", profileId: "default", configPath });
    assert.equal(preview.entry.command[0], "ssh", "preview command should also resolve to ssh");
    assert.ok(preview.entry.command.some((arg) => typeof arg === "string" && arg.includes("203.0.113.10")));

    const result = await applyOpenCodeConfig({ mcpId: "cc-mcp", profileId: "default", enabled: true, configPath });
    const next = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal(result.entry.command[0], "ssh");
    assert.ok(result.backupPath, "an existing opencode config should be backed up");
    assert.equal(next.mcp["cc-mcp"].command[0], "ssh");
    assert.ok(
      Array.isArray(next.instructions) && next.instructions.some((ref) => String(ref).toLowerCase().includes("cc-mcp")),
      "opencode config should reference the cc-mcp instruction file",
    );
    const instructionText = await fs.readFile(result.instructionPath, "utf8");
    assert.doesNotMatch(instructionText, /routing rule|routing reason|local-vs-remote/i);
    assert.doesNotMatch(
      instructionText,
      /requested coding work should happen inside this server/i,
      "remote-mode instruction file should not route cc-mcp based on server file location",
    );
    assert.match(
      instructionText,
      /primary-machine-only files, local shell commands, desktop apps/i,
      "remote-mode instruction file should avoid primary-harness local operations",
    );
  } finally {
    if (previousHarnessHome == null) delete process.env.MCP_HARNESS_HOME;
    else process.env.MCP_HARNESS_HOME = previousHarnessHome;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("OpenCode applyHarnessConfig removes cc-mcp when disabled", { concurrency: false }, async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-harness-opencode-disable-"));
  const previousHarnessHome = process.env.MCP_HARNESS_HOME;
  process.env.MCP_HARNESS_HOME = path.join(tempDir, "harness-home");
  await fs.mkdir(process.env.MCP_HARNESS_HOME, { recursive: true });

  const configPath = path.join(tempDir, "opencode.jsonc");
  const existing = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      "cc-mcp": {
        type: "local",
        command: ["node", "old.js"],
        enabled: true,
      },
      "minimax-bridge": {
        type: "local",
        command: ["node", "minimax.js"],
        enabled: true,
      },
    },
    instructions: [
      path.join(tempDir, "mcp-harness-cc-mcp.instructions.md").replace(/\\/g, "/"),
      path.join(tempDir, "mcp-harness-minimax.instructions.md").replace(/\\/g, "/"),
    ],
  };
  await fs.writeFile(configPath, JSON.stringify(existing, null, 2), "utf8");

  try {
    const result = await applyHarnessConfig({ harnessId: "opencode", mcpId: "cc-mcp", enabled: false, configPath });
    const next = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal(result.entry.enabled, false);
    assert.equal(next.mcp["cc-mcp"], undefined, "disabled OpenCode config should remove the MCP entry");
    assert.ok(next.mcp["minimax-bridge"], "unrelated MCP entries should remain");
    assert.ok(
      next.instructions.every((ref) => !String(ref).toLowerCase().includes("cc-mcp")),
      "cc-mcp instruction reference should be removed",
    );
  } finally {
    if (previousHarnessHome == null) delete process.env.MCP_HARNESS_HOME;
    else process.env.MCP_HARNESS_HOME = previousHarnessHome;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
