import path from "node:path";

export interface AgnesConfig {
  apiKey: string;
  apiHost: string;
  basePath: string;
  defaultPollIntervalSeconds: number;
  defaultMaxWaitSeconds: number;
}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeHost(host: string): string {
  return host.replace(/\/+$/g, "");
}

export function loadAgnesConfig(): AgnesConfig {
  return {
    apiKey: process.env.AGNES_API_KEY || "",
    apiHost: normalizeHost(process.env.AGNES_API_HOST || "https://apihub.agnes-ai.com"),
    basePath: path.resolve(process.env.AGNES_MCP_BASE_PATH || "./outputs/agnes"),
    defaultPollIntervalSeconds: numberFromEnv("AGNES_POLL_INTERVAL_SECONDS", 10),
    defaultMaxWaitSeconds: numberFromEnv("AGNES_MAX_WAIT_SECONDS", 900),
  };
}
