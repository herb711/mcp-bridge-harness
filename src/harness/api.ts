import { BUILTIN_CATALOG, getCatalogEntry, type HarnessId } from "./catalog.js";
import { detectClaudeCode } from "./claudeDetect.js";
import { applyHarnessConfig, defaultConfigPathForHarness, previewHarnessConfig } from "./clients.js";
import { appendLog } from "./state.js";
import {
  appDataDir,
  commandDisplay,
  defaultClaudeCodeWorkdir,
  defaultCodexHomePath,
  detectCodexExecutablePath,
  logPath,
  secretsPath,
  statePath,
} from "./paths.js";
import { probeBundledMcp, type ProbeMode } from "./probe.js";
import { ensureDefaultInstall, getEffectiveEnv, getMcpProfileStatus, maskEnv, readState, updateMcpProfile } from "./state.js";
import { ensureMcpShim, isElectronPackaged, mcpShimPath, packagedRuntime } from "./shim.js";
import { appPackageInfo, checkForUpdate, stageUpdateAsset } from "./update.js";
import { setupRemoteCcServer } from "./remoteCc.js";

export interface HarnessApiRequest {
  path: string;
  method?: string;
  body?: unknown;
}

export interface HarnessTargetSummary {
  id: string;
  name: string;
  status: "ready" | "reserved";
  configured?: boolean;
  description: string;
  configPage?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") out[key] = item;
    else if (typeof item === "boolean") out[key] = item ? "true" : "false";
    else if (item != null) out[key] = String(item);
  }
  return out;
}

function normalizeCcMcpEnv(mcpId: string, env: Record<string, string>): Record<string, string> {
  if (mcpId !== "cc-mcp") return env;
  const mode = String(env.CC_MCP_SERVER_MODE || "").trim().toLowerCase();
  if (mode !== "remote") return env;

  const unifiedWorkdir = String(env.CC_CLAUDE_WORKDIR || "").trim();
  if (unifiedWorkdir) env.CC_MCP_REMOTE_WORKDIR = unifiedWorkdir;
  else if (!String(env.CC_MCP_REMOTE_WORKDIR || "").trim()) env.CC_MCP_REMOTE_WORKDIR = "~/";
  env.CC_CLAUDE_WORKDIR = "";
  return env;
}

function commandPartsForPreview(preview: { entry: unknown }): string[] {
  const entry = asRecord(preview.entry);
  if (Array.isArray(entry.command)) {
    return entry.command.filter((item): item is string => typeof item === "string");
  }
  if (typeof entry.command === "string") {
    const args = Array.isArray(entry.args)
      ? entry.args.filter((item): item is string => typeof item === "string")
      : [];
    return [entry.command, ...args];
  }
  return [];
}

const READY_HARNESS_IDS: HarnessId[] = ["opencode", "hermes", "codex", "claude-code"];

export function supportedHarnesses(clients: Record<string, { enabled?: boolean }> = {}): HarnessTargetSummary[] {
  const configured = (harnessId: HarnessId) => Object.entries(clients).some(([key, value]) => key.startsWith(`${harnessId}:`) && value?.enabled);
  return [
    {
      id: "opencode",
      name: "OpenCode",
      status: "ready",
      configured: configured("opencode"),
      description: configured("opencode")
        ? "OpenCode global MCP config has been written. Reopen OpenCode to use it."
        : "Write bundled MCP entries into the global OpenCode config.",
      configPage: "configure",
    },
    {
      id: "hermes",
      name: "Hermes",
      status: "ready",
      configured: configured("hermes"),
      description: configured("hermes")
        ? "Hermes MCP config has been written."
        : "Write supported MCP entries into ~/.hermes/config.yaml.",
      configPage: "configure",
    },
    {
      id: "codex",
      name: "Codex",
      status: "ready",
      configured: configured("codex"),
      description: configured("codex")
        ? "Codex MCP config has been written."
        : "Write supported MCP entries into Codex config.toml.",
      configPage: "configure",
    },
    {
      id: "claude-code",
      name: "Claude Code (主 Harness)",
      status: "ready",
      configured: configured("claude-code"),
      description: configured("claude-code")
        ? "Claude Code user MCP config has been written for primary-harness use."
        : "Write supported MCP entries into Claude Code user config when Claude Code is the primary harness.",
      configPage: "configure",
    },
    {
      id: "cursor",
      name: "Cursor",
      status: "reserved",
      description: "Adapter reserved for a future release.",
    },
    {
      id: "vscode",
      name: "VS Code",
      status: "reserved",
      description: "Adapter reserved for a future release.",
    },
  ];
}

function readyHarnessFromPath(pathname: string, action: "preview" | "apply"): HarnessId | undefined {
  const match = pathname.match(/^\/api\/harness\/([^/]+)\/([^/]+)$/);
  if (!match || match[2] !== action) return undefined;
  const harnessId = match[1] as HarnessId;
  return READY_HARNESS_IDS.includes(harnessId) ? harnessId : undefined;
}

