import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { UserInputError } from "./errors.js";

export interface Artifact {
  path: string;
  mime: string;
  size_bytes: number;
  url?: string;
}

export interface ArtifactDescriptor {
  type: "image" | "audio" | "video" | "json" | "text" | "file";
  mimeType: string;
  filename: string;
  path: string;
  size: number;
  source: string;
  url?: string;
}

export interface GalleryDescriptor {
  type: "gallery";
  items: ArtifactDescriptor[];
}

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  pcm: "audio/L16",
  mp4: "video/mp4",
  mov: "video/quicktime",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  json: "application/json",
  txt: "text/plain",
};

export function extensionFromMime(mime: string | null | undefined, fallback: string): string {
  if (!mime) return fallback;
  const normalized = mime.split(";")[0]?.trim().toLowerCase();
  switch (normalized) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/flac":
      return "flac";
    case "video/mp4":
      return "mp4";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return fallback;
  }
}

export function mimeFromExt(ext: string): string {
  return MIME_BY_EXT[ext.replace(/^\./, "").toLowerCase()] || "application/octet-stream";
}

export function artifactTypeFromMime(mime: string | undefined): ArtifactDescriptor["type"] {
  const normalized = (mime || "").split(";")[0]?.trim().toLowerCase() || "";
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("video/")) return "video";
  if (normalized === "application/json") return "json";
  if (normalized.startsWith("text/")) return "text";
  return "file";
}

export function describeArtifact(artifact: Artifact, source = "minimax"): ArtifactDescriptor {
  const filePath = path.resolve(artifact.path);
  const mimeType = artifact.mime || mimeFromExt(path.extname(filePath));
  return {
    type: artifactTypeFromMime(mimeType),
    mimeType,
    filename: path.basename(filePath),
    path: filePath,
    size: artifact.size_bytes,
    source,
    ...(artifact.url ? { url: artifact.url } : {}),
  };
}

export function describeArtifacts(artifacts: Artifact[], source = "minimax"): ArtifactDescriptor | GalleryDescriptor | undefined {
  const items = artifacts.map((artifact) => describeArtifact(artifact, source));
  if (items.length === 0) return undefined;
  if (items.length === 1) return items[0];
  return { type: "gallery", items };
}

export function safeExt(ext: string | undefined, fallback: string): string {
  const raw = (ext || fallback).replace(/^\./, "").toLowerCase();
  return /^[a-z0-9]+$/.test(raw) ? raw : fallback;
}

export function safeFilePrefix(prefix: string | undefined, fallback: string): string {
  const raw = (prefix || fallback).replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
  return raw || fallback;
}

export class ArtifactStore {
  constructor(public readonly basePath: string) {}

  async ensureBasePath(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  resolveDirectory(outputDirectory: unknown, subdir: string): string {
    const requested = typeof outputDirectory === "string" && outputDirectory.trim()
      ? outputDirectory.trim()
      : path.join(this.basePath, subdir);
    return path.resolve(requested);
  }

  private makeName(prefix: string, ext: string): string {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const nonce = crypto.randomBytes(4).toString("hex");
    return `${prefix}_${stamp}_${nonce}.${safeExt(ext, "bin")}`;
  }

  async writeBuffer(options: {
    data: Buffer | Uint8Array;
    subdir: string;
    outputDirectory?: unknown;
    prefix?: string;
    ext?: string;
    mime?: string;
    url?: string;
  }): Promise<Artifact> {
    const ext = safeExt(options.ext, extensionFromMime(options.mime, "bin"));
    const dir = this.resolveDirectory(options.outputDirectory, options.subdir);
    await fs.mkdir(dir, { recursive: true });
    const fileName = this.makeName(safeFilePrefix(options.prefix, options.subdir), ext);
    const filePath = path.join(dir, fileName);
    const buffer = Buffer.isBuffer(options.data) ? options.data : Buffer.from(options.data);
    await fs.writeFile(filePath, buffer);
    return {
      path: filePath,
      mime: options.mime || mimeFromExt(ext),
      size_bytes: buffer.byteLength,
      url: options.url,
    };
  }

  async writeJson(options: {
    data: unknown;
    subdir: string;
    outputDirectory?: unknown;
    prefix?: string;
  }): Promise<Artifact> {
    const buffer = Buffer.from(JSON.stringify(options.data, null, 2), "utf8");
    return this.writeBuffer({
      data: buffer,
      subdir: options.subdir,
      outputDirectory: options.outputDirectory,
      prefix: options.prefix,
      ext: "json",
      mime: "application/json",
    });
  }

  async writeBase64(options: {
    base64: string;
    subdir: string;
    outputDirectory?: unknown;
    prefix?: string;
    ext?: string;
    mime?: string;
  }): Promise<Artifact> {
    const cleaned = options.base64.includes(",") ? options.base64.split(",").pop() || "" : options.base64;
    if (!cleaned) throw new UserInputError("Empty base64 payload");
    return this.writeBuffer({
      data: Buffer.from(cleaned, "base64"),
      subdir: options.subdir,
      outputDirectory: options.outputDirectory,
      prefix: options.prefix,
      ext: options.ext,
      mime: options.mime,
    });
  }
}
