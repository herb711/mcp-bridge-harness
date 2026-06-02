import path from "node:path";
import { ArtifactStore, describeArtifacts, extensionFromMime, mimeFromExt, type Artifact } from "./artifacts.js";
import type { AgnesConfig } from "./agnesConfig.js";
import { AgnesApiError, UserInputError } from "./errors.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getInteger(value: unknown, fallback: number): number {
  return Math.trunc(getNumber(value, fallback));
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function getStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
  const single = getString(value);
  return single ? [single] : [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function looksLikeSuccess(status: unknown): boolean {
  const normalized = String(status || "").toLowerCase();
  return ["success", "succeeded", "completed", "complete", "done", "finished"].includes(normalized);
}

function looksLikeFailure(status: unknown): boolean {
  const normalized = String(status || "").toLowerCase();
  return ["fail", "failed", "failure", "error", "cancelled", "canceled"].includes(normalized);
}

function collectUrlValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectUrlValues(item, out);
  } else if (value && typeof value === "object") {
    for (const nested of Object.values(value)) collectUrlValues(nested, out);
  }
  return [...new Set(out)];
}

function collectBase64Values(value: unknown, out: string[] = [], parentKey = ""): string[] {
  if (typeof value === "string") {
    const key = parentKey.toLowerCase();
    const shouldCollect = key.includes("b64") || key.includes("base64") || key === "image";
    if (shouldCollect && !/^https?:\/\//i.test(value) && value.length > 100) out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectBase64Values(item, out, parentKey);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) collectBase64Values(nested, out, key);
  }
  return [...new Set(out)];
}

function fileNameFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const base = path.basename(parsed.pathname);
    return base && base.includes(".") ? base : undefined;
  } catch {
    return undefined;
  }
}

