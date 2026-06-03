import { TOOLS } from "../toolSchemas.js";
import { AGNES_TOOLS } from "../agnesToolSchemas.js";
import { CC_TOOLS } from "../ccToolSchemas.js";

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
const agnesTools = AGNES_TOOLS.map((tool) => tool.name);
const ccTools = CC_TOOLS.map((tool) => tool.name);

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
    id: "agnes",
    name: "agnes-mcp",
    displayName: "Agnes",
    version: "0.1.0-harness.1",
    description: "Bundled Agnes AI MCP. Exposes Agnes Image 2.1 Flash and agnes-video-v2.0 generation through the Agnes API hub.",
    category: "Multimodal",
    tags: ["bundled", "agnes", "image", "video"],
    status: "bundled",
    transport: "stdio",
    installMode: "bundled",
    supportedHarnesses: ["opencode"],
    tools: agnesTools,
    permissions: ["network:agnes", "file:write:artifacts", "secret:read:agnes-api-key"],
    fields: [
      {
        key: "AGNES_API_KEY",
        label: "Agnes API Key",
        type: "password",
        required: true,
        secret: true,
        placeholder: "ag-...",
        help: "用于 Agnes Image 2.1 Flash 和 agnes-video-v2.0。保存到本机 Harness secrets 文件，不写入 OpenCode 配置。",
      },
      {
        key: "AGNES_API_HOST",
        label: "Agnes API Host",
        type: "text",
        default: "https://apihub.agnes-ai.com",
      },
      {
        key: "AGNES_MCP_BASE_PATH",
        label: "生成文件输出目录",
        type: "text",
        help: "Agnes 生成的图片、视频文件默认保存到这里。",
      },
      {
        key: "AGNES_POLL_INTERVAL_SECONDS",
        label: "轮询间隔秒数",
        type: "text",
        default: "10",
      },
      {
        key: "AGNES_MAX_WAIT_SECONDS",
        label: "最大等待秒数",
        type: "text",
        default: "900",
      },
    ],
  },
  {
    id: "cc-mcp",
    name: "cc-mcp",
    displayName: "CC MCP",
    version: "0.1.0-harness.1",
    description: "Delegated local coding executor for OpenRedou/OpenCode. Use it only for concrete implementation, debugging, refactoring, testing, inspection, or code-review subtasks inside a specified workspace.",
    category: "Agent Bridge",
    tags: ["bundled", "openredou", "opencode", "claude-code", "agent-bridge"],
    status: "bundled",
    transport: "stdio",
    installMode: "bundled",
    supportedHarnesses: ["opencode", "claude-code"],
    tools: ccTools,
    permissions: ["process:spawn:claude-code", "file:write:cc-mcp-sessions", "mcp:callback"],
    fields: [
      {
        key: "CC_CLAUDE_RUNTIME",
        label: "Claude Code Runtime",
        type: "select",
        default: "wsl",
        options: [
          { label: "WSL (Windows -> Linux)", value: "wsl" },
          { label: "Local command", value: "local" },
        ],
        help: "Where cc-mcp should start Claude Code. WSL is the common Windows setup.",
      },
      {
        key: "CC_CLAUDE_COMMAND",
        label: "Claude Code Entry Command",
        type: "text",
        default: "wsl.exe",
        help: "Process cc-mcp starts. For WSL use wsl.exe; for local installs use claude or an absolute path.",
      },
      {
        key: "CC_CLAUDE_COMMAND_ARGS",
        label: "Claude Code Entry Args",
        type: "textarea",
        default: "[\"--\",\"claude\"]",
        help: "JSON array inserted before cc-mcp's Claude Code args. Common WSL value: [\"--\",\"claude\"]. Ubuntu-specific value: [\"-d\",\"Ubuntu\",\"--\",\"claude\"].",
      },
      {
        key: "CC_CLAUDE_MODEL",
        label: "Claude Code Model",
        type: "text",
        help: "Optional model passed to Claude Code with --model.",
      },
      {
        key: "CC_CLAUDE_MAX_TURNS",
        label: "Max Turns",
        type: "text",
        default: "20",
      },
      {
        key: "CC_CLAUDE_TIMEOUT_MS",
        label: "Timeout Milliseconds",
        type: "text",
        default: "1800000",
      },
      {
        key: "CC_CLAUDE_WORKDIR",
        label: "Claude Code Workdir",
        type: "text",
        placeholder: "D:\\path\\to\\repo or /home/user/project",
        help: "Optional default working directory for delegated Claude Code tasks. Tool calls can still override this with cwd.",
      },
      {
        key: "CC_CLAUDE_SKIP_PERMISSIONS",
        label: "Skip Claude Permissions",
        type: "boolean",
        default: "true",
        help: "When enabled, cc-mcp passes --dangerously-skip-permissions to Claude Code.",
      },
      {
        key: "CC_CLAUDE_STRICT_MCP_CONFIG",
        label: "Strict MCP Config",
        type: "boolean",
        default: "true",
        help: "When enabled, cc-mcp passes --strict-mcp-config so Claude Code only uses the temporary callback MCP config for the run.",
      },
      {
        key: "CC_CLAUDE_WSL",
        label: "WSL Path Mode",
        type: "boolean",
        default: "true",
        help: "Convert temporary MCP config and callback paths to /mnt/<drive>/... for Claude Code running inside WSL.",
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
