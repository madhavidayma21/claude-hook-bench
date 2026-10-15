// The JSON Claude Code sends a hook, built for each event and matcher value. Field names, their order and their
// types follow what Claude Code 2.1.295 sent a recording hook on 2026-10-15 (events marked "recorded" in
// events.mjs) or the hooks reference's examples (events marked "docs"); README "What was verified" has the list.
//
// A fixture is { value, label, input, verified }: `value` is what the event's matcher is tested against, `input`
// the JSON for stdin. Paths point into the project the bench was given; file tools name a file that does not
// exist (src/hook-bench-sample.ts), so that a formatter hook changes nothing real; --file changes that.
import path from "node:path";
import { eventByName, TOOL_EVENTS } from "./events.mjs";

/** Realistic inputs per tool: tool_input, a PostToolUse tool_response, a PostToolUseFailure error, the serialized result PostToolBatch carries. */
export const TOOLS = {
  Bash: {
    verified: "recorded",
    input: (c) => ({ command: c.command || "npm test", description: c.command ? "Run the command" : "Run the test suite" }),
    response: () => ({ stdout: "> test\n> node --test\n\n# pass 12\n# fail 0", stderr: "", interrupted: false, isImage: false, noOutputExpected: false }),
    error: () => "Exit code 1\n> test\n> node --test\n\n# pass 11\n# fail 1",
    serialized: () => "> test\n> node --test\n\n# pass 12\n# fail 0",
  },
  PowerShell: {
    verified: "docs",
    input: (c) => ({ command: c.command || "Get-ChildItem -Recurse -Filter *.test.mjs", description: c.command ? "Run the command" : "List the test files" }),
    response: () => ({ stdout: "test\\cli.test.mjs\ntest\\events.test.mjs", stderr: "", interrupted: false, isImage: false, noOutputExpected: false }),
    error: () => "Exit code 1\nGet-ChildItem : Cannot find path",
    serialized: () => "test\\cli.test.mjs\ntest\\events.test.mjs",
  },
  Read: {
    verified: "recorded",
    input: (c) => ({ file_path: c.readFile }),
    response: (c) => ({ type: "text", file: { filePath: c.readFile, content: "# Project\n\nNotes.\n", numLines: 4, startLine: 1, totalLines: 4 } }),
    error: () => "File does not exist.",
    serialized: () => "1\t# Project\n2\t\n3\tNotes.\n4\t",
  },
  Write: {
    verified: "recorded",
    input: (c) => ({ file_path: c.file, content: "export const answer = 42;\n" }),
    response: (c) => ({ type: "create", filePath: c.file, content: "export const answer = 42;\n", structuredPatch: [], originalFile: null, userModified: false }),
    error: (c) => `EACCES: permission denied, open '${c.file}'`,
    serialized: (c) => `File created successfully at: ${c.file}`,
  },
  Edit: {
    verified: "recorded",
    input: (c) => ({ file_path: c.file, old_string: "const answer = 41;", new_string: "const answer = 42;", replace_all: false }),
    response: (c) => ({ filePath: c.file, oldString: "const answer = 41;", newString: "const answer = 42;", originalFile: "export const answer = 41;\n", structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-export const answer = 41;", "+export const answer = 42;"] }], userModified: false, replaceAll: false }),
    error: () => "String to replace not found in file.",
    serialized: (c) => `The file ${c.file} has been updated successfully.`,
  },
  Glob: {
    verified: "recorded",
    input: () => ({ pattern: "**/*.ts" }),
    response: () => ({ filenames: ["src/index.ts", "src/util.ts"], durationMs: 12, numFiles: 2, truncated: false, totalMatches: 2, countIsComplete: true }),
    error: () => "Path does not exist.",
    serialized: () => "src/index.ts\nsrc/util.ts",
  },
  Grep: {
    verified: "recorded",
    input: () => ({ pattern: "TODO", output_mode: "content" }),
    response: () => ({ mode: "content", numFiles: 0, filenames: [], content: "src/index.ts:12:// TODO: handle the empty case", numLines: 1, totalLines: 1 }),
    error: () => "Invalid regex pattern.",
    serialized: () => "src/index.ts:12:// TODO: handle the empty case",
  },
  WebFetch: {
    verified: "docs",
    input: () => ({ url: "https://example.com/docs/page", prompt: "Extract the API endpoints" }),
    response: () => ({ bytes: 1256, code: 200, codeText: "OK", result: "The page lists two endpoints.", durationMs: 540, url: "https://example.com/docs/page" }),
    error: () => "Request failed with status 404",
    serialized: () => "The page lists two endpoints.",
  },
  WebSearch: {
    verified: "docs",
    input: () => ({ query: "node test runner reporters" }),
    response: () => ({ query: "node test runner reporters", results: [{ title: "Test runner | Node.js documentation", url: "https://nodejs.org/api/test.html" }], durationSeconds: 2 }),
    error: () => "Search failed",
    serialized: () => "Web search results for query: \"node test runner reporters\"",
  },
  Agent: {
    verified: "recorded",
    input: () => ({ description: "Find the hook settings", prompt: "Find where hooks are configured in this project and list the files.", subagent_type: "Explore" }),
    response: () => ({ status: "completed", agentId: "a4d2c8f1e0b3a297", content: [{ type: "text", text: "Hooks are configured in .claude/settings.json." }], resolvedModel: "claude-sonnet-5-5", totalTokens: 12450, totalDurationMs: 48211, totalToolUseCount: 7, usage: { input_tokens: 8320, output_tokens: 410, cache_creation_input_tokens: 0, cache_read_input_tokens: 3720 } }),
    error: () => "Agent terminated",
    serialized: () => "Hooks are configured in .claude/settings.json.",
  },
  mcp__memory__create_entities: {
    verified: "docs",
    mcp: { name: "memory", source: "user" },
    input: () => ({ entities: [{ name: "hook-bench", entityType: "tool", observations: ["runs every hook"] }] }),
    response: () => [{ type: "text", text: "Created 1 entity" }],
    error: () => "MCP error -32603: Internal error",
    serialized: () => "Created 1 entity",
  },
};

/** The tool names in display order. */
export const TOOL_NAMES = Object.keys(TOOLS);

const DEFAULTS = {
  SessionStart: ["startup", "resume"],
  Setup: ["init"],
  InstructionsLoaded: ["session_start"],
  Notification: ["permission_prompt", "idle_prompt"],
  StopFailure: ["rate_limit"],
  ConfigChange: ["project_settings"],
  DirectoryAdded: ["slash_command"],
  PreCompact: ["manual"],
  PostCompact: ["manual"],
  SessionEnd: ["other"],
  UserPromptExpansion: ["review"],
  SubagentStart: ["Explore"],
  SubagentStop: ["Explore"],
  FileChanged: [".envrc"],
  PreModelSwitch: ["claude-opus-5"],
  PostModelSwitch: ["claude-opus-5"],
  Elicitation: ["issue-tracker"],
  ElicitationResult: ["issue-tracker"],
};

/**
 * The session a bench run pretends to be: ids, the transcript file it wrote, the project folder.
 *   { sessionId, promptId, transcriptPath, agentTranscriptPath, cwd, project, permissionMode, effort, file, readFile, command, home }
 */
export function sessionContext({ project, sessionId, promptId, transcriptPath, agentTranscriptPath, file, readFile, command, permissionMode = "default", effort = "medium", home }) {
  return {
    sessionId, promptId, transcriptPath, agentTranscriptPath, cwd: project, project, permissionMode, effort, home,
    file: file || path.join(project, "src", "hook-bench-sample.ts"),
    readFile: readFile || file || path.join(project, "README.md"),
    command: command || null,
  };
}

// Common fields in the order Claude Code writes them; the tool and turn events add prompt_id, permission_mode and effort.
const base = (c, name, { prompt = true, mode = false, effort = false } = {}) => {
  const o = { session_id: c.sessionId, transcript_path: c.transcriptPath, cwd: c.cwd };
  if (prompt) o.prompt_id = c.promptId;
  if (mode) o.permission_mode = c.permissionMode;
  if (effort) o.effort = { level: c.effort };
  o.hook_event_name = name;
  return o;
};
const toolBase = (c, name) => base(c, name, { mode: true, effort: true });
const toolUseId = (n) => `toolu_01HB${String(n).padStart(4, "0")}BENCH00000000`;

function toolFixture(event, toolName, c) {
  const t = TOOLS[toolName] || (toolName.startsWith("mcp__") ? { ...TOOLS.mcp__memory__create_entities, mcp: { name: toolName.split("__")[1] || "server", source: "user" }, verified: "docs" } : null);
  const verified = t ? (event.verified === "recorded" && t.verified === "recorded" ? "recorded" : "docs") : "none";
  const input = t ? t.input(c) : {};
  const o = toolBase(c, event.name);
  o.tool_name = toolName;
  o.tool_input = input;
  if (t && t.mcp) o.mcp_server = t.mcp;
  switch (event.name) {
    case "PreToolUse":
      o.tool_use_id = toolUseId(1);
      break;
    case "PostToolUse":
      o.tool_response = t ? t.response(c) : {};
      o.tool_use_id = toolUseId(1);
      o.duration_ms = 42;
      break;
    case "PostToolUseFailure":
      o.tool_use_id = toolUseId(1);
      o.error = t ? t.error(c) : "Error";
      o.is_interrupt = false;
      o.duration_ms = 4187;
      break;
    case "PermissionRequest":
      delete o.tool_use_id;
      o.permission_suggestions = toolName === "Bash" || toolName === "PowerShell"
        ? [{ type: "addRules", rules: [{ toolName, ruleContent: `${String(input.command || "").split(/\s+/).slice(0, 2).join(" ")}:*` }], behavior: "allow", destination: "localSettings" }]
        : [{ type: "setMode", mode: "acceptEdits", destination: "session" }];
      break;
    case "PermissionDenied":
      o.permission_mode = "auto";
      o.tool_use_id = toolUseId(1);
      o.reason = "[Irreversible Local Destruction]";
      break;
    default:
  }
  const note = t ? null : `no realistic input is known for a tool named ${toolName}; tool_input is empty`;
  return { value: toolName, label: toolName, input: o, verified, note };
}

const SAMPLE_TASKS = { background_tasks: [], session_crons: [] };

/** The one fixture of an event for a matcher value (null for events without a matcher). */
export function fixtureFor(eventName, value, c) {
  const event = eventByName(eventName);
  if (!event) return null;
  if (TOOL_EVENTS.includes(eventName)) return toolFixture(event, value || "Bash", c);
  const v = value;
  const fx = (input, label = v) => ({ value: v, label, input, verified: event.verified, note: null });
  switch (eventName) {
    case "SessionStart": {
      const o = base(c, eventName, { prompt: false });
      o.source = v;
      if (v === "resume" || v === "fork") Object.assign(o, { model: "claude-opus-5-5", seconds_since_last_response: 5400, context_tokens: 182340, prompt_cache_likely_expired: true, estimated_cache_write_usd: 1.1396 });
      return fx(o);
    }
    case "Setup": {
      const o = base(c, eventName, { prompt: false });
      o.trigger = v;
      return fx(o);
    }
    case "InstructionsLoaded": {
      const o = base(c, eventName, { prompt: false });
      Object.assign(o, { file_path: path.join(c.project, "CLAUDE.md"), memory_type: "Project", load_reason: v });
      return fx(o);
    }
    case "UserPromptSubmit": {
      const o = base(c, eventName, { mode: true });
      o.prompt = "Write a function to calculate the factorial of a number";
      return fx(o, "prompt");
    }
    case "UserPromptExpansion": {
      const o = base(c, eventName, { mode: true });
      Object.assign(o, { expansion_type: "slash_command", command_name: v, command_args: "src/index.ts", command_source: "projectSettings", prompt: `/${v} src/index.ts` });
      return fx(o);
    }
    case "MessageDisplay": {
      const o = base(c, eventName);
      Object.assign(o, { turn_id: "0c9e6a2f-7d41-4f4e-9a15-3f4f7c2b8d10", message_id: "5b2a9c8e-1f63-4d8a-b7c4-9e0d2a6f1c3b", index: 0, final: true, delta: "Here is the plan:\n\n1. Add the test.\n2. Run it.\n" });
      return fx(o, "message");
    }
    case "PostToolBatch": {
      const o = toolBase(c, eventName);
      o.tool_calls = ["Read", "Grep"].map((name, i) => ({ tool_name: name, tool_input: TOOLS[name].input(c), tool_use_id: toolUseId(i + 1), tool_response: TOOLS[name].serialized(c) }));
      return fx(o, "batch");
    }
    case "Notification": {
      const o = base(c, eventName, { prompt: false });
      const text = {
        permission_prompt: ["Claude needs your permission to use Bash", "Permission needed"], idle_prompt: ["Claude is waiting for your input", "Claude Code"],
        auth_success: ["Authentication successful", "Claude Code"], elicitation_dialog: ["issue-tracker is asking for input", "Input needed"],
        elicitation_url_dialog: ["issue-tracker asks you to open a URL", "Input needed"], elicitation_complete: ["issue-tracker finished the browser step", "Claude Code"],
        elicitation_response: ["Your answer was sent to issue-tracker", "Claude Code"], agent_needs_input: ["A background session needs your input", "Claude Code"],
        agent_completed: ["A background session finished", "Claude Code"], quota_auto_resume_fired: ["Usage limit reset; continuing your task", "Claude Code"],
        quota_auto_resume_stale: ["Usage limit reset while your computer slept; press Enter to continue", "Claude Code"], quota_auto_resume_disabled: ["Claude Code stopped waiting for the usage limit", "Claude Code"],
      }[v] || ["Claude Code needs your attention", "Claude Code"];
      Object.assign(o, { message: text[0], title: text[1], notification_type: v });
      return fx(o);
    }
    case "SubagentStart": {
      const o = { session_id: c.sessionId, transcript_path: c.transcriptPath, cwd: c.cwd, prompt_id: c.promptId, agent_id: "a4d2c8f1e0b3a297", agent_type: v, hook_event_name: eventName };
      return fx(o);
    }
    case "SubagentStop": {
      const o = { session_id: c.sessionId, transcript_path: c.transcriptPath, cwd: c.cwd, prompt_id: c.promptId, permission_mode: c.permissionMode, agent_id: "a4d2c8f1e0b3a297", agent_type: v, effort: { level: c.effort }, hook_event_name: eventName, stop_hook_active: false, agent_transcript_path: c.agentTranscriptPath, last_assistant_message: "Analysis complete. Hooks are configured in .claude/settings.json.", ...SAMPLE_TASKS };
      return fx(o);
    }
    case "TaskCreated":
    case "TaskCompleted": {
      const o = base(c, eventName, { mode: eventName === "TaskCompleted" });
      Object.assign(o, { task_id: "task-001", task_subject: "Implement user authentication", task_description: "Add login and signup endpoints", teammate_name: "implementer", team_name: "session-a1b2c3d4" });
      return fx(o, "task");
    }
    case "Stop": {
      const o = base(c, eventName, { mode: true, effort: true });
      Object.assign(o, { stop_hook_active: false, last_assistant_message: "I've added the test and it passes. Here's a summary of the change.", ...SAMPLE_TASKS });
      return fx(o, "stop");
    }
    case "StopFailure": {
      const o = base(c, eventName, { prompt: true });
      const details = { rate_limit: "429 Too Many Requests", overloaded: "529 Overloaded", authentication_failed: "401 Unauthorized", server_error: "500 Internal Server Error", invalid_request: "400 Bad Request", max_output_tokens: "The response reached max_output_tokens" }[v] || v;
      Object.assign(o, { error: v, error_details: details, last_assistant_message: `API Error: ${details}` });
      return fx(o);
    }
    case "TeammateIdle": {
      const o = base(c, eventName, { mode: true });
      Object.assign(o, { teammate_name: "researcher", team_name: "session-a1b2c3d4" });
      return fx(o, "teammate");
    }
    case "ConfigChange": {
      const o = base(c, eventName);
      const files = { user_settings: path.join(c.home || c.project, ".claude", "settings.json"), project_settings: path.join(c.project, ".claude", "settings.json"), local_settings: path.join(c.project, ".claude", "settings.local.json"), policy_settings: "managed-settings.json", skills: path.join(c.project, ".claude", "skills", "review", "SKILL.md") };
      o.source = v;
      o.file_path = files[v] || files.project_settings;
      return fx(o);
    }
    case "CwdChanged": {
      const o = base(c, eventName);
      o.cwd = path.join(c.project, "src");
      Object.assign(o, { old_cwd: c.project, new_cwd: path.join(c.project, "src") });
      return fx(o, "cwd");
    }
    case "DirectoryAdded": {
      const o = base(c, eventName);
      Object.assign(o, { directory: path.join(path.dirname(c.project), "other-repo"), source: v });
      return fx(o);
    }
    case "FileChanged": {
      const o = base(c, eventName);
      Object.assign(o, { file_path: path.join(c.project, v), event: "change" });
      return fx(o);
    }
    case "WorktreeCreate": {
      const o = base(c, eventName, { prompt: false });
      o.name = "feature-auth";
      return fx(o, "worktree");
    }
    case "WorktreeRemove": {
      const o = base(c, eventName, { prompt: false });
      o.worktree_path = path.join(c.project, ".claude", "worktrees", "feature-auth");
      return fx(o, "worktree");
    }
    case "PreCompact": {
      const o = base(c, eventName);
      Object.assign(o, { trigger: v, custom_instructions: null });
      return fx(o);
    }
    case "PostCompact": {
      const o = base(c, eventName);
      Object.assign(o, { trigger: v, compact_summary: "The user asked for a factorial function; it was written in src/math.ts with a test." });
      return fx(o);
    }
    case "PreModelSwitch":
    case "PostModelSwitch": {
      const o = base(c, eventName);
      Object.assign(o, { from_model: "claude-sonnet-5-5", to_model: v, requested_model: v.includes("opus") ? "opus" : v, source: eventName === "PostModelSwitch" ? "command" : "command", context_tokens: 182340, prompt_cache_warm: true, cache_ttl: "5m", estimated_cache_write_usd: 1.1396, pricing: "catalog" });
      return fx(o);
    }
    case "SessionEnd": {
      const o = base(c, eventName);
      o.reason = v;
      return fx(o);
    }
    case "Elicitation": {
      const o = base(c, eventName, { prompt: false });
      Object.assign(o, { mcp_server_name: v, message: "Which project key should the issue use?", mode: "form", requested_schema: { type: "object", properties: { project_key: { type: "string", title: "Project key" } } } });
      return fx(o);
    }
    case "ElicitationResult": {
      const o = base(c, eventName, { prompt: false });
      Object.assign(o, { mcp_server_name: v, action: "accept", content: { project_key: "DOCS" }, mode: "form" });
      return fx(o);
    }
    default:
      return null;
  }
}

/** The matcher values the bench uses for an event when the matcher is a catch-all. */
export const defaultValues = (eventName) => (TOOL_EVENTS.includes(eventName) ? TOOL_NAMES : DEFAULTS[eventName] || [null]);

/** Every documented value of a closed-set event, else the defaults. */
export function candidateValues(event) {
  if (TOOL_EVENTS.includes(event.name)) return TOOL_NAMES;
  if (Array.isArray(event.values)) return event.values;
  return DEFAULTS[event.name] || [null];
}
