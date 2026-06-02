import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const outputDirectoryProperty = {
  type: "string",
  description: "Optional local directory for saving generated files. Defaults to AGNES_MCP_BASE_PATH/<tool>.",
};

const asyncModeProperty = {
  type: "boolean",
  default: false,
  description: "When true, return the provider task_id immediately instead of polling and downloading the final file.",
};

export const AGNES_TOOLS: Tool[] = [
  {
    name: "image_21_flash",
    description: "Agnes branch. Generate or transform images with Agnes Image 2.1 Flash.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image prompt or edit instruction." },
        model: { type: "string", default: "agnes-image-2.1-flash" },
        size: { type: "string", default: "1024x768", description: "Output image size, e.g. 1024x768." },
        image: {
          anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          description: "Optional source image URL or URLs for image-to-image generation.",
        },
        images: {
          type: "array",
          items: { type: "string" },
          description: "Optional source image URLs for image-to-image generation.",
        },
        response_format: { type: "string", default: "url", enum: ["url", "b64_json", "base64"] },
        extra_body: { type: "object", description: "Optional Agnes extra_body object." },
        output_directory: outputDirectoryProperty,
      },
      required: ["prompt"],
    },
  },
  {
    name: "video_v20",
    description: "Agnes branch. Create text-to-video, image-to-video, multi-image, or keyframe video tasks with agnes-video-v2.0.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Video prompt." },
        model: { type: "string", default: "agnes-video-v2.0" },
        image: {
          anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          description: "Optional image URL or URL array. A string is sent as image; multiple images are sent through extra_body.image.",
        },
        images: {
          type: "array",
          items: { type: "string" },
          description: "Optional image URLs for multi-image or keyframe generation.",
        },
        mode: { type: "string", description: "Optional generation mode, e.g. ti2vid or keyframes." },
        height: { type: "integer", default: 768 },
        width: { type: "integer", default: 1152 },
        num_frames: { type: "integer", default: 121, description: "Must be <= 441 and match 8n + 1." },
        frame_rate: { type: "number", default: 24, minimum: 1, maximum: 60 },
        num_inference_steps: { type: "integer" },
        seed: { type: "integer" },
        negative_prompt: { type: "string" },
        extra_body: { type: "object", description: "Optional Agnes extra_body object." },
        output_directory: outputDirectoryProperty,
        async_mode: asyncModeProperty,
        poll_interval_seconds: { type: "number" },
        max_wait_seconds: { type: "number" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "query_video_v20",
    description: "Agnes branch. Query an agnes-video-v2.0 task and download the final video when completed.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task ID returned by video_v20." },
        output_directory: outputDirectoryProperty,
        download_when_ready: { type: "boolean", default: true },
        poll_until_done: { type: "boolean", default: false },
        poll_interval_seconds: { type: "number" },
        max_wait_seconds: { type: "number" },
      },
      required: ["task_id"],
    },
  },
];
