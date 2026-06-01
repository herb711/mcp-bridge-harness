import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import WebSocket from "ws";
import { ArtifactStore, type Artifact, extensionFromMime, mimeFromExt, safeExt } from "./artifacts.js";
import type { Config } from "./config.js";
import { MiniMaxApiError, UserInputError } from "./errors.js";
import { SYSTEM_VOICES } from "./systemVoices.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getInteger(value: unknown, fallback: number): number {
  const n = getNumber(value, fallback);
  return Math.trunc(n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function looksLikeSuccess(status: unknown): boolean {
  const normalized = String(status || "").toLowerCase();
  return ["success", "succeeded", "completed", "complete", "done", "finished"].includes(normalized);
}

function looksLikeFailure(status: unknown): boolean {
  const normalized = String(status || "").toLowerCase();
  return ["fail", "failed", "failure", "error", "cancelled", "canceled"].includes(normalized);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
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
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class MiniMaxHttpClient {
  constructor(
    private readonly config: Config,
    private readonly store: ArtifactStore,
  ) {}

  private api(pathname: string): string {
    const prefix = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return `${this.config.apiHost}${prefix}`;
  }

  private requireApiKey(): string {
    if (!this.config.apiKey) {
      throw new UserInputError("Missing MINIMAX_API_KEY. Set it in the MCP server environment.");
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
      throw new MiniMaxApiError(`MiniMax API request failed: ${response.status} ${response.statusText}`, {
        status: response.status,
        responseBody: parsed,
      });
    }
    return parsed;
  }

  private async bytesRequest(url: string, options: { auth?: boolean } = {}): Promise<{ buffer: Buffer; mime: string | undefined }> {
    const response = await fetch(url, {
      headers: options.auth === false ? undefined : this.authHeaders(),
    });
    if (!response.ok) {
      const body = await responseTextOrJson(response);
      throw new MiniMaxApiError(`MiniMax download failed: ${response.status} ${response.statusText}`, {
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

  async uploadFile(fileOrUrl: string, purpose: string, isUrl: boolean): Promise<{ file_id: string; raw: unknown; tempFile?: string }> {
    let filePath = fileOrUrl;
    let tempFile: string | undefined;

    if (isUrl || isHttpUrl(fileOrUrl)) {
      const { buffer, mime } = await this.bytesRequest(fileOrUrl, { auth: false });
      const ext = extensionFromMime(mime, path.extname(fileNameFromUrl(fileOrUrl) || "").replace(/^\./, "") || "bin");
      tempFile = path.join(os.tmpdir(), `minimax_upload_${Date.now()}_${Math.random().toString(16).slice(2)}.${safeExt(ext, "bin")}`);
      await fs.writeFile(tempFile, buffer);
      filePath = tempFile;
    }

    const fileBuffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).replace(/^\./, "") || "bin";
    const blob = new Blob([fileBuffer], { type: mimeFromExt(ext) });
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("file", blob, path.basename(filePath));

    const response = await fetch(this.api("/v1/files/upload"), {
      method: "POST",
      headers: this.authHeaders(),
      body: form,
    });
    const parsed = await responseTextOrJson(response);
    if (!response.ok) {
      throw new MiniMaxApiError(`MiniMax file upload failed: ${response.status} ${response.statusText}`, {
        status: response.status,
        responseBody: parsed,
      });
    }
    const root = asRecord(parsed);
    const file = asRecord(root.file);
    const fileId = firstString(file.file_id, root.file_id);
    if (!fileId) throw new MiniMaxApiError("MiniMax file upload response did not include file_id", { responseBody: parsed });
    return { file_id: fileId, raw: parsed, tempFile };
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

  private fileIdOf(raw: unknown): string | undefined {
    const root = asRecord(raw);
    const data = asRecord(root.data);
    const file = asRecord(root.file);
    return firstString(root.file_id, data.file_id, file.file_id);
  }

  private taskIdOf(raw: unknown): string | undefined {
    const root = asRecord(raw);
    const data = asRecord(root.data);
    return firstString(root.task_id, data.task_id, root.id, data.id);
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
      if (options.isFail(value)) throw new MiniMaxApiError(options.failureMessage(value), { responseBody: value });
      if (!options.pollUntilDone) return value;
      if ((Date.now() - started) / 1000 >= options.maxWaitSeconds) return value;
      await sleep(options.intervalSeconds * 1000);
    }
  }

  async listVoices(args: unknown) {
    const input = asRecord(args);
    const voiceType = getString(input.voice_type) || "all";
    const language = getString(input.language)?.toLowerCase();
    const query = getString(input.query)?.toLowerCase();
    const limit = Math.min(getInteger(input.limit, 50), 200);

    let voices = SYSTEM_VOICES;
    if (voiceType !== "all" && voiceType !== "system") voices = [];
    if (language) voices = voices.filter((v) => v.language.toLowerCase().includes(language));
    if (query) {
      voices = voices.filter((v) => `${v.voice_id} ${v.name} ${v.language}`.toLowerCase().includes(query));
    }

    return {
      ok: true,
      backend: "builtin",
      voice_type: voiceType,
      voices: voices.slice(0, limit),
      count: Math.min(voices.length, limit),
      note: "This is a compact built-in system voice list. For the exhaustive/latest list, check MiniMax's System Voice ID documentation.",
    };
  }

  async textToAudio(args: unknown) {
    const input = asRecord(args);
    const text = getString(input.text);
    if (!text) throw new UserInputError("text_to_audio requires text");
    const transport = (getString(input.transport) || this.config.t2aMode).toLowerCase();
    if (transport === "websocket") return this.textToAudioWebSocket(input);
    return this.textToAudioAsyncHttp(input);
  }

  private async textToAudioAsyncHttp(input: Record<string, unknown>) {
    const format = getString(input.format) || "mp3";
    const payload: Record<string, unknown> = {
      model: getString(input.model) || "speech-2.8-hd",
      text: input.text,
      language_boost: input.language_boost || "auto",
      voice_setting: {
        voice_id: getString(input.voice_id) || "female-shaonv",
        speed: getNumber(input.speed, 1),
        vol: getNumber(input.vol, 1),
        pitch: typeof input.pitch === "number" ? input.pitch : 0,
        ...(input.emotion ? { emotion: input.emotion } : {}),
      },
      audio_setting: {
        audio_sample_rate: getInteger(input.sample_rate, 32000),
        bitrate: getInteger(input.bitrate, 128000),
        format,
        channel: getInteger(input.channel, 1),
      },
      ...(input.pronunciation_dict ? { pronunciation_dict: input.pronunciation_dict } : {}),
      ...(input.voice_modify ? { voice_modify: input.voice_modify } : {}),
    };

    const created = await this.jsonRequest("/v1/t2a_async_v2", { method: "POST", body: payload });
    const taskId = this.taskIdOf(created);
    if (!taskId) throw new MiniMaxApiError("MiniMax t2a_async_v2 response did not include task_id", { responseBody: created });

    if (getBoolean(input.async_mode, false)) {
      return { ok: true, backend: "http", tool: "text_to_audio", async: true, task_id: taskId, raw: created };
    }

    const queried = await this.queryTextToAudio({
      task_id: taskId,
      output_directory: input.output_directory,
      format,
      download_when_ready: true,
      poll_until_done: true,
      poll_interval_seconds: input.poll_interval_seconds,
      max_wait_seconds: input.max_wait_seconds,
    });
    return { ok: true, backend: "http", tool: "text_to_audio", async: false, task_id: taskId, result: queried };
  }

  private async textToAudioWebSocket(input: Record<string, unknown>) {
    const text = getString(input.text);
    if (!text) throw new UserInputError("text_to_audio websocket requires text");
    const format = getString(input.format) || "mp3";
    const wsUrl = this.config.apiHost
      .replace(/^https:/, "wss:")
      .replace(/^http:/, "ws:") + "/ws/v1/t2a_v2";

    const audio = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const ws = new WebSocket(wsUrl, { headers: this.authHeaders() as Record<string, string> });
      let started = false;
      let continued = false;
      let settled = false;

      const fail = (error: unknown) => {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch { /* noop */ }
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      ws.on("error", fail);
      ws.on("message", (data) => {
        try {
          const response = JSON.parse(data.toString()) as Record<string, unknown>;
          if (response.event === "connected_success" && !started) {
            started = true;
            ws.send(JSON.stringify({
              event: "task_start",
              model: getString(input.model) || "speech-2.8-hd",
              voice_setting: {
                voice_id: getString(input.voice_id) || "female-shaonv",
                speed: getNumber(input.speed, 1),
                vol: getNumber(input.vol, 1),
                pitch: typeof input.pitch === "number" ? input.pitch : 0,
                english_normalization: false,
                ...(input.emotion ? { emotion: input.emotion } : {}),
              },
              audio_setting: {
                sample_rate: getInteger(input.sample_rate, 32000),
                bitrate: getInteger(input.bitrate, 128000),
                format,
                channel: getInteger(input.channel, 1),
              },
            }));
            return;
          }

          if (response.event === "task_started" && !continued) {
            continued = true;
            ws.send(JSON.stringify({ event: "task_continue", text }));
            return;
          }

          const responseData = asRecord(response.data);
          const audioHex = getString(responseData.audio);
          if (audioHex) chunks.push(Buffer.from(audioHex, "hex"));

          if (response.is_final === true) {
            ws.send(JSON.stringify({ event: "task_finish" }));
            if (!settled) {
              settled = true;
              resolve(Buffer.concat(chunks));
              ws.close();
            }
          }

          if (looksLikeFailure(response.event) || looksLikeFailure(response.status)) {
            fail(new MiniMaxApiError("MiniMax websocket T2A failed", { responseBody: response }));
          }
        } catch (error) {
          fail(error);
        }
      });
    });

    const artifact = await this.store.writeBuffer({
      data: audio,
      subdir: "audio",
      outputDirectory: input.output_directory,
      prefix: "text_to_audio_ws",
      ext: format,
      mime: mimeFromExt(format),
    });
    return { ok: true, backend: "websocket", tool: "text_to_audio", artifact };
  }

  async queryTextToAudio(args: unknown) {
    const input = asRecord(args);
    const taskId = getString(input.task_id);
    if (!taskId) throw new UserInputError("query_text_to_audio requires task_id");
    const pollUntilDone = getBoolean(input.poll_until_done, false);
    const interval = getNumber(input.poll_interval_seconds, this.config.defaultPollIntervalSeconds);
    const maxWait = getNumber(input.max_wait_seconds, this.config.defaultMaxWaitSeconds);

    const raw = await this.poll({
      once: () => this.jsonRequest(`/v1/query/t2a_async_query_v2?task_id=${encodeURIComponent(taskId)}`),
      isDone: (value) => looksLikeSuccess(this.statusOf(value)) || Boolean(this.fileIdOf(value)),
      isFail: (value) => looksLikeFailure(this.statusOf(value)),
      pollUntilDone,
      intervalSeconds: interval,
      maxWaitSeconds: maxWait,
      failureMessage: (value) => `MiniMax text_to_audio task failed: ${JSON.stringify(value)}`,
    });

    const fileId = this.fileIdOf(raw);
    if (fileId && getBoolean(input.download_when_ready, true)) {
      const format = getString(input.format) || "mp3";
      const { buffer, mime } = await this.bytesRequest(this.api(`/v1/files/retrieve_content?file_id=${encodeURIComponent(fileId)}`));
      const artifact = await this.store.writeBuffer({
        data: buffer,
        subdir: "audio",
        outputDirectory: input.output_directory,
        prefix: "text_to_audio",
        ext: format,
        mime: mime || mimeFromExt(format),
      });
      return { ok: true, backend: "http", tool: "query_text_to_audio", task_id: taskId, status: this.statusOf(raw), file_id: fileId, artifact, raw };
    }

    return { ok: true, backend: "http", tool: "query_text_to_audio", task_id: taskId, status: this.statusOf(raw), file_id: fileId, raw };
  }

  async voiceClone(args: unknown) {
    const input = asRecord(args);
    const voiceId = getString(input.voice_id);
    const file = getString(input.file);
    if (!voiceId || !file) throw new UserInputError("voice_clone requires voice_id and file");

    const upload = await this.uploadFile(file, "voice_clone", getBoolean(input.is_url, false));
    let promptFileId: string | undefined;
    let promptUploadRaw: unknown;

    const promptAudio = getString(input.prompt_audio);
    if (promptAudio) {
      const promptUpload = await this.uploadFile(promptAudio, "prompt_audio", getBoolean(input.prompt_is_url, false));
      promptFileId = promptUpload.file_id;
      promptUploadRaw = promptUpload.raw;
    }

    const payload: Record<string, unknown> = {
      file_id: upload.file_id,
      voice_id: voiceId,
      model: getString(input.model) || "speech-2.8-hd",
      ...(input.text ? { text: input.text } : {}),
      ...(promptFileId ? { clone_prompt: { prompt_audio: promptFileId, ...(input.prompt_text ? { prompt_text: input.prompt_text } : {}) } } : {}),
    };

    const raw = await this.jsonRequest("/v1/voice_clone", { method: "POST", body: payload });
    const urls = collectUrlValues(raw);
    const artifacts: Artifact[] = [];
    for (const url of urls) {
      try {
        artifacts.push(await this.downloadUrlAsArtifact(url, { subdir: "voice_clone", outputDirectory: input.output_directory, prefix: "voice_clone", ext: "mp3", auth: false }));
      } catch {
        // Some URLs may be metadata links rather than downloadable media. Keep raw response either way.
      }
    }

    return {
      ok: true,
      backend: "http",
      tool: "voice_clone",
      voice_id: voiceId,
      file_id: upload.file_id,
      prompt_file_id: promptFileId,
      artifacts,
      raw,
      upload_raw: upload.raw,
      prompt_upload_raw: promptUploadRaw,
    };
  }

  async textToImage(args: unknown) {
    const input = asRecord(args);
    const prompt = getString(input.prompt);
    if (!prompt) throw new UserInputError("text_to_image requires prompt");
    const payload: Record<string, unknown> = {
      model: getString(input.model) || "image-01",
      prompt,
      aspect_ratio: getString(input.aspect_ratio) || "1:1",
      n: getInteger(input.n, 1),
      prompt_optimizer: typeof input.prompt_optimizer === "boolean" ? input.prompt_optimizer : true,
      response_format: "base64",
      ...(input.subject_reference ? { subject_reference: input.subject_reference } : {}),
    };
    const raw = await this.jsonRequest("/v1/image_generation", { method: "POST", body: payload });
    const root = asRecord(raw);
    const data = asRecord(root.data);
    const base64Images = Array.isArray(data.image_base64) ? data.image_base64 : Array.isArray(root.image_base64) ? root.image_base64 : [];
    const urls = [
      ...(Array.isArray(data.image_urls) ? data.image_urls : []),
      ...(Array.isArray(data.image_url) ? data.image_url : []),
      ...collectUrlValues(raw).filter((url) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)),
    ];

    const artifacts: Artifact[] = [];
    for (const [index, image] of base64Images.entries()) {
      if (typeof image !== "string") continue;
      artifacts.push(await this.store.writeBase64({
        base64: image,
        subdir: "images",
        outputDirectory: input.output_directory,
        prefix: `text_to_image_${index + 1}`,
        ext: "jpg",
        mime: "image/jpeg",
      }));
    }
    for (const [index, url] of urls.entries()) {
      if (typeof url !== "string") continue;
      artifacts.push(await this.downloadUrlAsArtifact(url, { subdir: "images", outputDirectory: input.output_directory, prefix: `text_to_image_url_${index + 1}`, auth: false }));
    }

    return { ok: true, backend: "http", tool: "text_to_image", artifacts, raw };
  }

  async generateVideo(args: unknown) {
    const input = asRecord(args);
    const prompt = getString(input.prompt);
    const firstFrameImage = getString(input.first_frame_image);
    if (!prompt && !firstFrameImage) throw new UserInputError("generate_video requires prompt or first_frame_image");

    const payload: Record<string, unknown> = {
      ...(prompt ? { prompt } : {}),
      ...(firstFrameImage ? { first_frame_image: firstFrameImage } : {}),
      ...(input.last_frame_image ? { last_frame_image: input.last_frame_image } : {}),
      ...(input.subject_reference ? { subject_reference: input.subject_reference } : {}),
      model: getString(input.model) || "MiniMax-Hailuo-2.3",
      duration: getInteger(input.duration, 6),
      resolution: getString(input.resolution) || "1080P",
    };
    const raw = await this.jsonRequest("/v1/video_generation", { method: "POST", body: payload });
    const taskId = this.taskIdOf(raw);
    if (!taskId) throw new MiniMaxApiError("MiniMax video_generation response did not include task_id", { responseBody: raw });

    if (getBoolean(input.async_mode, false)) {
      return { ok: true, backend: "http", tool: "generate_video", async: true, task_id: taskId, raw };
    }

    const result = await this.queryVideoGeneration({
      task_id: taskId,
      output_directory: input.output_directory,
      poll_until_done: true,
      poll_interval_seconds: input.poll_interval_seconds,
      max_wait_seconds: input.max_wait_seconds,
    });
    return { ok: true, backend: "http", tool: "generate_video", async: false, task_id: taskId, result, raw };
  }

  async queryVideoGeneration(args: unknown) {
    const input = asRecord(args);
    const taskId = getString(input.task_id);
    if (!taskId) throw new UserInputError("query_video_generation requires task_id");
    const raw = await this.poll({
      once: () => this.jsonRequest(`/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`),
      isDone: (value) => looksLikeSuccess(this.statusOf(value)) || Boolean(this.fileIdOf(value)),
      isFail: (value) => looksLikeFailure(this.statusOf(value)),
      pollUntilDone: getBoolean(input.poll_until_done, false),
      intervalSeconds: getNumber(input.poll_interval_seconds, this.config.defaultPollIntervalSeconds),
      maxWaitSeconds: getNumber(input.max_wait_seconds, this.config.defaultMaxWaitSeconds),
      failureMessage: (value) => `MiniMax video task failed: ${JSON.stringify(value)}`,
    });

    const fileId = this.fileIdOf(raw);
    let artifact: Artifact | undefined;
    let downloadUrl: string | undefined;
    if (fileId) {
      const retrieved = await this.jsonRequest(`/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`);
      const retrievedRoot = asRecord(retrieved);
      const file = asRecord(retrievedRoot.file);
      downloadUrl = firstString(file.download_url, retrievedRoot.download_url);
      if (downloadUrl) {
        artifact = await this.downloadUrlAsArtifact(downloadUrl, { subdir: "videos", outputDirectory: input.output_directory, prefix: "video_generation", ext: "mp4", auth: false });
      }
      return { ok: true, backend: "http", tool: "query_video_generation", task_id: taskId, status: this.statusOf(raw), file_id: fileId, download_url: downloadUrl, artifact, raw, retrieve_raw: retrieved };
    }
    return { ok: true, backend: "http", tool: "query_video_generation", task_id: taskId, status: this.statusOf(raw), raw };
  }

  async videoTemplateGeneration(args: unknown) {
    const input = asRecord(args);
    const templateId = getString(input.template_id);
    if (!templateId) throw new UserInputError("video_template_generation requires template_id");
    const payload: Record<string, unknown> = {
      template_id: templateId,
      ...(input.media_inputs ? { media_inputs: input.media_inputs } : {}),
      ...(input.text_inputs ? { text_inputs: input.text_inputs } : {}),
    };
    const raw = await this.jsonRequest("/v1/video_template_generation", { method: "POST", body: payload });
    const taskId = this.taskIdOf(raw);
    if (!taskId) throw new MiniMaxApiError("MiniMax video_template_generation response did not include task_id", { responseBody: raw });
    if (getBoolean(input.async_mode, false)) {
      return { ok: true, backend: "http", tool: "video_template_generation", async: true, task_id: taskId, raw };
    }
    const result = await this.queryVideoTemplateGeneration({
      task_id: taskId,
      output_directory: input.output_directory,
      poll_until_done: true,
      poll_interval_seconds: input.poll_interval_seconds,
      max_wait_seconds: input.max_wait_seconds,
    });
    return { ok: true, backend: "http", tool: "video_template_generation", async: false, task_id: taskId, result, raw };
  }

  async queryVideoTemplateGeneration(args: unknown) {
    const input = asRecord(args);
    const taskId = getString(input.task_id);
    if (!taskId) throw new UserInputError("query_video_template_generation requires task_id");
    const raw = await this.poll({
      once: () => this.jsonRequest(`/v1/query/video_template_generation?task_id=${encodeURIComponent(taskId)}`),
      isDone: (value) => looksLikeSuccess(this.statusOf(value)) || Boolean(firstString(asRecord(value).video_url, asRecord(asRecord(value).data).video_url)),
      isFail: (value) => looksLikeFailure(this.statusOf(value)),
      pollUntilDone: getBoolean(input.poll_until_done, false),
      intervalSeconds: getNumber(input.poll_interval_seconds, this.config.defaultPollIntervalSeconds),
      maxWaitSeconds: getNumber(input.max_wait_seconds, this.config.defaultMaxWaitSeconds),
      failureMessage: (value) => `MiniMax video template task failed: ${JSON.stringify(value)}`,
    });
    const root = asRecord(raw);
    const data = asRecord(root.data);
    const videoUrl = firstString(root.video_url, data.video_url);
    let artifact: Artifact | undefined;
    if (videoUrl) {
      artifact = await this.downloadUrlAsArtifact(videoUrl, { subdir: "videos", outputDirectory: input.output_directory, prefix: "video_template", ext: "mp4", auth: false });
    }
    return { ok: true, backend: "http", tool: "query_video_template_generation", task_id: taskId, status: this.statusOf(raw), video_url: videoUrl, artifact, raw };
  }

  async lyricsGeneration(args: unknown) {
    const input = asRecord(args);
    const prompt = getString(input.prompt);
    if (!prompt) throw new UserInputError("lyrics_generation requires prompt");
    const raw = await this.jsonRequest("/v1/lyrics_generation", {
      method: "POST",
      body: { mode: getString(input.mode) || "write_full_song", prompt },
    });
    return { ok: true, backend: "http", tool: "lyrics_generation", raw };
  }

  async musicGeneration(args: unknown) {
    const input = asRecord(args);
    const prompt = getString(input.prompt);
    if (!prompt) throw new UserInputError("music_generation requires prompt");
    const format = getString(input.format) || "mp3";
    const payload: Record<string, unknown> = {
      model: getString(input.model) || "music-2.6",
      prompt,
      ...(input.lyrics ? { lyrics: input.lyrics } : {}),
      ...(input.lyrics_optimizer !== undefined ? { lyrics_optimizer: input.lyrics_optimizer } : {}),
      ...(input.is_instrumental !== undefined ? { is_instrumental: input.is_instrumental } : {}),
      ...(input.audio_url ? { audio_url: input.audio_url } : {}),
      ...(input.audio_base64 ? { audio_base64: input.audio_base64 } : {}),
      ...(input.cover_feature_id ? { cover_feature_id: input.cover_feature_id } : {}),
      audio_setting: {
        sample_rate: getInteger(input.sample_rate, 44100),
        bitrate: getInteger(input.bitrate, 256000),
        format,
      },
      output_format: getString(input.output_format) || "url",
    };

    const raw = await this.jsonRequest("/v1/music_generation", { method: "POST", body: payload });
    const artifacts: Artifact[] = [];
    const urls = collectUrlValues(raw).filter((url) => /\.(mp3|wav|pcm|flac)(\?|$)/i.test(url) || url.includes("music") || url.includes("audio"));
    for (const [index, url] of urls.entries()) {
      try {
        artifacts.push(await this.downloadUrlAsArtifact(url, { subdir: "music", outputDirectory: input.output_directory, prefix: `music_${index + 1}`, ext: format, auth: false }));
      } catch {
        // Keep raw response even when URL is not directly downloadable.
      }
    }

    const root = asRecord(raw);
    const data = asRecord(root.data);
    const maybeBase64 = firstString(root.audio_base64, data.audio_base64, root.audio, data.audio);
    if (maybeBase64 && !/^https?:\/\//i.test(maybeBase64)) {
      try {
        artifacts.push(await this.store.writeBase64({
          base64: maybeBase64,
          subdir: "music",
          outputDirectory: input.output_directory,
          prefix: "music_base64",
          ext: format,
          mime: mimeFromExt(format),
        }));
      } catch {
        // raw response remains useful.
      }
    }

    return { ok: true, backend: "http", tool: "music_generation", artifacts, raw };
  }

  async musicCoverPreprocess(args: unknown) {
    const input = asRecord(args);
    const audioUrl = getString(input.audio_url);
    if (!audioUrl) throw new UserInputError("music_cover_preprocess requires audio_url");
    const raw = await this.jsonRequest("/v1/music_cover_preprocess", {
      method: "POST",
      body: { model: getString(input.model) || "music-cover", audio_url: audioUrl },
    });
    return { ok: true, backend: "http", tool: "music_cover_preprocess", raw };
  }
}