function assertMcpSupportsHarness(mcpId: string, harnessId: HarnessId): void {
  const entry = getCatalogEntry(mcpId);
  if (!entry) throw new Error(`Unknown catalog MCP: ${mcpId}`);
  if (!entry.supportedHarnesses.includes(harnessId)) {
    throw new Error(`${entry.displayName} does not support ${harnessId}.`);
  }
}

export async function handleHarnessApi(request: HarnessApiRequest): Promise<unknown> {
  await ensureDefaultInstall();

  const method = (request.method || "GET").toUpperCase();
  const url = new URL(request.path || "/", "mcp-harness://local");

  if (method === "GET" && url.pathname === "/api/status") {
    const state = await readState();
    const packageInfo = await appPackageInfo();
    const profileStatuses = await Promise.all(
      Object.values(state.installed).map((item) => getMcpProfileStatus(item.id, item.profileId)),
    );
    const runtime = packagedRuntime();
    let shimPath: string | null = null;
    if (isElectronPackaged()) {
      try {
        shimPath = await ensureMcpShim();
      } catch (error) {
        shimPath = mcpShimPath();
      }
    }
    return {
      app: "MCP Harness",
      version: packageInfo.version,
      repository: packageInfo.repo,
      releasePageUrl: packageInfo.releasePageUrl,
      latestReleaseUrl: `https://github.com/${packageInfo.repo}/releases/latest`,
      mode: "desktop",
      packaged: isElectronPackaged(),
      installDir: runtime?.installDir || null,
      shimPath,
      dataDir: appDataDir(),
      defaultClaudeCodeWorkdir: defaultClaudeCodeWorkdir(),
      statePath: statePath(),
      secretsPath: secretsPath(),
      logPath: logPath(),
      opencodeConfigPath: defaultConfigPathForHarness("opencode"),
      hermesConfigPath: defaultConfigPathForHarness("hermes"),
      codexHomePath: defaultCodexHomePath(),
      codexConfigPath: defaultConfigPathForHarness("codex"),
      codexExecutablePath: detectCodexExecutablePath(),
      claudeCodeConfigPath: defaultConfigPathForHarness("claude-code"),
      installedCount: profileStatuses.filter((item) => item.configured).length,
      configuredMcpCount: profileStatuses.filter((item) => item.configured).length,
      availableMcpCount: Object.keys(state.installed).length,
      supportedHarnesses: supportedHarnesses(state.clients),
    };
  }

  if (method === "GET" && url.pathname === "/api/update/check") {
    return checkForUpdate({ force: url.searchParams.get("force") === "1" });
  }

  if (method === "POST" && url.pathname === "/api/update/install") {
    const body = asRecord(request.body);
    const requestedUrl = typeof body.url === "string" ? body.url.trim() : "";
    const check = await checkForUpdate({});
    const assetUrl = requestedUrl || check.asset?.url || "";
    if (!check.ok) {
      return { ok: false, error: check.error || "无法获取最新版本信息。" };
    }
    if (!check.updateAvailable) {
      return { ok: false, error: "当前已经是最新版本，无需更新。" };
    }
    if (!assetUrl) {
      return { ok: false, error: "未找到当前平台的安装包，请到发布页手动下载。" };
    }
    const staged = await stageUpdateAsset(assetUrl, check.asset?.name || "update.bin");
    if (!staged.ok) {
      return { ok: false, error: staged.error };
    }
    return { ok: true, filePath: staged.filePath, fileName: staged.fileName };
  }

  if (method === "GET" && url.pathname === "/api/catalog") {
    return { catalog: BUILTIN_CATALOG };
  }

  if (method === "GET" && url.pathname === "/api/installed") {
    const state = await readState();
    const installed = [];
    for (const item of Object.values(state.installed)) {
      const env = await getEffectiveEnv(item.id, item.profileId);
      const profileStatus = await getMcpProfileStatus(item.id, item.profileId);
      installed.push({
        ...item,
        ...profileStatus,
        command: commandDisplay(commandPartsForPreview(await previewHarnessConfig({ harnessId: "opencode", mcpId: item.id, profileId: item.profileId }))),
        effectiveEnv: maskEnv(env, item.secretKeys),
      });
    }
    return { installed, clients: state.clients };
  }

  const previewHarnessId = method === "GET" ? readyHarnessFromPath(url.pathname, "preview") : undefined;
  if (previewHarnessId) {
    const mcpId = url.searchParams.get("mcpId") || "minimax-bridge";
    const profileId = url.searchParams.get("profileId") || "default";
    assertMcpSupportsHarness(mcpId, previewHarnessId);
    return previewHarnessConfig({ harnessId: previewHarnessId, mcpId, profileId });
  }

  if (method === "POST" && url.pathname === "/api/catalog/install") {
    const body = asRecord(request.body);
    const mcpId = typeof body.mcpId === "string" ? body.mcpId : "minimax-bridge";
    const entry = getCatalogEntry(mcpId);
    if (!entry) throw new Error(`Unknown catalog MCP: ${mcpId}`);
    if (entry.status === "coming_soon") {
      return { installed: false, reason: "This catalog item is reserved for a future installer.", entry };
    }
    const state = await ensureDefaultInstall();
    return { installed: true, entry, state: state.installed[mcpId] };
  }

  if (method === "POST" && url.pathname === "/api/mcp/profile") {
    const body = asRecord(request.body);
    const mcpId = typeof body.mcpId === "string" ? body.mcpId : "minimax-bridge";
    const profileId = typeof body.profileId === "string" ? body.profileId : "default";
    const env = normalizeCcMcpEnv(mcpId, stringRecord(body.env));
    const secrets = stringRecord(body.secrets);
    const installed = await updateMcpProfile({ mcpId, profileId, env, secrets });
    const effectiveEnv = await getEffectiveEnv(mcpId, profileId);
    return { ok: true, installed, effectiveEnv: maskEnv(effectiveEnv, installed.secretKeys) };
  }

  if (method === "POST" && url.pathname === "/api/mcp/test") {
    const body = asRecord(request.body);
    const mcpId = typeof body.mcpId === "string" ? body.mcpId : "minimax-bridge";
    const profileId = typeof body.profileId === "string" ? body.profileId : "default";
    const mode: ProbeMode = body.mode === "api" ? "api" : "startup";
    return probeBundledMcp(mode, mcpId, profileId);
  }

  if (method === "POST" && url.pathname === "/api/cc/detect") {
    const body = asRecord(request.body);
    return detectClaudeCode({ env: stringRecord(body.env) });
  }

  if (method === "POST" && url.pathname === "/api/cc/remote/setup") {
    const body = asRecord(request.body);
    const env = normalizeCcMcpEnv("cc-mcp", stringRecord(body.env));
    const secrets = stringRecord(body.secrets);
    const autoApply = body.autoApply !== false;
    await updateMcpProfile({ mcpId: "cc-mcp", profileId: "default", env, secrets });
    const effectiveEnv = await getEffectiveEnv("cc-mcp", "default");
    const result = await setupRemoteCcServer(effectiveEnv);
    if (result.resolvedEnv) {
      await updateMcpProfile({ mcpId: "cc-mcp", profileId: "default", env: result.resolvedEnv });
    }

    const applyResults: Array<{ harnessId: HarnessId; ok: boolean; error?: string; configPath?: string }> = [];
    if (result.ok && autoApply) {
      const entry = getCatalogEntry("cc-mcp");
      const targets = (entry?.supportedHarnesses || []).filter((id): id is HarnessId => READY_HARNESS_IDS.includes(id));
      for (const harnessId of targets) {
        try {
          const applied = await applyHarnessConfig({ harnessId, mcpId: "cc-mcp", profileId: "default", enabled: true });
          applyResults.push({ harnessId, ok: true, configPath: applied.configPath });
          await appendLog(`Auto-applied cc-mcp/${"default"} (remote) to ${harnessId} config ${applied.configPath}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          applyResults.push({ harnessId, ok: false, error: message });
          await appendLog(`Failed to auto-apply cc-mcp to ${harnessId}: ${message}`);
        }
      }
    }

    return {
      ...result,
      resolvedEnv: result.resolvedEnv ? maskEnv(result.resolvedEnv, ["CC_MCP_REMOTE_PASSWORD"]) : undefined,
      harnessApplies: applyResults,
    };
  }

  const applyHarnessId = method === "POST" ? readyHarnessFromPath(url.pathname, "apply") : undefined;
  if (applyHarnessId) {
    const body = asRecord(request.body);
    const mcpId = typeof body.mcpId === "string" ? body.mcpId : "minimax-bridge";
    const profileId = typeof body.profileId === "string" ? body.profileId : "default";
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    const env = normalizeCcMcpEnv(mcpId, stringRecord(body.env));
    const secrets = stringRecord(body.secrets);
    assertMcpSupportsHarness(mcpId, applyHarnessId);
    if (Object.keys(env).length || Object.keys(secrets).length) {
      await updateMcpProfile({ mcpId, profileId, env, secrets });
    }
    const result = await applyHarnessConfig({ harnessId: applyHarnessId, mcpId, profileId, enabled });
    return { ok: true, ...result };
  }

  if (method === "POST" && url.pathname === "/api/runtime/shim") {
    if (!isElectronPackaged()) {
      return { ok: false, error: "Shim is only used in the packaged desktop build." };
    }
    const shimPath = await ensureMcpShim();
    return { ok: true, shimPath };
  }

  return undefined;
}
