import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO = "herb711/mcp-bridge-harness";
const GITHUB_API_ROOT = "https://api.github.com/repos";
const UPDATE_CACHE_MS = 10 * 60 * 1000;

interface PackageJson {
  version?: unknown;
  homepage?: unknown;
  repository?: unknown;
}

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  name?: unknown;
  published_at?: unknown;
  body?: unknown;
  assets?: GitHubReleaseAsset[];
}

interface UpdateManifestAsset {
  upstreamPlatform?: unknown;
  asset?: unknown;
  url?: unknown;
  sha256?: unknown;
  size?: unknown;
}

interface UpdateManifest {
  version?: unknown;
  tag?: unknown;
  releaseDate?: unknown;
  notes?: unknown;
  platforms?: Record<string, UpdateManifestAsset[]>;
}

export interface AppPackageInfo {
  version: string;
  repo: string;
  releasePageUrl: string;
}

export interface UpdateAssetInfo {
  name: string;
  url: string;
  size: number | null;
  sha256?: string;
  platform?: string;
}

export interface UpdateCheckResult {
  ok: boolean;
  currentVersion: string;
  latestVersion: string | null;
  latestTag: string | null;
  updateAvailable: boolean;
  releaseUrl: string;
  releaseName: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
  asset: UpdateAssetInfo | null;
  checkedAt: string;
  source: "github-release" | "latest-json" | null;
  error?: string;
}

let packageInfoPromise: Promise<AppPackageInfo> | undefined;
let updateCache: { expiresAt: number; result: UpdateCheckResult } | undefined;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function repoFromText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i);
  if (!match) return undefined;
  return `${match[1]}/${match[2].replace(/\.git$/i, "")}`;
}

function repoFromPackage(pkg: PackageJson): string {
  const repository = pkg.repository;
  if (typeof repository === "string") {
    return repoFromText(repository) || DEFAULT_REPO;
  }
  if (repository && typeof repository === "object" && "url" in repository) {
    return repoFromText(asString((repository as { url?: unknown }).url)) || DEFAULT_REPO;
  }
  return repoFromText(asString(pkg.homepage)) || DEFAULT_REPO;
}

export async function appPackageInfo(): Promise<AppPackageInfo> {
  if (!packageInfoPromise) {
    packageInfoPromise = (async () => {
      const packagePath = fileURLToPath(new URL("../../package.json", import.meta.url));
      const pkg = JSON.parse(await fs.readFile(packagePath, "utf8")) as PackageJson;
      const repo = repoFromPackage(pkg);
      return {
        version: asString(pkg.version) || "0.0.0",
        repo,
        releasePageUrl: `https://github.com/${repo}/releases`,
      };
    })();
  }
  return packageInfoPromise;
}

function normalizeVersion(value: string | null | undefined): string {
  return String(value || "").trim().replace(/^v/i, "");
}

