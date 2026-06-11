import { TOOLS } from "../toolSchemas.js";
import { AGNES_TOOLS } from "../agnesToolSchemas.js";
import { CC_TOOLS } from "../ccToolSchemas.js";

export type HarnessId = "opencode" | "hermes" | "codex" | "claude-code" | "cursor" | "vscode";
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
  advanced?: boolean;
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
    description: "内置 MiniMax 多模态 MCP。通过一个 stdio 服务器提供语音、图片、视频、音乐、web_search 和 understand_image 工具。",
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
        key: "MINIMAX_ENABLE_EXTENDED_TOOLS",
        label: "Enable MiniMax extended tools",
        type: "boolean",
        default: "true",
        help: "Adds Harness-only MiniMax tools only when the official MiniMax MCP does not expose the same tool name.",
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
        default: "[\"-y\",\"minimax-mcp-js@0.0.17\"]",
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
    description: "内置 Agnes AI MCP。通过 Agnes API 中心提供 Agnes Image 2.1 Flash 和 agnes-video-v2.0 生成能力。",
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
    description: "所选主 Harness 的委托本地编码执行器。它将 cc-mcp 暴露给 OpenRedou/OpenCode、Hermes、Codex 或 Claude Code，然后启动 Claude Code 作为副 Harness 工作进程，用于具体的实现、调试、重构、测试、检查或代码审查子任务。",
    category: "Agent Bridge",
    tags: ["bundled", "openredou", "opencode", "hermes", "codex", "claude-code", "agent-bridge"],
    status: "bundled",
    transport: "stdio",
    installMode: "bundled",
    supportedHarnesses: ["opencode", "hermes", "codex", "claude-code"],
    tools: ccTools,
    permissions: ["process:spawn:claude-code", "file:write:cc-mcp-sessions", "mcp:callback"],
    fields: [
      {
        key: "CC_MCP_SERVER_MODE",
        label: "cc-mcp server location",
        type: "select",
        default: "local",
        options: [
          { label: "Local / WSL on this machine", value: "local" },
          { label: "Remote server over SSH", value: "remote" },
        ],
        help: "Remote mode makes the primary harness connect to cc-mcp over SSH; cc-mcp and Claude Code run in that configured execution environment. This does not change when agents should call cc-mcp.",
      },
      {
        key: "CC_MCP_REMOTE_HOST",
        label: "Remote SSH host",
        type: "text",
        placeholder: "113.249.108.72",
      },
      {
        key: "CC_MCP_REMOTE_PORT",
        label: "Remote SSH port",
        type: "text",
        default: "22",
      },
      {
        key: "CC_MCP_REMOTE_USER",
        label: "Remote SSH user",
        type: "text",
        placeholder: "root or ubuntu",
      },
      {
        key: "CC_MCP_REMOTE_PASSWORD",
        label: "Remote SSH password",
        type: "password",
        secret: true,
        help: "Optional. Used only to install the public key into authorized_keys during remote setup.",
      },
      {
        key: "CC_MCP_REMOTE_NICKNAME",
        label: "Remote nickname",
        type: "text",
        placeholder: "prod-box",
        help: "Shown in status and generated instructions as the cc-mcp target nickname.",
        advanced: true,
      },
      {
        key: "CC_MCP_REMOTE_KEY_PATH",
        label: "Private key path",
        type: "text",
        placeholder: "~/.ssh/id_ed25519",
        help: "If the key is already installed on the server, fill this and leave password empty.",
        advanced: true,
      },
      {
        key: "CC_MCP_REMOTE_PUBLIC_KEY_PATH",
        label: "Public key path",
        type: "text",
        placeholder: "~/.ssh/id_ed25519.pub",
        help: "Optional. If omitted, MCP Harness uses <private key>.pub or derives the public key with ssh-keygen.",
        advanced: true,
      },
      {
        key: "CC_MCP_REMOTE_INSTALL_DIR",
        label: "Remote cc-mcp install dir",
        type: "text",
        default: "~/.local/share/mcp-harness/cc-mcp-server",
        advanced: true,
      },
      {
        key: "CC_MCP_REMOTE_HARNESS_HOME",
        label: "Remote MCP_HARNESS_HOME",
        type: "text",
        default: "~/.local/share/mcp-harness",
        advanced: true,
      },
      {
        key: "CC_MCP_REMOTE_WORKDIR",
        label: "Remote default workdir",
        type: "text",
        placeholder: "~/project",
        help: "Claude Code works on this server path by default. Tool calls can still override it with workspace/cwd.",
        advanced: true,
      },
      {
        key: "CC_MCP_REMOTE_NODE_COMMAND",
        label: "Remote Node command",
        type: "text",
        default: "node",
        advanced: true,
      },
      {
        key: "CC_MCP_REMOTE_CLAUDE_COMMAND",
        label: "Remote Claude Code command",
        type: "text",
        default: "claude",
        advanced: true,
      },
      {
        key: "CC_MCP_REMOTE_INSTALL_CLAUDE",
        label: "Install Claude Code if missing",
        type: "boolean",
        default: "true",
        help: "Remote setup runs npm install -g @anthropic-ai/claude-code when claude is missing.",
        advanced: true,
      },
      {
        key: "CC_CLAUDE_RUNTIME",
        label: "副 Harness: Claude Code Runtime",
        type: "select",
        default: "wsl",
        options: [
          { label: "WSL (Windows -> Linux)", value: "wsl" },
          { label: "Local command", value: "local" },
        ],
        help: "cc-mcp 启动副 Harness 工作进程的位置。WSL 是常见的 Windows 配置。",
        advanced: true,
      },
      {
        key: "CC_CLAUDE_COMMAND",
        label: "副 Harness: Claude Code Entry Command",
        type: "text",
        default: "wsl.exe",
        help: "cc-mcp 为副 Harness 启动的进程。WSL 环境使用 wsl.exe；本地安装使用 claude 或绝对路径。",
        advanced: true,
      },
      {
        key: "CC_CLAUDE_COMMAND_ARGS",
        label: "副 Harness: Claude Code Entry Args",
        type: "textarea",
        default: "[\"--\",\"claude\"]",
        help: "JSON array inserted before cc-mcp's secondary-harness args. Common WSL value: [\"--\",\"claude\"]. Ubuntu-specific value: [\"-d\",\"Ubuntu\",\"--\",\"claude\"].",
        advanced: true,
      },
      {
        key: "CC_CLAUDE_MODEL",
        label: "副 Harness: Claude Code Model",
        type: "text",
        help: "传递给副 Harness 的可选模型参数 (--model)。",
      },
      {
        key: "CC_CLAUDE_MAX_TURNS",
        label: "副 Harness: Max Turns",
        type: "text",
        default: "20",
        advanced: true,
      },
      {
        key: "CC_CLAUDE_TIMEOUT_MS",
        label: "副 Harness: Timeout Milliseconds",
        type: "text",
        default: "1800000",
        advanced: true,
      },
      {
        key: "CC_CLAUDE_WORKDIR",
        label: "副 Harness: Claude Code Workdir",
        type: "text",
        placeholder: "自动：当前 Harness 项目路径",
        help: "留空则自动使用当前 Harness 项目路径。仅当委托的副 Harness 任务需要使用其他仓库时，才设置绝对路径。工具调用仍可通过 workspace/cwd 覆盖此设置。",
      },
      {
        key: "CC_CLAUDE_SKIP_PERMISSIONS",
        label: "副 Harness: Skip Claude Permissions",
        type: "boolean",
        default: "false",
        help: "Enable only when you want cc-mcp to pass --dangerously-skip-permissions and bypass main-harness permission forwarding.",
        advanced: true,
      },
      {
        key: "CC_CLAUDE_STRICT_MCP_CONFIG",
        label: "副 Harness: Strict MCP Config",
        type: "boolean",
        default: "true",
        help: "启用后，cc-mcp 将 --strict-mcp-config 传递给副 Harness，使其仅使用临时的回调 MCP 配置运行。",
        advanced: true,
      },
      {
        key: "CC_MCP_PERMISSION_MODE",
        label: "Permission / auto authorization mode",
        type: "select",
        default: "main-harness",
        options: [
          { label: "Auto via main harness fallback", value: "main-harness" },
          { label: "Always auto approve", value: "auto-approve" },
          { label: "Ask main harness", value: "ask" },
          { label: "Always deny", value: "deny" },
        ],
        help: "When Claude Code asks for permission and skip-permissions is disabled, cc-mcp forwards to the main harness when possible. If the main harness cannot show MCP form elicitation, cc-mcp auto-approves instead of silently denying Write/Edit.",
        advanced: true,
      },
      {
        key: "CC_MCP_PERMISSION_REQUEST_TIMEOUT_MS",
        label: "Permission request timeout ms",
        type: "text",
        default: "120000",
        advanced: true,
      },
      {
        key: "CC_CLAUDE_PERMISSION_APPROVE_INPUT",
        label: "Claude approve input",
        type: "text",
        default: "y",
        help: "Text sent to Claude Code stdin when permission is approved. Override if your Claude Code prompt expects a numeric choice.",
        advanced: true,
      },
      {
        key: "CC_CLAUDE_PERMISSION_DENY_INPUT",
        label: "Claude deny input",
        type: "text",
        default: "n",
        advanced: true,
      },
      {
        key: "CC_CLAUDE_WSL",
        label: "副 Harness: WSL Path Mode",
        type: "boolean",
        default: "true",
        help: "将临时 MCP 配置和回调路径转换为 /mnt/<drive>/... 格式，供 WSL 内的副 Harness 使用。",
        advanced: true,
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