async function responseTextOrJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class AgnesHttpClient {
  constructor(
    private readonly config: AgnesConfig,
    private readonly store: ArtifactStore,
  ) {}

  private api(pathname: string): string {
    const prefix = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return `${this.config.apiHost}${prefix}`;
  }

  private requireApiKey(): string {
    if (!this.config.apiKey) {
      throw new UserInputError("Missing AGNES_API_KEY. Set it in the MCP server environment.");
    }
    return this.config.apiKey;
  }

  private authHeaders(extra: HeadersInit = {}): HeadersInit {
    return {
      Authorization: `Bearer ${this.requireApiKey()}`,
      ...extra,
    };
  }

  private async jsonRequest(pathname: string, options: { method?: string; body?: unknown; headers?: HeadersInit } = {}): Promise<unknown> {
    const headers: HeadersInit = {
      ...this.authHeaders(),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    };
    const response = await fetch(this.api(pathname), {
      method: options.method || (options.body === undefined ? "GET" : "POST"),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const parsed = await responseTextOrJson(response);
    if (!response.ok) {
      throw new AgnesApiError(`Agnes API request failed: ${response.status} ${response.statusText}`, {
        status: response.status,
        responseBody: parsed,
      });
    }
    const error = asRecord(asRecord(parsed).error);
    const message = firstString(error.message, asRecord(parsed).message);
    if (Object.keys(error).length && message) {
      throw new AgnesApiError(`Agnes API error: ${message}`, { responseBody: parsed });
    }
    return parsed;
  }

  private async bytesRequest(url: string, options: { auth?: boolean } = {}): Promise<{ buffer: Buffer; mime: string | undefined }> {
    const response = await fetch(url, {
      headers: options.auth === false ? undefined : this.authHeaders(),
    });
    if (!response.ok) {
      const body = await responseTextOrJson(response);
      throw new AgnesApiError(`Agnes download failed: ${response.status} ${response.statusText}`, {
        status: response.status,
        responseBody: body,
      });
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mime: response.headers.get("content-type") || undefined,
    };
  }

  private async downloadUrlAsArtifact(url: string, options: { subdir: string; outputDirectory?: unknown; prefix?: string; ext?: string; auth?: boolean }): Promise<Artifact> {
    const { buffer, mime } = await this.bytesRequest(url, { auth: options.auth });
    const extFromUrl = path.extname(fileNameFromUrl(url) || "").replace(/^\./, "");
    return this.store.writeBuffer({
      data: buffer,
      subdir: options.subdir,
      outputDirectory: options.outputDirectory,
      prefix: options.prefix,
      ext: options.ext || extensionFromMime(mime, extFromUrl || "bin"),
      mime: mime || mimeFromExt(options.ext || extFromUrl || "bin"),
      url,
    });
  }

  private statusOf(raw: unknown): unknown {
    const root = asRecord(raw);
    const data = asRecord(root.data);
    return root.status ?? root.task_status ?? root.state ?? data.status ?? data.task_status ?? data.state;
  }

  private taskIdOf(raw: unknown): string | undefined {
    const root = asRecord(raw);
    const data = asRecord(root.data);
    return firstString(root.id, root.task_id, data.id, data.task_id);
  }

  private videoUrlOf(raw: unknown): string | undefined {
    const root = asRecord(raw);
    const data = asRecord(root.data);
    return firstString(root.video_url, data.video_url, asRecord(root.video).url, asRecord(data.video).url)
      || collectUrlValues(raw).find((url) => /\.(mp4|mov|webm)(\?|$)/i.test(url));
  }

  private async poll<T>(options: {
    once: () => Promise<T>;
    isDone: (value: T) => boolean;
    isFail: (value: T) => boolean;
    pollUntilDone: boolean;
    intervalSeconds: number;
    maxWaitSeconds: number;
    failureMessage: (value: T) => string;
  }): Promise<T> {
    const started = Date.now();
    while (true) {
      const value = await options.once();
      if (options.isDone(value)) return value;
      if (options.isFail(value)) throw new AgnesApiError(options.failureMessage(value), { responseBody: value });
      if (!options.pollUntilDone) return value;
      if ((Date.now() - started) / 1000 >= options.maxWaitSeconds) return value;
      await sleep(options.intervalSeconds * 1000);
    }
  }

  async image21Flash(args: unknown) {
    const input = asRecord(args);
    const prompt = getString(input.prompt);
    if (!prompt) throw new UserInputError("image_21_flash requires prompt");

    const imageInputs = [...getStringArray(input.image), ...getStringArray(input.images)];
    const extraBody = { ...asRecord(input.extra_body) };
    if (imageInputs.length) extraBody.image = imageInputs;
    extraBody.response_format ||= getString(input.response_format) || "url";

    const payload: Record<string, unknown> = {
      model: getString(input.model) || "agnes-image-2.1-flash",
      prompt,
      size: getString(input.size) || "1024x768",
      ...(Object.keys(extraBody).length ? { extra_body: extraBody } : {}),
    };

    const raw = await this.jsonRequest("/v1/images/generations", { method: "POST", body: payload });
    const urls = collectUrlValues(raw);
    const base64Images = collectBase64Values(raw);
    const artifacts: Artifact[] = [];

    for (const [index, image] of base64Images.entries()) {
      artifacts.push(await this.store.writeBase64({
        base64: image,
        subdir: "images",
        outputDirectory: input.output_directory,
        prefix: `agnes_image_21_flash_${index + 1}`,
        ext: "png",
        mime: "image/png",
      }));
    }

    for (const [index, url] of urls.entries()) {
      try {
        artifacts.push(await this.downloadUrlAsArtifact(url, {
          subdir: "images",
          outputDirectory: input.output_directory,
          prefix: `agnes_image_21_flash_url_${index + 1}`,
          auth: false,
        }));
      } catch {
        // Keep the raw URL in the response even if it is signed, expired, or metadata-only.
      }
    }

    return {
      ok: true,
      backend: "agnes-http",
      tool: "image_21_flash",
      model: payload.model,
      ...(artifacts.length ? { artifact: describeArtifacts(artifacts, "agnes") } : {}),
      paths: artifacts.map((item) => item.path),
      urls,
      raw,
    };
  }

  async videoV20(args: unknown) {
    const input = asRecord(args);
    const prompt = getString(input.prompt);
    if (!prompt) throw new UserInputError("video_v20 requires prompt");

    const numFrames = getInteger(input.num_frames, 121);
    if (numFrames > 441 || (numFrames - 1) % 8 !== 0) {
      throw new UserInputError("video_v20 num_frames must be <= 441 and match 8n + 1, e.g. 81, 121, 161, 241, or 441.");
    }
    const frameRate = getNumber(input.frame_rate, 24);
    if (frameRate < 1 || frameRate > 60) throw new UserInputError("video_v20 frame_rate must be between 1 and 60.");

    const imageInputs = [...getStringArray(input.image), ...getStringArray(input.images)];
    const extraBody = { ...asRecord(input.extra_body) };
    const mode = getString(input.mode);

    const payload: Record<string, unknown> = {
      model: getString(input.model) || "agnes-video-v2.0",
      prompt,
      height: getInteger(input.height, 768),
      width: getInteger(input.width, 1152),
      num_frames: numFrames,
      frame_rate: frameRate,
      ...(input.num_inference_steps != null ? { num_inference_steps: getInteger(input.num_inference_steps, 0) } : {}),
      ...(input.seed != null ? { seed: getInteger(input.seed, 0) } : {}),
      ...(input.negative_prompt ? { negative_prompt: input.negative_prompt } : {}),
    };

    if (imageInputs.length === 1 && !mode) {
      payload.image = imageInputs[0];
    } else if (imageInputs.length) {
      extraBody.image = imageInputs;
    }
    if (mode) {
      if (imageInputs.length || mode === "keyframes") extraBody.mode = mode;
      else payload.mode = mode;
    }
    if (Object.keys(extraBody).length) payload.extra_body = extraBody;

    const raw = await this.jsonRequest("/v1/videos", { method: "POST", body: payload });
    const taskId = this.taskIdOf(raw);
    if (!taskId) throw new AgnesApiError("Agnes video task response did not include a task id", { responseBody: raw });

    if (getBoolean(input.async_mode, false)) {
      return { ok: true, backend: "agnes-http", tool: "video_v20", async: true, task_id: taskId, raw };
    }

    const result = await this.queryVideoV20({
      task_id: taskId,
      output_directory: input.output_directory,
      poll_until_done: true,
      poll_interval_seconds: input.poll_interval_seconds,
      max_wait_seconds: input.max_wait_seconds,
    });
    return { ok: true, backend: "agnes-http", tool: "video_v20", async: false, task_id: taskId, result, raw };
  }

  async queryVideoV20(args: unknown) {
    const input = asRecord(args);
    const taskId = getString(input.task_id);
    if (!taskId) throw new UserInputError("query_video_v20 requires task_id");

    const raw = await this.poll({
      once: () => this.jsonRequest(`/v1/videos/${encodeURIComponent(taskId)}`),
      isDone: (value) => looksLikeSuccess(this.statusOf(value)) || Boolean(this.videoUrlOf(value)),
      isFail: (value) => looksLikeFailure(this.statusOf(value)),
      pollUntilDone: getBoolean(input.poll_until_done, false),
      intervalSeconds: getNumber(input.poll_interval_seconds, this.config.defaultPollIntervalSeconds),
      maxWaitSeconds: getNumber(input.max_wait_seconds, this.config.defaultMaxWaitSeconds),
      failureMessage: (value) => `Agnes video task failed: ${JSON.stringify(value)}`,
    });

    const videoUrl = this.videoUrlOf(raw);
    let artifact: Artifact | undefined;
    if (videoUrl && getBoolean(input.download_when_ready, true)) {
      artifact = await this.downloadUrlAsArtifact(videoUrl, {
        subdir: "videos",
        outputDirectory: input.output_directory,
        prefix: "agnes_video_v20",
        ext: "mp4",
        auth: false,
      });
    }
    return {
      ok: true,
      backend: "agnes-http",
      tool: "query_video_v20",
      task_id: taskId,
      status: this.statusOf(raw),
      video_url: videoUrl,
      ...(artifact ? { artifact: describeArtifacts([artifact], "agnes") } : {}),
      raw,
    };
  }
}
