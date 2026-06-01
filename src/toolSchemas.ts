import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const outputDirectoryProperty = {
  type: "string",
  description: "Optional local directory for saving generated files. Defaults to MINIMAX_MCP_BASE_PATH/<tool>.",
};

const asyncModeProperty = {
  type: "boolean",
  default: false,
  description: "When true, return the provider task_id immediately instead of polling and downloading the final file.",
};

export const TOOLS: Tool[] = [
  {
    name: "web_search",
    description: "Token Plan branch. Proxy to MiniMax Token Plan MCP web_search. Search the web for a query and return results/suggestions.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
      },
      required: ["query"],
    },
  },
  {
    name: "understand_image",
    description: "Token Plan branch. Proxy to MiniMax Token Plan MCP understand_image. Analyze an image by URL or local path.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Question or analysis instruction for the image." },
        image_url: { type: "string", description: "HTTP/HTTPS URL or local path for the image." },
      },
      required: ["prompt", "image_url"],
    },
  },
  {
    name: "text_to_audio",
    description: "HTTP/WebSocket branch. Generate speech audio from text using MiniMax speech models. Mimics the official MiniMax MCP text_to_audio tool.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to synthesize. Async HTTP supports long text; WebSocket is better for shorter synchronous speech." },
        output_directory: outputDirectoryProperty,
        voice_id: { type: "string", default: "female-shaonv", description: "MiniMax voice ID, e.g. female-shaonv, male-qn-qingse, or a cloned voice_id." },
        model: { type: "string", default: "speech-2.8-hd", description: "MiniMax speech model, e.g. speech-2.8-hd, speech-2.8-turbo, speech-02-hd." },
        speed: { type: "number", default: 1.0, minimum: 0.5, maximum: 2.0 },
        vol: { type: "number", default: 1.0 },
        pitch: { type: "number", default: 0, minimum: -12, maximum: 12 },
        emotion: { type: "string", description: "Optional emotion where supported: happy, sad, angry, fearful, disgusted, surprised, calm, whisper/fluent." },
        sample_rate: { type: "integer", default: 32000, enum: [8000, 16000, 22050, 24000, 32000, 44100] },
        bitrate: { type: "integer", default: 128000, enum: [32000, 64000, 128000, 256000] },
        channel: { type: "integer", default: 1, enum: [1, 2] },
        format: { type: "string", default: "mp3", enum: ["pcm", "mp3", "flac", "wav"] },
        language_boost: { type: "string", description: "Optional language boost, e.g. auto." },
        pronunciation_dict: { type: "object", description: "Optional MiniMax pronunciation_dict object." },
        voice_modify: { type: "object", description: "Optional MiniMax voice_modify object." },
        transport: { type: "string", enum: ["async", "websocket"], description: "Override MINIMAX_T2A_MODE for this call." },
        async_mode: asyncModeProperty,
        poll_interval_seconds: { type: "number", description: "Polling interval for async HTTP mode." },
        max_wait_seconds: { type: "number", description: "Max wait time for async HTTP mode." },
      },
      required: ["text"],
    },
  },
  {
    name: "query_text_to_audio",
    description: "HTTP branch. Query an async text_to_audio task and optionally download the resulting audio file when ready.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task ID returned by text_to_audio async_mode." },
        output_directory: outputDirectoryProperty,
        format: { type: "string", default: "mp3", enum: ["pcm", "mp3", "flac", "wav"] },
        download_when_ready: { type: "boolean", default: true },
        poll_until_done: { type: "boolean", default: false },
        poll_interval_seconds: { type: "number" },
        max_wait_seconds: { type: "number" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "list_voices",
    description: "HTTP branch helper. Return a compact built-in list of common MiniMax system voices. Use MiniMax docs for the exhaustive table.",
    inputSchema: {
      type: "object",
      properties: {
        voice_type: { type: "string", enum: ["system", "voice_cloning", "voice_generation", "music_generation", "all"], default: "all" },
        language: { type: "string", description: "Optional language filter, e.g. Chinese, English, Japanese." },
        query: { type: "string", description: "Optional fuzzy search against voice_id/name/language." },
        limit: { type: "integer", default: 50, minimum: 1, maximum: 200 },
      },
    },
  },
  {
    name: "voice_clone",
    description: "HTTP branch. Upload a reference audio file and create a MiniMax cloned voice_id.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Custom voice_id to create. Must be unique in your MiniMax account." },
        file: { type: "string", description: "Local path or URL of the main audio sample for cloning. mp3/m4a/wav, 10s-5min, <=20MB." },
        is_url: { type: "boolean", default: false, description: "Whether file is a URL." },
        prompt_audio: { type: "string", description: "Optional local path or URL of short prompt audio (<8s) to improve cloning." },
        prompt_is_url: { type: "boolean", default: false },
        prompt_text: { type: "string", description: "Transcript for prompt_audio when prompt_audio is supplied." },
        text: { type: "string", description: "Preview text for generating a demo audio with the cloned voice." },
        model: { type: "string", default: "speech-2.8-hd" },
        output_directory: outputDirectoryProperty,
      },
      required: ["voice_id", "file"],
    },
  },
  {
    name: "text_to_image",
    description: "HTTP branch. Generate images from a prompt using MiniMax image_generation. Mimics the official MiniMax MCP text_to_image tool.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", maxLength: 1500, description: "Image prompt." },
        model: { type: "string", default: "image-01", enum: ["image-01", "image-01-live"] },
        aspect_ratio: { type: "string", default: "1:1", enum: ["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"] },
        n: { type: "integer", default: 1, minimum: 1, maximum: 4 },
        prompt_optimizer: { type: "boolean", default: true },
        subject_reference: { type: "array", description: "Optional MiniMax subject_reference array for character/object reference." },
        output_directory: outputDirectoryProperty,
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_video",
    description: "HTTP branch. Create text-to-video, image-to-video, start/end-frame, or subject-reference video task using MiniMax video_generation.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", maxLength: 2000, description: "Video prompt. Required unless first_frame_image is supplied." },
        model: { type: "string", default: "MiniMax-Hailuo-2.3", description: "Video model, e.g. MiniMax-Hailuo-2.3, MiniMax-Hailuo-02, T2V-01, I2V-01, S2V-01." },
        first_frame_image: { type: "string", description: "First-frame image URL or data:image/...;base64,..." },
        last_frame_image: { type: "string", description: "Optional last-frame image URL or data URL." },
        subject_reference: { type: "array", description: "Optional MiniMax subject_reference array." },
        duration: { type: "integer", default: 6, enum: [6, 10] },
        resolution: { type: "string", default: "1080P", enum: ["512P", "720P", "768P", "1080P"] },
        output_directory: outputDirectoryProperty,
        async_mode: asyncModeProperty,
        poll_interval_seconds: { type: "number" },
        max_wait_seconds: { type: "number" },
      },
    },
  },
  {
    name: "image_to_video",
    description: "HTTP branch. Convenience alias for generate_video where first_frame_image is required.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", maxLength: 2000 },
        first_frame_image: { type: "string", description: "First-frame image URL or data:image/...;base64,..." },
        model: { type: "string", default: "MiniMax-Hailuo-2.3" },
        duration: { type: "integer", default: 6, enum: [6, 10] },
        resolution: { type: "string", default: "1080P", enum: ["512P", "720P", "768P", "1080P"] },
        output_directory: outputDirectoryProperty,
        async_mode: asyncModeProperty,
      },
      required: ["first_frame_image"],
    },
  },
  {
    name: "query_video_generation",
    description: "HTTP branch. Query a MiniMax video_generation task. If complete, fetch file_id and download the video.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        output_directory: outputDirectoryProperty,
        poll_until_done: { type: "boolean", default: false },
        poll_interval_seconds: { type: "number" },
        max_wait_seconds: { type: "number" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "video_template_generation",
    description: "HTTP branch. Generate a video from a MiniMax video template using template_id, media_inputs and text_inputs.",
    inputSchema: {
      type: "object",
      properties: {
        template_id: { type: "string" },
        media_inputs: { type: "array", description: "Array like [{ value: 'https://...' }]" },
        text_inputs: { type: "array", description: "Array like [{ value: 'text' }]" },
        output_directory: outputDirectoryProperty,
        async_mode: asyncModeProperty,
        poll_interval_seconds: { type: "number" },
        max_wait_seconds: { type: "number" },
      },
      required: ["template_id"],
    },
  },
  {
    name: "query_video_template_generation",
    description: "HTTP branch. Query a MiniMax video_template_generation task. If complete, download returned video_url.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        output_directory: outputDirectoryProperty,
        poll_until_done: { type: "boolean", default: false },
        poll_interval_seconds: { type: "number" },
        max_wait_seconds: { type: "number" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "lyrics_generation",
    description: "HTTP branch. Generate lyrics from a theme/prompt using MiniMax lyrics_generation.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        mode: { type: "string", default: "write_full_song", description: "MiniMax lyrics_generation mode." },
      },
      required: ["prompt"],
    },
  },
  {
    name: "music_generation",
    description: "HTTP branch. Generate music/song or cover using MiniMax music_generation.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 10, maxLength: 300, description: "Music style, mood, scene or cover style prompt." },
        lyrics: { type: "string", description: "Lyrics. Supports [Intro], [Verse], [Chorus], [Bridge], [Outro]. Optional when lyrics_optimizer or is_instrumental is used." },
        model: { type: "string", default: "music-2.6", description: "music-2.6 or music-cover." },
        lyrics_optimizer: { type: "boolean", description: "Let MiniMax optimize/write lyrics when no lyrics are supplied." },
        is_instrumental: { type: "boolean", description: "Generate instrumental music when supported." },
        audio_url: { type: "string", description: "For one-step music-cover mode: reference song URL." },
        audio_base64: { type: "string", description: "For cover mode: reference audio as base64 if supported." },
        cover_feature_id: { type: "string", description: "For two-step music-cover mode, from music_cover_preprocess." },
        sample_rate: { type: "integer", default: 44100 },
        bitrate: { type: "integer", default: 256000 },
        format: { type: "string", default: "mp3", enum: ["mp3", "wav", "pcm"] },
        output_format: { type: "string", default: "url", enum: ["url", "hex", "base64"] },
        output_directory: outputDirectoryProperty,
      },
      required: ["prompt"],
    },
  },
  {
    name: "music_cover_preprocess",
    description: "HTTP branch. Preprocess a reference audio for two-step music-cover generation; returns cover_feature_id and formatted_lyrics.",
    inputSchema: {
      type: "object",
      properties: {
        audio_url: { type: "string" },
        model: { type: "string", default: "music-cover" },
      },
      required: ["audio_url"],
    },
  },
];
