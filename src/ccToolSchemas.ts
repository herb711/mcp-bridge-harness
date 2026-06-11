import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const delegatedCodingTaskSchema: Tool["inputSchema"] = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["task", "start", "tail", "result", "cancel", "status", "append_file", "finalize_file", "run_command"],
      default: "start",
      description: "Action to perform. For delegated coding work, set action=start first, then poll action=tail with the returned session_id and latest nextOffset until done, then call action=result. Use action=task only when the user explicitly asks for a single blocking synchronous call. The other actions support status checks, cancellation, and chunked script transfer.",
    },
    session_id: {
      type: "string",
      description: "For tail/result/cancel: session id returned by action=start.",
    },
    offset: {
      type: "integer",
      minimum: 0,
      description: "For tail: byte offset returned as nextOffset by the previous tail call.",
    },
    max_bytes: {
      type: "integer",
      minimum: 1024,
      description: "For tail: maximum terminal log bytes to return. Defaults to 131072.",
    },
    wait_ms: {
      type: "integer",
      minimum: 0,
      description: "For tail: long-poll wait time in milliseconds when no new output is available. Defaults to 3000.",
    },
    workspace: {
      type: "string",
      description: "Optional absolute path of the project workspace where the coding task should be executed. If omitted, cc-mcp uses the configured Claude Code Workdir, then the current Harness project path.",
    },
    mode: {
      type: "string",
      enum: ["implement", "debug", "refactor", "test", "review", "inspect"],
      description: "The type of concrete coding task to perform.",
    },
    task: {
      type: "string",
      description: "A concrete, self-contained coding subtask for the worker to execute.",
    },
    context: {
      anyOf: [
        { type: "string" },
        { type: "object" },
        { type: "array" },
      ],
      description: "Relevant background from the orchestrator, including why this task is needed and how it fits into the larger user request.",
    },
    target_files: {
      type: "array",
      items: { type: "string" },
      description: "Optional files or directories likely relevant to the task.",
    },
    constraints: {
      type: "array",
      items: { type: "string" },
      description: "Rules the worker must follow, such as preserving APIs, avoiding unrelated changes, or matching existing style.",
    },
    acceptance_criteria: {
      type: "array",
      items: { type: "string" },
      description: "Concrete conditions that define when the delegated task is complete.",
    },
    allowed_commands: {
      type: "array",
      items: { type: "string" },
      description: "Optional commands or command patterns the worker is allowed to run.",
    },
    forbidden_actions: {
      type: "array",
      items: { type: "string" },
      description: "Actions the worker must not perform, such as deleting files, changing unrelated modules, modifying secrets, or pushing to remote repositories.",
    },
    return_format: {
      type: "string",
      default: "structured_report",
      description: "Expected result format. Defaults to a structured execution report.",
    },
    timeout_ms: {
      type: "integer",
      minimum: 1000,
      description: "Optional timeout in milliseconds. Defaults to CC_CLAUDE_TIMEOUT_MS.",
    },
    max_turns: {
      type: "integer",
      minimum: 1,
      description: "Optional Claude Code max turns. Defaults to CC_CLAUDE_MAX_TURNS.",
    },
    model: {
      type: "string",
      description: "Optional Claude Code model override.",
    },
    path: {
      type: "string",
      description: "For append_file/finalize_file: destination path inside the worker workspace.",
    },
    transfer_id: {
      type: "string",
      description: "For append_file/finalize_file: optional stable upload id.",
    },
    chunk_base64: {
      type: "string",
      description: "For append_file: a base64/base64url chunk of the final file. Keep chunks around 1500 characters.",
    },
    chunk_index: {
      type: "integer",
      minimum: 0,
      description: "For append_file: optional zero-based chunk index. cc-mcp rejects out-of-order chunks.",
    },
    reset: {
      type: "boolean",
      default: false,
      description: "For append_file: set true on the first chunk to overwrite any previous staged upload.",
    },
    sha256: {
      type: "string",
      description: "For finalize_file: expected sha256 hex digest of the decoded final file.",
    },
    command: {
      type: "string",
      description: "For run_command: command to run in the worker workspace.",
    },
    args: {
      type: "array",
      items: { type: "string" },
      description: "For run_command: optional argv list.",
    },
    shell: {
      type: "boolean",
      description: "For run_command: run through the platform shell.",
    },
    env: {
      type: "object",
      description: "For run_command: optional extra environment variables.",
    },
  },
  required: [],
};

function delegatedToolDescription(): string {
  return "Delegate one concrete coding task to the configured Claude Code worker through cc-mcp. Use this as the single cc-mcp entrypoint. For normal delegated coding work, always call action=start first, then repeatedly call action=tail with the returned session_id and latest nextOffset to surface progress, then call action=result when the session is done. Use action=task only when the user explicitly asks for a single blocking synchronous call. Once delegated, the worker performs file edits, shell commands, tests, and inspection inside its configured workspace while the main harness supervises and verifies. Do not put long scripts, huge base64 payloads, or heredocs in task; if chunked transfer is absolutely needed, use this same delegate tool with action=append_file, action=finalize_file, then action=run_command.";
}

