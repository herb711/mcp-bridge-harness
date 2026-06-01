import { TOOLS } from "../toolSchemas.js";

export type HarnessId = "opencode" | "codex" | "claude-code" | "cursor" | "vscode";
export type CatalogStatus = "bundled" | "available" | "coming_soon";
export type SecretFieldType = "password" | "text";

export interface CatalogField {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "boolean" | "textarea";
  required?: boolean;
  placeholder?: string;
  help?: string;
  default?: string;
  options?: Array<{ label: string; value: string }>;
  secret?: boolean;
}

export interface CatalogEntry {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  status: CatalogStatus;
  transport: "stdio" | "http";
  installMode: "bundled" | "npx" | "uvx" | "binary" | "remote";
  supportedHarnesses: HarnessId[];
  tools: string[];
  permissions: string[];
  fields: CatalogField[];
}

const minimaxTools = TOOLS.map((tool) => tool.name);

export const BUILTIN_CATALOG: CatalogEntry[] = [
  {
    id: "minimax-bridge",
    name: "minimax-bridge-mcp",
    displayName: "MiniMax Bridge MCP",
    version: "0.2.0-harness.1",
    description: "Bundled MiniMax multimodal MCP. Exposes speech, image, video, music, web_search and understand_image tools through one stdio server.",
    category: "Multimodal",
    tags: ["bundled", "minimax", "audio", "image", "video", "token-plan"],
    status: "bundled",
    transport: "stdio",
    installMode: "bundled",
    supportedHarnesses: ["opencode"],
    tools: minimaxTools,
    permissions: ["network:minimax", "file:write:artifacts", "secret:read:minimax-api-key"],
    fields: [
      {
        key: "MINIMAX_API_KEY",
        label: "MiniMax API Key",
        type: "password",
        required: true,
        secret: true,
        placeholder: "sk-...",
        help: "用于 MiniMax HTTP/WebSocket 生成能力。保存到本机 Harness secrets 文件，不写入 OpenCode 配置。",
      },
      {
        key: "MINIMAX_API_HOST",
        label: "MiniMax API Host",
        type: "text",
        default: "https://api.minimaxi.com",
        help: "默认使用国际/开放平台 API Host。",
      },
      {
        key: "MINIMAX_MCP_BASE_PATH",
        label: "生成文件输出目录",
        type: "text",
        help: "音频、图片、视频等生成文件默认保存到这里。",
      },
      {
        key: "MINIMAX_T2A_MODE",
        label: "TTS 模式",
        type: "select",
        default: "async",
        options: [
          { label: "Async HTTP", value: "async" },
          { label: "WebSocket", value: "websocket" },
        ],
      },
      {
        key: "MINIMAX_ENABLE_OFFICIAL_MCP_PROXY",
        label: "启用官方 MiniMax MCP Proxy",
        type: "boolean",
        default: "true",
        help: "启用后，官方 MiniMax MCP JS 已支持的生成工具会优先转发到官方 MCP；未覆盖或增强能力继续走 Harness HTTPS 分支。",
      },
      {
        key: "MINIMAX_OFFICIAL_MCP_COMMAND",
        label: "官方 MiniMax MCP 命令",
        type: "text",
        default: "npx",
      },
      {
        key: "MINIMAX_OFFICIAL_MCP_ARGS",
        label: "官方 MiniMax MCP 参数",
        type: "textarea",
        default: "[\"-y\",\"minimax-mcp-js\"]",
      },
      {
        key: "MINIMAX_OFFICIAL_MCP_TIMEOUT_MS",
        label: "官方 MiniMax MCP 超时毫秒",
        type: "text",
        default: "600000",
      },
      {
        key: "MINIMAX_ENABLE_TOKEN_PLAN_PROXY",
        label: "启用 Token Plan MCP Proxy",
        type: "boolean",
        default: "true",
        help: "启用后 web_search / understand_image 会转发到 MiniMax Token Plan MCP。",
      },
      {
        key: "MINIMAX_PLAN_API_KEY",
        label: "Token Plan Key（可选）",
        type: "password",
        secret: true,
        placeholder: "留空则复用 MiniMax API Key",
      },
      {
        key: "MINIMAX_PLAN_MCP_COMMAND",
        label: "Token Plan MCP 命令",
        type: "text",
        default: "uvx",
      },
      {
        key: "MINIMAX_PLAN_MCP_ARGS",
        label: "Token Plan MCP 参数",
        type: "textarea",
        default: "[\"minimax-coding-plan-mcp\", \"-y\"]",
      },
    ],
  },
  {
    id: "github-mcp",
    name: "github-mcp-server",
    displayName: "GitHub MCP Server",
    version: "placeholder",
    description: "市场预留项：后续可一键安装 GitHub MCP，并同步到 Codex、OpenCode、Claude Code 等 Harness。",
    category: "Developer Tools",
    tags: ["github", "repo", "issues", "pull-requests"],
    status: "coming_soon",
    transport: "stdio",
    installMode: "binary",
    supportedHarnesses: ["opencode", "codex", "claude-code", "cursor", "vscode"],
    tools: [],
    permissions: ["network:github", "secret:read:github-token"],
    fields: [],
  },
  {
    id: "playwright-mcp",
    name: "playwright-mcp",
    displayName: "Playwright / Browser MCP",
    version: "placeholder",
    description: "市场预留项：浏览器自动化 MCP，后续可下载、配置、健康检查并注入到目标 Harness。",
    category: "Browser Automation",
    tags: ["browser", "playwright", "automation"],
    status: "coming_soon",
    transport: "stdio",
    installMode: "npx",
    supportedHarnesses: ["opencode", "codex", "claude-code", "cursor", "vscode"],
    tools: [],
    permissions: ["browser:automation", "network:any"],
    fields: [],
  },
  {
    id: "filesystem-mcp",
    name: "filesystem-mcp",
    displayName: "Filesystem MCP",
    version: "placeholder",
    description: "市场预留项：本地文件访问 MCP。后续版本会加入目录白名单和权限审计。",
    category: "Local Tools",
    tags: ["filesystem", "local", "files"],
    status: "coming_soon",
    transport: "stdio",
    installMode: "npx",
    supportedHarnesses: ["opencode", "codex", "claude-code", "cursor", "vscode"],
    tools: [],
    permissions: ["file:read", "file:write"],
    fields: [],
  },
];

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return BUILTIN_CATALOG.find((entry) => entry.id === id);
}
