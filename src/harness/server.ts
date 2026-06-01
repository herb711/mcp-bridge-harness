import http, { type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { appDataDir, webRootPath } from "./paths.js";
import { handleHarnessApi } from "./api.js";
import { ensureDefaultInstall } from "./state.js";

export interface StartHarnessServerOptions {
  port?: number;
  host?: string;
  open?: boolean;
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendText(res: ServerResponse, status: number, value: string, contentType = "text/plain; charset=utf-8"): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(value);
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > 2_000_000) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function requireToken(req: IncomingMessage, token: string): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  return req.headers["x-harness-token"] === token;
}

function openBrowser(url: string): void {
  const command = process.platform === "win32"
    ? "cmd"
    : process.platform === "darwin"
      ? "open"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

async function serveStatic(url: URL, res: ServerResponse, token: string): Promise<boolean> {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (pathname.startsWith("/api/")) return false;
  const root = webRootPath();
  const filePath = path.resolve(path.join(root, pathname.replace(/^\/+/, "")));
  if (!filePath.startsWith(path.resolve(root))) {
    sendText(res, 403, "Forbidden");
    return true;
  }
  try {
    let data = await fs.readFile(filePath);
    let contentType = contentTypeFor(filePath);
    if (path.basename(filePath) === "index.html") {
      contentType = "text/html; charset=utf-8";
      data = Buffer.from(data.toString("utf8").replace(/%HARNESS_TOKEN%/g, token), "utf8");
    }
    res.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
    res.end(data);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      sendText(res, 404, "Not found");
      return true;
    }
    throw error;
  }
}

export async function installHarness(): Promise<void> {
  await ensureDefaultInstall();
}

export async function startHarnessServer(options: StartHarnessServerOptions = {}): Promise<http.Server> {
  await installHarness();
  const token = crypto.randomBytes(18).toString("base64url");
  const host = options.host || "127.0.0.1";
  const requestedPort = options.port ?? 45321;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${requestedPort}`}`);
      if (url.pathname.startsWith("/api/")) {
        if (!requireToken(req, token)) {
          sendJson(res, 403, { error: "Invalid harness token." });
          return;
        }
        const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
        const value = await handleHarnessApi({ path: `${url.pathname}${url.search}`, method: req.method || "GET", body });
        if (value === undefined) sendJson(res, 404, { error: "Unknown API endpoint." });
        else sendJson(res, 200, value);
        return;
      }

      if (await serveStatic(url, res, token)) return;
      sendText(res, 404, "Not found");
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : requestedPort;
  const url = `http://${host}:${actualPort}/`;
  // eslint-disable-next-line no-console
  console.log(`MCP Harness legacy web server is running at ${url}`);
  // eslint-disable-next-line no-console
  console.log(`Local data: ${appDataDir()}`);
  if (options.open !== false) openBrowser(url);
  return server;
}