const workspaceAppendFileSchema: Tool["inputSchema"] = {
  type: "object",
  properties: {
    workspace: {
      type: "string",
      description: "Optional absolute worker workspace. If omitted, cc-mcp uses the configured Claude Code Workdir.",
    },
    path: {
      type: "string",
      description: "Destination file path inside the worker workspace. Relative paths are resolved from workspace.",
    },
    transfer_id: {
      type: "string",
      description: "Optional stable id for this upload. Omit to derive it from workspace and path.",
    },
    chunk_base64: {
      type: "string",
      description: "A base64/base64url chunk of the final file. Keep chunks around 1500 characters.",
    },
    chunk_index: {
      type: "integer",
      minimum: 0,
      description: "Optional zero-based chunk index. cc-mcp rejects out-of-order chunks.",
    },
    reset: {
      type: "boolean",
      default: false,
      description: "Set true on the first chunk to overwrite any previous staged upload for this transfer.",
    },
  },
  required: ["path", "chunk_base64"],
};

const workspaceFinalizeFileSchema: Tool["inputSchema"] = {
  type: "object",
  properties: {
    workspace: {
      type: "string",
      description: "Optional absolute worker workspace. If omitted, cc-mcp uses the configured Claude Code Workdir.",
    },
    path: {
      type: "string",
      description: "Destination file path inside the worker workspace. Must match the upload path.",
    },
    transfer_id: {
      type: "string",
      description: "Optional stable id used for workspace_append_file.",
    },
    sha256: {
      type: "string",
      description: "Expected sha256 hex digest of the decoded final file. Required.",
    },
    mode: {
      type: "string",
      description: "Optional octal file mode, for example 755 for executable scripts.",
    },
  },
  required: ["path", "sha256"],
};

const workspaceRunCommandSchema: Tool["inputSchema"] = {
  type: "object",
  properties: {
    workspace: {
      type: "string",
      description: "Optional absolute worker workspace. If omitted, cc-mcp uses the configured Claude Code Workdir.",
    },
    command: {
      type: "string",
      description: "Command to run in the worker workspace. For staged scripts, prefer commands such as python3 .mcp/uploaded.py.",
    },
    args: {
      type: "array",
      items: { type: "string" },
      description: "Optional argv list. When provided, shell defaults to false.",
    },
    shell: {
      type: "boolean",
      description: "Run through the platform shell. Defaults to true when args is omitted, false otherwise.",
    },
    timeout_ms: {
      type: "integer",
      minimum: 1000,
      description: "Optional command timeout in milliseconds. Defaults to 120000.",
    },
    env: {
      type: "object",
      description: "Optional extra environment variables for this command.",
    },
  },
  required: ["command"],
};

function delegatedSchemaForEnv(): Tool["inputSchema"] {
  return {
    ...delegatedCodingTaskSchema,
    properties: {
      ...delegatedCodingTaskSchema.properties,
      workspace: {
        type: "string",
        description: "Optional absolute path where Claude Code should run. It must exist in the configured worker environment. If omitted, cc-mcp uses the configured Claude Code Workdir.",
      },
    },
  };
}

export function ccToolsFromEnv(env: Record<string, string | undefined> = process.env): Tool[] {
  void env;
  const schema = delegatedSchemaForEnv();
  return [
  {
    name: "delegate",
    description: delegatedToolDescription(),
    inputSchema: schema,
  },
  ];
}

export const CC_TOOLS: Tool[] = ccToolsFromEnv({});

const callbackMessageSchema: Tool["inputSchema"] = {
  type: "object",
  properties: {
    session_id: {
      type: "string",
      description: "Optional session id. Defaults to the active cc-mcp session injected into this callback server.",
    },
    type: {
      type: "string",
      enum: ["progress", "final", "error", "note"],
      description: "Callback message type.",
    },
    message: {
      type: "string",
      description: "Callback message text.",
    },
    metadata: {
      type: "object",
      description: "Optional structured metadata.",
    },
  },
  required: ["type", "message"],
};

const callbackTaskSchema: Tool["inputSchema"] = {
  type: "object",
  properties: {
    session_id: {
      type: "string",
      description: "Optional session id. Defaults to the active cc-mcp session injected into this callback server.",
    },
  },
};

export const CC_CALLBACK_TOOLS: Tool[] = [
  {
    name: "send_message_to_harness",
    description: "Send a progress or final callback message from Claude Code back to the active main harness delegation session.",
    inputSchema: callbackMessageSchema,
  },
  {
    name: "read_harness_task",
    description: "Read the current main harness delegation task details for the active Claude Code callback session.",
    inputSchema: callbackTaskSchema,
  },
];
