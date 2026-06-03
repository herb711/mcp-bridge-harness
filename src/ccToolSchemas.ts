import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const delegatedCodingTaskSchema: Tool["inputSchema"] = {
  type: "object",
  properties: {
    workspace: {
      type: "string",
      description: "Absolute path of the project workspace where the coding task should be executed.",
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
  },
  required: ["workspace", "mode", "task", "acceptance_criteria"],
};

export const CC_TOOLS: Tool[] = [
  {
    name: "delegate_coding_task",
    description: "Delegate a concrete coding subtask to a local autonomous coding executor. Use this tool for implementation, debugging, refactoring, testing, and code review tasks that can be executed inside a specified project workspace. The caller remains responsible for planning, user communication, and final verification. Provide clear goals, context, constraints, target files, and acceptance criteria before delegation.",
    inputSchema: delegatedCodingTaskSchema,
  },
  {
    name: "delegate_to_claude_code",
    description: "Compatibility alias for delegate_coding_task. Prefer delegate_coding_task for new calls so the delegated worker is treated as a local coding executor, not a chat assistant.",
    inputSchema: delegatedCodingTaskSchema,
  },
  {
    name: "claude_code_status",
    description: "Check whether the configured Claude Code command is available for cc-mcp delegation.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

export const CC_CALLBACK_TOOLS: Tool[] = [
  {
    name: "send_message_to_openredou",
    description: "Send a progress or final callback message from Claude Code back to the active OpenRedou delegation session.",
    inputSchema: {
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
    },
  },
  {
    name: "read_openredou_task",
    description: "Read the current OpenRedou delegation task details for the active Claude Code callback session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Optional session id. Defaults to the active cc-mcp session injected into this callback server.",
        },
      },
    },
  },
];
