import { BUILTIN_CATALOG, getCatalogEntry } from "./catalog.js";
import { appDataDir, commandDisplay, defaultOpenCodeConfigPath, logPath, secretsPath, statePath } from "./paths.js";
import { applyOpenCodeConfig, previewOpenCodeConfig } from "./opencode.js";
import { probeBundledMcp, type ProbeMode } from "./probe.js";
import { ensureDefaultInstall, getEffectiveEnv, maskEnv, readState, updateMcpProfile } from "./state.js";
import { ensureMcpShim, isElectronPackaged, mcpShimPath, packagedRuntime } from "./shim.js";

export interface HarnessApiRequest {
  path: string;
  method?: string;
  body?: unknown;
}

export interface HarnessTargetSummary {
  id: string;
  name: string;
  status: "ready" | "reserved";
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

export function supportedHarnesses(): HarnessTargetSummary[] {
  return [
    {
      id: "opencode",
      name: "OpenCode",
      status: "ready",
      description: "点击进入 OpenCode 配置页，一键写入 OpenCode 全局 MCP 配置。",
      configPage: "configure",
    },
    {
      id: "codex",
      name: "Codex",
      status: "reserved",
      description: "后续版本实现对应 Adapter。",
    },
    {
      id: "claude-code",
      name: "Claude Code",
      status: "reserved",
      description: "后续版本实现对应 Adapter。",
    },
    {
      id: "cursor",
      name: "Cursor",
      status: "reserved",
      description: "后续版本实现对应 Adapter。",
    },
    {
      id: "vscode",
      name: "VS Code",
      status: "reserved",
      description: "后续版本实现对应 Adapter。",
    },
  ];
}

export async function handleHarnessApi(request: HarnessApiRequest): Promise<unknown> {
  await ensureDefaultInstall();

  const method = (request.method || "GET").toUpperCase();
  const url = new URL(request.path || "/", "mcp-harness://local");

  if (method === "GET" && url.pathname === "/api/status") {
    const state = await readState();
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
      version: "0.2.0",
      mode: "desktop",
      packaged: isElectronPackaged(),
      installDir: runtime?.installDir || null,
      shimPath,
      dataDir: appDataDir(),
      statePath: statePath(),
      secretsPath: secretsPath(),
      logPath: logPath(),
      opencodeConfigPath: defaultOpenCodeConfigPath(),
      installedCount: Object.keys(state.installed).length,
      supportedHarnesses: supportedHarnesses(),
    };
  }

  if (method === "GET" && url.pathname === "/api/catalog") {
    return { catalog: BUILTIN_CATALOG };
  }

  if (method === "GET" && url.pathname === "/api/installed") {
    const state = await readState();
    const installed = [];
    for (const item of Object.values(state.installed)) {
      const env = await getEffectiveEnv(item.id, item.profileId);
      installed.push({
        ...item,
        command: commandDisplay((await previewOpenCodeConfig({ mcpId: item.id, profileId: item.profileId })).entry.command),
        effectiveEnv: maskEnv(env, item.secretKeys),
      });
    }
    return { installed, clients: state.clients };
  }

  if (method === "GET" && url.pathname === "/api/harness/opencode/preview") {
    const mcpId = url.searchParams.get("mcpId") || "minimax-bridge";
    const profileId = url.searchParams.get("profileId") || "default";
    return previewOpenCodeConfig({ mcpId, profileId });
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
    const env = stringRecord(body.env);
    const secrets = stringRecord(body.secrets);
    const installed = await updateMcpProfile({ mcpId, profileId, env, secrets });
    const effectiveEnv = await getEffectiveEnv(mcpId, profileId);
    return { ok: true, installed, effectiveEnv: maskEnv(effectiveEnv, installed.secretKeys) };
  }

  if (method === "POST" && url.pathname === "/api/mcp/test") {
    const body = asRecord(request.body);
    const mode: ProbeMode = body.mode === "api" ? "api" : "startup";
    return probeBundledMcp(mode);
  }

  if (method === "POST" && url.pathname === "/api/harness/opencode/apply") {
    const body = asRecord(request.body);
    const mcpId = typeof body.mcpId === "string" ? body.mcpId : "minimax-bridge";
    const profileId = typeof body.profileId === "string" ? body.profileId : "default";
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    const env = stringRecord(body.env);
    const secrets = stringRecord(body.secrets);
    if (Object.keys(env).length || Object.keys(secrets).length) {
      await updateMcpProfile({ mcpId, profileId, env, secrets });
    }
    const result = await applyOpenCodeConfig({ mcpId, profileId, enabled });
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