function parseVersion(value: string): { parts: number[]; prerelease: string } {
  const normalized = normalizeVersion(value).split("+")[0] || "0";
  const [main, prerelease = ""] = normalized.split("-", 2);
  const parts = main.split(".").map((part) => {
    const parsed = Number(part.replace(/\D.*$/, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  });
  while (parts.length < 3) parts.push(0);
  return { parts, prerelease };
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (left.parts[i] !== right.parts[i]) return left.parts[i] > right.parts[i] ? 1 : -1;
  }
  if (left.prerelease && !right.prerelease) return -1;
  if (!left.prerelease && right.prerelease) return 1;
  if (left.prerelease === right.prerelease) return 0;
  return left.prerelease > right.prerelease ? 1 : -1;
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "accept": "application/vnd.github+json",
      "user-agent": "mcp-harness-update-checker",
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Update check failed: ${response.status} ${response.statusText}`);
  }
  return await response.json() as T;
}

function platformAliases(): string[] {
  const arch = process.arch === "x64" || process.arch === "arm64" ? process.arch : "x64";
  if (process.platform === "win32") return [`windows-${arch}`, `win-${arch}`, `${arch}-setup`, `${arch}-portable`];
  if (process.platform === "darwin") return [`macos-${arch}`, `mac-${arch}`, `darwin-${arch}`, `${arch}-dmg`];
  if (process.platform === "linux") return [`linux-${arch}`, `${arch}-appimage`];
  return [process.platform, `${process.platform}-${arch}`];
}

function assetScore(name: string): number {
  const lower = name.toLowerCase();
  if (process.platform === "win32") {
    if (lower.endsWith(".exe") && lower.includes("setup")) return 100;
    if (lower.endsWith(".exe") && lower.includes("portable")) return 80;
  }
  if (process.platform === "darwin") {
    if (lower.endsWith(".dmg")) return 100;
    if (lower.endsWith(".zip")) return 70;
  }
  if (process.platform === "linux") {
    if (lower.endsWith(".appimage")) return 100;
  }
  return 1;
}

function preferredAsset<T extends { name: string }>(assets: T[]): T | null {
  if (!assets.length) return null;
  return [...assets].sort((a, b) => assetScore(b.name) - assetScore(a.name) || a.name.localeCompare(b.name))[0] || null;
}

function manifestAsset(manifest: UpdateManifest): UpdateAssetInfo | null {
  const platforms = manifest.platforms || {};
  const aliases = platformAliases();
  const candidates: UpdateAssetInfo[] = [];
  for (const alias of aliases) {
    for (const item of platforms[alias] || []) {
      const name = asString(item.asset);
      const url = asString(item.url);
      if (!name || !url) continue;
      candidates.push({
        name,
        url,
        size: asNumber(item.size),
        sha256: asString(item.sha256),
        platform: alias,
      });
    }
  }
  return preferredAsset(candidates);
}

function releaseAsset(release: GitHubRelease): UpdateAssetInfo | null {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const aliases = platformAliases().map((item) => item.toLowerCase());
  const candidates: UpdateAssetInfo[] = [];
  for (const item of assets) {
    const name = asString(item.name);
    const url = asString(item.browser_download_url);
    if (!name || !url) continue;
    const lower = name.toLowerCase();
    if (lower.endsWith(".blockmap") || lower.endsWith(".yml") || lower.endsWith(".json")) continue;
    const matchesPlatform = aliases.some((alias) => lower.includes(alias))
      || (process.platform === "win32" && lower.endsWith(".exe"))
      || (process.platform === "darwin" && (lower.endsWith(".dmg") || lower.endsWith(".zip")))
      || (process.platform === "linux" && lower.endsWith(".appimage"));
    if (!matchesPlatform) continue;
    candidates.push({ name, url, size: asNumber(item.size) });
  }
  return preferredAsset(candidates);
}

async function readManifestFromRelease(release: GitHubRelease): Promise<UpdateManifest | null> {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((item) => asString(item.name)?.toLowerCase() === "latest.json");
  const url = asString(asset?.browser_download_url);
  if (!url) return null;
  return await fetchJson<UpdateManifest>(url, { accept: "application/json" });
}

function resultFromRelease(
  currentVersion: string,
  release: GitHubRelease,
  manifest: UpdateManifest | null,
): UpdateCheckResult {
  const manifestVersion = asString(manifest?.version);
  const latestTag = asString(manifest?.tag) || asString(release.tag_name) || null;
  const latestVersion = manifestVersion || normalizeVersion(latestTag || "");
  const releaseUrl = asString(release.html_url) || "";
  const asset = manifest ? manifestAsset(manifest) || releaseAsset(release) : releaseAsset(release);
  return {
    ok: true,
    currentVersion,
    latestVersion: latestVersion || null,
    latestTag,
    updateAvailable: latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false,
    releaseUrl,
    releaseName: asString(release.name) || latestTag,
    releaseDate: asString(manifest?.releaseDate) || asString(release.published_at) || null,
    releaseNotes: asString(manifest?.notes) || asString(release.body) || null,
    asset,
    checkedAt: new Date().toISOString(),
    source: manifest ? "latest-json" : "github-release",
  };
}

export async function checkForUpdate(options: { force?: boolean } = {}): Promise<UpdateCheckResult> {
  const now = Date.now();
  if (!options.force && updateCache && updateCache.expiresAt > now) return updateCache.result;

  const pkg = await appPackageInfo();
  const latestApiUrl = `${GITHUB_API_ROOT}/${pkg.repo}/releases/latest`;
  let result: UpdateCheckResult;
  try {
    const release = await fetchJson<GitHubRelease>(latestApiUrl);
    const manifest = await readManifestFromRelease(release).catch(() => null);
    result = resultFromRelease(pkg.version, release, manifest);
  } catch (error) {
    result = {
      ok: false,
      currentVersion: pkg.version,
      latestVersion: null,
      latestTag: null,
      updateAvailable: false,
      releaseUrl: pkg.releasePageUrl,
      releaseName: null,
      releaseDate: null,
      releaseNotes: null,
      asset: null,
      checkedAt: new Date().toISOString(),
      source: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  updateCache = { expiresAt: now + UPDATE_CACHE_MS, result };
  return result;
}
