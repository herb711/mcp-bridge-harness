import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { artifactTypeFromMime, mimeFromExt, type ArtifactDescriptor, type GalleryDescriptor } from "./artifacts.js";

type ContentBlock = CallToolResult["content"][number];
type ImageContentBlock = Extract<ContentBlock, { type: "image" }>;
type TextContentBlock = Extract<ContentBlock, { type: "text" }>;
type ImageDescriptor = ArtifactDescriptor & { type: "image" };

const IMAGE_PATH_PATTERNS = [
  /file:\/\/\/?[^\s"'<>]*?\.(?:png|jpe?g|webp|gif)/gi,
  /[A-Za-z]:[\\/][^\r\n"'<>|]*?\.(?:png|jpe?g|webp|gif)/gi,
  /(?:\/|\\\\)[^\r\n"'<>|]*?\.(?:png|jpe?g|webp|gif)/gi,
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isImageMime(mime: string | undefined): boolean {
  return (mime || "").split(";")[0]?.trim().toLowerCase().startsWith("image/") || false;
}

function isImagePath(filePath: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(filePath.split(/[?#]/, 1)[0] || filePath);
}

function normalizePathCandidate(candidate: string): string | undefined {
  let cleaned = candidate.trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[),.;]+$/g, "")
    .replace(/\\\\/g, "\\");

  if (!cleaned) return undefined;
  if (/^file:/i.test(cleaned)) {
    try {
      cleaned = fileURLToPath(cleaned);
    } catch {
      return undefined;
    }
  }

  if (!path.isAbsolute(cleaned)) return undefined;
  return path.resolve(cleaned);
}

function descriptorFromPath(filePath: string): ImageDescriptor | undefined {
  const normalizedPath = normalizePathCandidate(filePath);
  if (!normalizedPath || !isImagePath(normalizedPath)) return undefined;
  const mimeType = mimeFromExt(path.extname(normalizedPath));
  return {
    type: "image",
    mimeType,
    filename: path.basename(normalizedPath),
    path: normalizedPath,
    size: 0,
    source: "minimax",
  };
}

function descriptorFromRecord(record: Record<string, unknown>): ImageDescriptor | undefined {
  const filePath = getString(record.path) || getString(record.filePath) || getString(record.file_path) || getString(record.localPath);
  if (!filePath) return undefined;

  const normalizedPath = normalizePathCandidate(filePath);
  if (!normalizedPath) return undefined;

  const mimeType = getString(record.mimeType) || getString(record.mime) || mimeFromExt(path.extname(normalizedPath));
  const declaredType = getString(record.type);
  const inferredType = artifactTypeFromMime(mimeType);
  if (declaredType !== "image" && inferredType !== "image" && !isImagePath(normalizedPath)) return undefined;

  return {
    type: "image",
    mimeType: isImageMime(mimeType) ? mimeType : mimeFromExt(path.extname(normalizedPath)),
    filename: getString(record.filename) || path.basename(normalizedPath),
    path: normalizedPath,
    size: getNumber(record.size) ?? getNumber(record.size_bytes) ?? 0,
    source: getString(record.source) || "minimax",
    ...(getString(record.url) ? { url: getString(record.url) } : {}),
  };
}

function collectFromText(text: string, out: ImageDescriptor[]): void {
  try {
    collectImageDescriptors(JSON.parse(text), out);
    return;
  } catch {
    // Plain text fallback paths are handled by the regex pass below.
  }

  for (const pattern of IMAGE_PATH_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const descriptor = descriptorFromPath(match[0]);
      if (descriptor) out.push(descriptor);
    }
  }
}

function collectImageDescriptors(value: unknown, out: ImageDescriptor[], depth = 0): void {
  if (depth > 8 || value == null) return;

  if (typeof value === "string") {
    if (value.length > 4096 || !/\.(png|jpe?g|webp|gif)\b/i.test(value)) return;
    collectFromText(value, out);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectImageDescriptors(item, out, depth + 1);
    return;
  }

  const record = asRecord(value);
  if (!Object.keys(record).length) return;

  const descriptor = descriptorFromRecord(record);
  if (descriptor) out.push(descriptor);

  for (const nested of Object.values(record)) {
    collectImageDescriptors(nested, out, depth + 1);
  }
}

function dedupeDescriptors(descriptors: ImageDescriptor[]): ImageDescriptor[] {
  const seen = new Set<string>();
  const unique: ImageDescriptor[] = [];
  for (const descriptor of descriptors) {
    const key = descriptor.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(descriptor);
  }
  return unique;
}

async function hydrateImageDescriptor(descriptor: ImageDescriptor): Promise<{ descriptor: ImageDescriptor; content: ImageContentBlock }> {
  const stat = await fs.stat(descriptor.path);
  if (!stat.isFile()) throw new Error(`Image artifact is not a file: ${descriptor.path}`);
  const mimeType = isImageMime(descriptor.mimeType) ? descriptor.mimeType : mimeFromExt(path.extname(descriptor.path));
  if (!isImageMime(mimeType)) throw new Error(`Artifact is not an image: ${descriptor.path}`);

  const buffer = await fs.readFile(descriptor.path);
  const hydrated: ImageDescriptor = {
    ...descriptor,
    mimeType,
    filename: descriptor.filename || path.basename(descriptor.path),
    size: descriptor.size || stat.size,
  };

  return {
    descriptor: hydrated,
    content: {
      type: "image",
      data: buffer.toString("base64"),
      mimeType,
      _meta: { ...hydrated },
    },
  };
}

function imagePayload(descriptors: ImageDescriptor[]): ImageDescriptor | GalleryDescriptor {
  return descriptors.length === 1 ? descriptors[0] : { type: "gallery", items: descriptors };
}

function structuredPayload(descriptors: ImageDescriptor[]): Record<string, unknown> {
  return { ...imagePayload(descriptors) } as Record<string, unknown>;
}

function fallbackText(descriptors: ImageDescriptor[]): TextContentBlock {
  const paths = descriptors.map((descriptor) => descriptor.path).join("\n");
  return {
    type: "text",
    text: `Image saved to:\n${paths}`,
  };
}

export function isCallToolResult(value: unknown): value is CallToolResult {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { content?: unknown }).content));
}

export async function enhanceImageToolResult(result: CallToolResult, sourceValue?: unknown): Promise<CallToolResult> {
  if (result.content.some((content) => asRecord(content).type === "image")) return result;

  const descriptors: ImageDescriptor[] = [];
  if (sourceValue !== undefined) collectImageDescriptors(sourceValue, descriptors);
  collectImageDescriptors(result.structuredContent, descriptors);
  for (const content of result.content) {
    if (asRecord(content).type === "text") collectFromText((content as TextContentBlock).text, descriptors);
  }

  const unique = dedupeDescriptors(descriptors);
  if (!unique.length) return result;

  let hydrated: Awaited<ReturnType<typeof hydrateImageDescriptor>>[];
  try {
    hydrated = await Promise.all(unique.map((descriptor) => hydrateImageDescriptor(descriptor)));
  } catch {
    return result;
  }

  const hydratedDescriptors = hydrated.map((item) => item.descriptor);
  const hasTextFallback = result.content.some((content) => asRecord(content).type === "text");
  return {
    ...result,
    structuredContent: structuredPayload(hydratedDescriptors),
    content: [
      ...result.content,
      ...(hasTextFallback ? [] : [fallbackText(hydratedDescriptors)]),
      ...hydrated.map((item) => item.content),
    ],
  };
}

export async function toCallToolResult(toolName: string, value: unknown, isError = false): Promise<CallToolResult> {
  const result: CallToolResult = {
    isError,
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };

  if (!isError && toolName === "text_to_image") {
    return enhanceImageToolResult(result, value);
  }

  return result;
}
