import fs from "node:fs/promises";
import path from "node:path";
import { BUILTIN_CATALOG, getCatalogEntry, type HarnessId } from "./catalog.js";
import { appDataDir, catalogSnapshotPath, defaultOutputPath, logPath, secretsPath, statePath } from "./paths.js";
import { readJsonCFile, writePrettyJson } from "./jsonc.js";

export interface InstalledMcp {
  id: string;
  profileId: string;
  displayName: string;
  version: string;
  source: "bundled" | "catalog" | "manual";
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  env: Record<string, string>;
  secretKeys: string[];
  targetHarnesses: HarnessId[];
}

export interface ClientBinding {
  harnessId: HarnessId;
  mcpId: string;
  profileId: string;
  enabled: boolean;
  configPath?: string;
  lastAppliedAt?: string;
}

export interface HarnessState {
  schemaVersion: 1;
  appName: "MCP Harness";
  installed: Record<string, InstalledMcp>;
  clients: Record<string, ClientBinding>;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessSecrets {
  schemaVersion: 1;
  profiles: Record<string, Record<string, string>>;
  updatedAt: string;
}

export interface McpProfileStatus {
  configured: boolean;
  missingRequiredKeys: string[];
  hasProfile: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultState(): HarnessState {
  const now = nowIso();
  return {
    schemaVersion: 1,
    appName: "MCP Harness",
    installed: {},
    clients: {},
    createdAt: now,
    updatedAt: now,
  };
}

function defaultSecrets(): HarnessSecrets {
  return {
    schemaVersion: 1,
    profiles: {},
    updatedAt: nowIso(),
  };
}

export async function ensureHarnessDirs(): Promise<void> {
  await fs.mkdir(appDataDir(), { recursive: true });
  await fs.mkdir(path.dirname(logPath()), { recursive: true });
  await fs.mkdir(defaultOutputPath(), { recursive: true });
}

export async function readState(): Promise<HarnessState> {
  await ensureHarnessDirs();
  return readJsonCFile<HarnessState>(statePath(), defaultState());
}

export async function writeState(state: HarnessState): Promise<void> {
  state.updatedAt = nowIso();
  await ensureHarnessDirs();
  await writePrettyJson(statePath(), state);
}

export async function readSecrets(): Promise<HarnessSecrets> {
  await ensureHarnessDirs();
  return readJsonCFile<HarnessSecrets>(secretsPath(), defaultSecrets());
}

export async function writeSecrets(secrets: HarnessSecrets): Promise<void> {
  secrets.updatedAt = nowIso();
  await ensureHarnessDirs();
  await writePrettyJson(secretsPath(), secrets);
  try {
    await fs.chmod(secretsPath(), 0o600);
  } catch {
    // Windows and some mounted filesystems may ignore POSIX file modes.
  }
}

export async function appendLog(message: string): Promise<void> {
  await ensureHarnessDirs();
  await fs.appendFile(logPath(), `[${nowIso()}] ${message}\n`, "utf8");
}

export async function ensureDefaultInstall(): Promise<HarnessState> {
  await ensureHarnessDirs();
  const state = await readState();
  const secrets = await readSecrets();
  let changed = false;

  const minimax = getCatalogEntry("minimax-bridge");
  if (!minimax) throw new Error("Bundled catalog is missing minimax-bridge.");
  const agnes = getCatalogEntry("agnes");
  if (!agnes) throw new Error("Bundled catalog is missing agnes.");
  const ccMcp = getCatalogEntry("cc-mcp");
  if (!ccMcp) throw new Error("Bundled catalog is missing cc-mcp.");

  if (!state.installed["minimax-bridge"]) {
    const now = nowIso();
    state.installed["minimax-bridge"] = {
      id: "minimax-bridge",
      profileId: "default",
      displayName: minimax.displayName,
      version: minimax.version,
      source: "bundled",
      enabled: true,
      installedAt: now,
      updatedAt: now,
      env: {
        MINIMAX_API_HOST: "https://api.minimaxi.com",
        MINIMAX_MCP_BASE_PATH: defaultOutputPath(),
        MINIMAX_T2A_MODE: "async",
        MINIMAX_ENABLE_OFFICIAL_MCP_PROXY: "true",
        MINIMAX_OFFICIAL_MCP_COMMAND: "npx",
        MINIMAX_OFFICIAL_MCP_ARGS: "[\"-y\",\"minimax-mcp-js\"]",
        MINIMAX_OFFICIAL_MCP_TIMEOUT_MS: "600000",
        MINIMAX_ENABLE_TOKEN_PLAN_PROXY: "true",
        MINIMAX_PLAN_MCP_COMMAND: "uvx",
        MINIMAX_PLAN_MCP_ARGS: "[\"minimax-coding-plan-mcp\", \"-y\"]",
      },
      secretKeys: ["MINIMAX_API_KEY", "MINIMAX_PLAN_API_KEY"],
      targetHarnesses: ["opencode"],
    };
    changed = true;
  }

  const installed = state.installed["minimax-bridge"];
  if (installed) {
    const envDefaults: Record<string, string> = {
      MINIMAX_ENABLE_OFFICIAL_MCP_PROXY: "true",
      MINIMAX_OFFICIAL_MCP_COMMAND: "npx",
      MINIMAX_OFFICIAL_MCP_ARGS: "[\"-y\",\"minimax-mcp-js\"]",
      MINIMAX_OFFICIAL_MCP_TIMEOUT_MS: "600000",
    };
    for (const [key, value] of Object.entries(envDefaults)) {
      if (installed.env[key] == null || installed.env[key] === "") {
        installed.env[key] = value;
        changed = true;
      }
    }
  }

  if (!state.installed["agnes"]) {
    const now = nowIso();
    state.installed["agnes"] = {
      id: "agnes",
      profileId: "default",
      displayName: agnes.displayName,
      version: agnes.version,
      source: "bundled",
      enabled: true,
      installedAt: now,
      updatedAt: now,
      env: {
        AGNES_API_HOST: "https://apihub.agnes-ai.com",
        AGNES_MCP_BASE_PATH: defaultOutputPath("agnes"),
        AGNES_POLL_INTERVAL_SECONDS: "10",
        AGNES_MAX_WAIT_SECONDS: "900",
      },
      secretKeys: ["AGNES_API_KEY"],
      targetHarnesses: ["opencode"],
    };
    changed = true;
  }

  const installedAgnes = state.installed["agnes"];
  if (installedAgnes) {
    const envDefaults: Record<string, string> = {
      AGNES_API_HOST: "https://apihub.agnes-ai.com",
      AGNES_MCP_BASE_PATH: defaultOutputPath("agnes"),
      AGNES_POLL_INTERVAL_SECONDS: "10",
      AGNES_MAX_WAIT_SECONDS: "900",
    };
    for (const [key, value] of Object.entries(envDefaults)) {
      if (installedAgnes.env[key] == null || installedAgnes.env[key] === "") {
        installedAgnes.env[key] = value;
        changed = true;
      }
    }
  }

  if (!state.installed["cc-mcp"]) {
    const now = nowIso();
    const ccRuntime = process.platform === "win32" ? "wsl" : "local";
    const ccCommand = ccRuntime === "wsl" ? "wsl.exe" : "claude";
    const ccCommandArgs = ccRuntime === "wsl" ? "[\"--\",\"claude\"]" : "[]";
    const ccWsl = ccRuntime === "wsl" ? "true" : "false";
    state.installed["cc-mcp"] = {
      id: "cc-mcp",
      profileId: "default",
      displayName: ccMcp.displayName,
      version: ccMcp.version,
      source: "bundled",
      enabled: true,
      installedAt: now,
      updatedAt: now,
      env: {
        CC_MCP_SERVER_MODE: "local",
        CC_MCP_REMOTE_NICKNAME: "",
        CC_MCP_REMOTE_HOST: "",
        CC_MCP_REMOTE_PORT: "22",
        CC_MCP_REMOTE_USER: "",
        CC_MCP_REMOTE_KEY_PATH: "",
        CC_MCP_REMOTE_PUBLIC_KEY_PATH: "",
        CC_MCP_REMOTE_INSTALL_DIR: "~/.local/share/mcp-harness/cc-mcp-server",
        CC_MCP_REMOTE_HARNESS_HOME: "~/.local/share/mcp-harness",
        CC_MCP_REMOTE_WORKDIR: "",
        CC_MCP_REMOTE_NODE_COMMAND: "node",
        CC_MCP_REMOTE_CLAUDE_COMMAND: "claude",
        CC_MCP_REMOTE_INSTALL_CLAUDE: "true",
        CC_MCP_PERMISSION_MODE: "main-harness",
        CC_MCP_PERMISSION_REQUEST_TIMEOUT_MS: "120000",
        CC_CLAUDE_RUNTIME: ccRuntime,
        CC_CLAUDE_COMMAND: ccCommand,
        CC_CLAUDE_COMMAND_ARGS: ccCommandArgs,
        CC_CLAUDE_MODEL: "",
        CC_CLAUDE_OUTPUT_FORMAT: "stream-json",
        CC_CLAUDE_INCLUDE_PARTIAL_MESSAGES: "true",
        CC_CLAUDE_MAX_TURNS: "20",
        CC_CLAUDE_TIMEOUT_MS: "1800000",
        CC_CLAUDE_WORKDIR: "",
        CC_CLAUDE_SKIP_PERMISSIONS: "false",
        CC_CLAUDE_PERMISSION_APPROVE_INPUT: "y",
        CC_CLAUDE_PERMISSION_DENY_INPUT: "n",
        CC_CLAUDE_STRICT_MCP_CONFIG: "true",
        CC_CLAUDE_USE_CALLBACK_MCP: "false",
        CC_CLAUDE_WSL: ccWsl,
      },
      secretKeys: ["CC_MCP_REMOTE_PASSWORD"],
      targetHarnesses: ["opencode", "hermes", "codex", "claude-code"],
    };
    changed = true;
  }

  const installedCcMcp = state.installed["cc-mcp"];
  if (installedCcMcp) {
    const ccRuntime = process.platform === "win32" ? "wsl" : "local";
    const envDefaults: Record<string, string> = {
      CC_MCP_SERVER_MODE: "local",
      CC_MCP_REMOTE_PORT: "22",
      CC_MCP_REMOTE_INSTALL_DIR: "~/.local/share/mcp-harness/cc-mcp-server",
      CC_MCP_REMOTE_HARNESS_HOME: "~/.local/share/mcp-harness",
      CC_MCP_REMOTE_NODE_COMMAND: "node",
      CC_MCP_REMOTE_CLAUDE_COMMAND: "claude",
      CC_MCP_REMOTE_INSTALL_CLAUDE: "true",
      CC_MCP_PERMISSION_MODE: "main-harness",
      CC_MCP_PERMISSION_REQUEST_TIMEOUT_MS: "120000",
      CC_CLAUDE_RUNTIME: ccRuntime,
      CC_CLAUDE_COMMAND: ccRuntime === "wsl" ? "wsl.exe" : "claude",
      CC_CLAUDE_COMMAND_ARGS: ccRuntime === "wsl" ? "[\"--\",\"claude\"]" : "[]",
      CC_CLAUDE_OUTPUT_FORMAT: "stream-json",
      CC_CLAUDE_INCLUDE_PARTIAL_MESSAGES: "true",
      CC_CLAUDE_MAX_TURNS: "20",
      CC_CLAUDE_TIMEOUT_MS: "1800000",
      CC_CLAUDE_SKIP_PERMISSIONS: "false",
      CC_CLAUDE_PERMISSION_APPROVE_INPUT: "y",
      CC_CLAUDE_PERMISSION_DENY_INPUT: "n",
      CC_CLAUDE_STRICT_MCP_CONFIG: "true",
      CC_CLAUDE_USE_CALLBACK_MCP: "false",
      CC_CLAUDE_WSL: ccRuntime === "wsl" ? "true" : "false",
    };
    for (const [key, value] of Object.entries(envDefaults)) {
      if (installedCcMcp.env[key] == null || installedCcMcp.env[key] === "") {
        installedCcMcp.env[key] = value;
        changed = true;
      }
    }
    const hasOldLocalDefaults =
      (!installedCcMcp.env.CC_CLAUDE_RUNTIME || installedCcMcp.env.CC_CLAUDE_RUNTIME === "wsl") &&
      installedCcMcp.env.CC_CLAUDE_COMMAND === "claude" &&
      (!installedCcMcp.env.CC_CLAUDE_COMMAND_ARGS || installedCcMcp.env.CC_CLAUDE_COMMAND_ARGS === "[]") &&
      installedCcMcp.env.CC_CLAUDE_WSL === "false";
    if (process.platform === "win32" && hasOldLocalDefaults) {
      installedCcMcp.env.CC_CLAUDE_RUNTIME = "wsl";
      installedCcMcp.env.CC_CLAUDE_COMMAND = "wsl.exe";
      installedCcMcp.env.CC_CLAUDE_COMMAND_ARGS = "[\"--\",\"claude\"]";
      installedCcMcp.env.CC_CLAUDE_WSL = "true";
      changed = true;
    }
    const targetHarnesses: HarnessId[] = ["opencode", "hermes", "codex", "claude-code"];
    if (targetHarnesses.some((item) => !installedCcMcp.targetHarnesses.includes(item))) {
      installedCcMcp.targetHarnesses = Array.from(new Set([...installedCcMcp.targetHarnesses, ...targetHarnesses]));
      changed = true;
    }
    if (!installedCcMcp.secretKeys.includes("CC_MCP_REMOTE_PASSWORD")) {
      installedCcMcp.secretKeys = [...installedCcMcp.secretKeys, "CC_MCP_REMOTE_PASSWORD"];
      changed = true;
    }
  }

  const profileKey = profileKeyFor("minimax-bridge", "default");
  if (!secrets.profiles[profileKey]) {
    secrets.profiles[profileKey] = {};
    await writeSecrets(secrets);
  }
  const agnesProfileKey = profileKeyFor("agnes", "default");
  if (!secrets.profiles[agnesProfileKey]) {
    secrets.profiles[agnesProfileKey] = {};
    await writeSecrets(secrets);
  }
  const ccMcpProfileKey = profileKeyFor("cc-mcp", "default");
  if (!secrets.profiles[ccMcpProfileKey]) {
    secrets.profiles[ccMcpProfileKey] = {};
    await writeSecrets(secrets);
  }

  if (changed) await writeState(state);
  await writePrettyJson(catalogSnapshotPath(), BUILTIN_CATALOG);
  return state;
}

export function profileKeyFor(mcpId: string, profileId: string): string {
  return `${mcpId}:${profileId}`;
}

function requiredProfileKeys(mcpId: string): string[] {
  return (getCatalogEntry(mcpId)?.fields || [])
    .filter((field) => field.required)
    .map((field) => field.key);
}

export async function getMcpProfileStatus(mcpId: string, profileId = "default"): Promise<McpProfileStatus> {
  const state = await readState();
  const secrets = await readSecrets();
  const installed = state.installed[mcpId];
  const profileKey = profileKeyFor(mcpId, profileId);
  const profile = secrets.profiles[profileKey] || {};
  const env = {
    ...(installed?.env || {}),
    ...profile,
  };
  const missingRequiredKeys = requiredProfileKeys(mcpId).filter((key) => !String(env[key] || "").trim());
  return {
    configured: Boolean(installed) && missingRequiredKeys.length === 0,
    missingRequiredKeys,
    hasProfile: Boolean(secrets.profiles[profileKey]),
  };
}

export async function getEffectiveEnv(mcpId: string, profileId = "default"): Promise<Record<string, string>> {
  const state = await readState();
  const secrets = await readSecrets();
  const installed = state.installed[mcpId];
  if (!installed) throw new Error(`MCP is not installed: ${mcpId}`);
  const profileKey = profileKeyFor(mcpId, profileId);
  return {
    ...installed.env,
    ...(secrets.profiles[profileKey] || {}),
  };
}

export async function applyProfileToProcessEnv(mcpId: string, profileId = "default"): Promise<Record<string, string>> {
  await ensureDefaultInstall();
  const env = await getEffectiveEnv(mcpId, profileId);
  for (const [key, value] of Object.entries(env)) {
    if (value != null && value !== "") process.env[key] = value;
  }
  process.env.MCP_HARNESS_HOME = appDataDir();
  return env;
}

export async function updateMcpProfile(options: {
  mcpId: string;
  profileId?: string;
  env?: Record<string, string | undefined>;
  secrets?: Record<string, string | undefined>;
}): Promise<InstalledMcp> {
  await ensureDefaultInstall();
  const state = await readState();
  const secrets = await readSecrets();
  const profileId = options.profileId || "default";
  const installed = state.installed[options.mcpId];
  if (!installed) throw new Error(`MCP is not installed: ${options.mcpId}`);

  for (const [key, value] of Object.entries(options.env || {})) {
    if (value == null) continue;
    installed.env[key] = String(value);
  }

  const profileKey = profileKeyFor(options.mcpId, profileId);
  secrets.profiles[profileKey] ||= {};
  for (const [key, value] of Object.entries(options.secrets || {})) {
    if (value == null) continue;
    const stringValue = String(value);
    if (stringValue === "") continue;
    secrets.profiles[profileKey][key] = stringValue;
  }

  installed.updatedAt = nowIso();
  state.installed[options.mcpId] = installed;
  await writeState(state);
  await writeSecrets(secrets);
  await appendLog(`Updated profile ${profileKey}`);
  return installed;
}

export async function markClientBinding(binding: ClientBinding): Promise<void> {
  const state = await readState();
  const key = `${binding.harnessId}:${binding.mcpId}:${binding.profileId}`;
  state.clients[key] = binding;
  await writeState(state);
}

export function maskEnv(env: Record<string, string>, secretKeys: string[]): Record<string, string> {
  const secretSet = new Set(secretKeys);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = secretSet.has(key) && value ? "••••••••" : value;
  }
  return out;
}
