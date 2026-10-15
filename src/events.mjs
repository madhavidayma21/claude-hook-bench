// Every hook event Claude Code fires, as the hooks reference describes it (https://code.claude.com/docs/en/hooks,
// read on 2026-10-15) and as the binary showed it (2.1.295, see README "What was verified"):
//   matcher      the input field the matcher is tested against, or null when the event has no matcher support
//   values       the documented matcher values (a closed set), or "open" when any value can occur (tool names,
//                agent types, command names, server names, file names, model names)
//   narrow       FileChanged and StopFailure: only letters, digits, _ and | count as an exact-match list
//   types        the handler types the event runs
//   timeout      the default timeout in seconds for command, http and mcp_tool hooks
//   exit2        what exit code 2 does: blocks (true), or the text of the table row
//   plainStdout  "context": plain stdout on exit 0 reaches Claude; "path": the worktree path; else the debug log only
//   fields       hookSpecificOutput fields Claude Code reads on this event, with the type each must have
//   decision     "block" when a top-level decision: "block" does something here (with what it does)
//   continue     what { "continue": false } does, or null when the event discards it
//   systemMessage what a systemMessage does, or null when the event discards it
//   verified     "recorded": the input shape was recorded from the real binary; "docs": from the reference only
//
// Type words used in `fields`: string, boolean, number, object, array, string[], any, and enum:a|b|c.

const ALL = ["command", "http", "mcp_tool", "prompt", "agent"];
const NO_MODEL = ["command", "http", "mcp_tool"];
const NO_AGENT = ["command", "http", "mcp_tool", "prompt"];

export const TOOL_EVENTS = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PermissionDenied"];

/** The order the reference lists the events in (the lifecycle). */
export const EVENTS = [
  {
    name: "SessionStart", when: "when a session begins or resumes", matcher: "source", values: ["startup", "resume", "clear", "compact", "fork"],
    types: ["command", "mcp_tool"], timeout: 600, exit2: "Shows stderr to the user only; the session proceeds", plainStdout: "context",
    fields: { additionalContext: "string", initialUserMessage: "string", sessionTitle: "string", watchPaths: "string[]", reloadSkills: "boolean" },
    decision: null, continue: null, systemMessage: "shown to the user", verified: "recorded",
    notes: ["Plain stdout on exit 0 is added to Claude's context, so a hook that only adds context can print it without JSON.", "CLAUDE_ENV_FILE names a file where `export NAME=value` lines persist into the session's Bash commands.", "mcp_tool hooks are skipped at launch (no MCP client yet)."],
  },
  {
    name: "Setup", when: "with --init-only, or with --init or --maintenance in -p mode", matcher: "trigger", values: ["init", "maintenance"],
    types: ["command", "mcp_tool"], timeout: 600, exit2: "Exit code and stderr are ignored", plainStdout: "log",
    fields: {}, decision: null, continue: null, systemMessage: null, verified: "recorded",
    notes: ["Every JSON output field is discarded; only side effects and CLAUDE_ENV_FILE matter.", "mcp_tool hooks on Setup are always skipped."],
  },
  {
    name: "InstructionsLoaded", when: "when a CLAUDE.md or .claude/rules file is loaded", matcher: "load_reason", values: ["session_start", "nested_traversal", "path_glob_match", "include", "compact"],
    types: NO_MODEL, timeout: 600, exit2: "Exit code is ignored", plainStdout: "log",
    fields: {}, decision: null, continue: null, systemMessage: null, verified: "recorded",
    notes: ["Observability only: Claude Code discards every JSON output field."],
  },
  {
    name: "UserPromptSubmit", when: "when a prompt is submitted, before Claude reads it", matcher: null, values: null,
    types: ALL, timeout: 30, exit2: true, plainStdout: "context",
    fields: { additionalContext: "string", sessionTitle: "string", suppressOriginalPrompt: "boolean" },
    decision: "blocks the prompt, so it never reaches Claude; the reason is shown to the user", continue: "stops Claude", systemMessage: "shown to the user", verified: "recorded",
    notes: ["Plain stdout on exit 0 reaches Claude as context.", "The default timeout is 30 seconds, not 600; a timed-out hook's output is discarded and the prompt goes through.", "Also fires for scheduled tasks, background subagents reporting back and messages from other sessions."],
  },
  {
    name: "UserPromptExpansion", when: "when a typed /command expands into a prompt", matcher: "command_name", values: "open",
    types: ALL, timeout: 600, exit2: true, plainStdout: "context",
    fields: { additionalContext: "string" }, decision: "blocks the expansion; the reason is shown to the user", continue: "stops Claude", systemMessage: "shown to the user", verified: "recorded",
  },
  {
    name: "MessageDisplay", when: "while an assistant message is displayed", matcher: null, values: null,
    types: NO_MODEL, timeout: 10, exit2: "The original text is displayed", plainStdout: "log",
    fields: { displayContent: "string" }, decision: null, continue: null, systemMessage: null, verified: "recorded",
    notes: ["Display only: displayContent changes what is shown, never the transcript or what Claude sees.", "In -p runs it fires once per message with the whole text; the default timeout is 10 seconds."],
  },
  {
    name: "PreToolUse", when: "before a tool call runs", matcher: "tool_name", values: "open",
    types: ALL, timeout: 600, exit2: true, plainStdout: "log",
    fields: { permissionDecision: "enum:allow|deny|ask|defer", permissionDecisionReason: "string", updatedInput: "object", additionalContext: "string" },
    decision: "deprecated here: \"block\" means deny and \"approve\" means allow", continue: "stops Claude after the hook (the tool call still went ahead when checked on 2.1.295)", systemMessage: "shown to the user", verified: "recorded",
    notes: ["Precedence between hooks: deny > defer > ask > allow.", "A timed-out command hook does not block (set onFailure: \"block\" to change that).", "Staying silent does not approve: the normal permission flow applies."],
  },
  {
    name: "PermissionRequest", when: "when Claude Code is about to ask you for permission", matcher: "tool_name", values: "open",
    types: NO_AGENT, timeout: 600, exit2: "Not honored: the permission flow proceeds unchanged and stderr is discarded", plainStdout: "log",
    fields: { decision: "object" }, decisionObject: { behavior: "enum:allow|deny", updatedInput: "object", updatedPermissions: "array", message: "string", interrupt: "boolean" },
    decision: null, continue: "stops Claude", systemMessage: "shown to the user", verified: "recorded",
    notes: ["Only the hookSpecificOutput.decision object decides; in a -p run with no one to ask, a call no hook decides is denied."],
  },
  {
    name: "PostToolUse", when: "after a tool call succeeds", matcher: "tool_name", values: "open",
    types: ALL, timeout: 600, exit2: "Shows stderr to Claude; the tool already ran", plainStdout: "log",
    fields: { additionalContext: "string", classifierContext: "string", updatedToolOutput: "any", updatedMCPToolOutput: "any" },
    decision: "adds the reason next to the tool result (Claude still sees the original output)", continue: "stops Claude", systemMessage: "shown to the user", verified: "recorded",
    notes: ["updatedToolOutput must match the tool's own output shape (Bash: stdout, stderr, interrupted, isImage); otherwise it is ignored and the original is kept."],
  },
  {
    name: "PostToolUseFailure", when: "after a tool call fails", matcher: "tool_name", values: "open",
    types: ALL, timeout: 600, exit2: "Shows stderr to Claude; the tool already failed", plainStdout: "log",
    fields: { additionalContext: "string" }, decision: "adds the reason next to the error", continue: "stops Claude", systemMessage: "shown to the user", verified: "recorded",
    notes: ["Does not fire for calls rejected before they ran (unknown tool, bad input, a permission denial)."],
  },
  {
    name: "PostToolBatch", when: "after a batch of parallel tool calls, before the next model call", matcher: null, values: null,
    types: ALL, timeout: 600, exit2: true, plainStdout: "log",
    fields: { additionalContext: "string" }, decision: "stops the agentic loop before the next model call; the reason stays in the conversation", continue: "stops the loop before the next model call", systemMessage: "shown to the user", verified: "recorded",
    notes: ["tool_response here is the serialized text the model sees, not PostToolUse's structured object."],
  },
  {
    name: "PermissionDenied", when: "when auto mode denies a tool call", matcher: "tool_name", values: "open",
    types: ALL, timeout: 600, exit2: "Exit code and stderr are ignored; the denial already happened", plainStdout: "log",
    fields: { retry: "boolean" }, decision: null, continue: null, systemMessage: null, verified: "docs",
    notes: ["Only in auto mode; retry: true tells the model it may try again (ignored for no-verdict denials)."],
  },
  {
    name: "Notification", when: "when Claude Code sends a notification", matcher: "notification_type",
    values: ["permission_prompt", "idle_prompt", "auth_success", "elicitation_dialog", "elicitation_url_dialog", "elicitation_complete", "elicitation_response", "agent_needs_input", "agent_completed", "quota_auto_resume_fired", "quota_auto_resume_stale", "quota_auto_resume_disabled"],
    types: NO_MODEL, timeout: 600, exit2: "Exit code and stderr are ignored", plainStdout: "log",
    fields: {}, decision: null, continue: null, systemMessage: null, verified: "docs",
    notes: ["systemMessage and continue are discarded; terminalSequence still works (an interactive session only)."],
  },
  {
    name: "SubagentStart", when: "when a subagent is spawned", matcher: "agent_type", values: "open",
    types: NO_MODEL, timeout: 600, exit2: "Shows stderr in the subagent's transcript; the subagent proceeds", plainStdout: "log",
    fields: { additionalContext: "string" }, decision: null, continue: null, systemMessage: "shown to the user", verified: "recorded",
    notes: ["A plugin subagent's type is plugin-scoped (my-plugin:reviewer); anchor the matcher with ^ and $."],
  },
  {
    name: "SubagentStop", when: "when a subagent finishes", matcher: "agent_type", values: "open",
    types: ALL, timeout: 600, exit2: true, plainStdout: "log",
    fields: { additionalContext: "string" }, decision: "keeps the subagent running and gives it the reason as its next instruction", continue: "stops Claude", systemMessage: "shown to the user", verified: "recorded",
    notes: ["Check stop_hook_active, or a hook that always blocks runs eight times in a row before Claude Code overrides it."],
  },
  {
    name: "TaskCreated", when: "when a task is created with TaskCreate", matcher: null, values: null,
    types: ALL, timeout: 600, exit2: true, plainStdout: "log",
    fields: {}, decision: "cancels the task and returns the reason to Claude as the tool's error", continue: null, systemMessage: "shown to the user", verified: "docs",
    notes: ["continue: false is ignored on this event."],
  },
  {
    name: "TaskCompleted", when: "when a task is marked completed", matcher: null, values: null,
    types: ALL, timeout: 600, exit2: true, plainStdout: "log",
    fields: {}, decision: null, continue: "stops the teammate entirely when a teammate's turn triggered the event; ignored when TaskUpdate did", systemMessage: "shown to the user", verified: "docs",
    notes: ["Exit code 2 keeps the task open and feeds stderr back to the model."],
  },
  {
    name: "Stop", when: "when Claude finishes responding", matcher: null, values: null,
    types: ALL, timeout: 600, exit2: true, plainStdout: "log",
    fields: { additionalContext: "string" }, decision: "keeps Claude working and gives it the reason as its next instruction", continue: "stops Claude", systemMessage: "shown to the user", verified: "recorded",
    notes: ["Check stop_hook_active: Claude Code overrides a Stop hook after eight consecutive blocks.", "additionalContext also continues the conversation, labelled as feedback rather than an error."],
  },
  {
    name: "StopFailure", when: "when the turn ends on an API error", matcher: "error",
    values: ["rate_limit", "overloaded", "authentication_failed", "oauth_org_not_allowed", "account_on_hold", "billing_error", "invalid_request", "model_not_found", "server_error", "max_output_tokens", "cloud_credential_error", "unknown"], narrow: true,
    types: NO_MODEL, timeout: 600, exit2: "Output and exit code are ignored, except terminalSequence", plainStdout: "log",
    fields: {}, decision: null, continue: null, systemMessage: null, verified: "docs",
  },
  {
    name: "TeammateIdle", when: "when an agent team teammate is about to go idle", matcher: null, values: null,
    types: ALL, timeout: 600, exit2: true, plainStdout: "log",
    fields: {}, decision: null, continue: "stops the teammate entirely", systemMessage: "shown to the user", verified: "docs",
    notes: ["Exit code 2 keeps the teammate working with stderr as feedback."],
  },
  {
    name: "ConfigChange", when: "when a settings or skill file changes during a session", matcher: "source", values: ["user_settings", "project_settings", "local_settings", "policy_settings", "skills"],
    types: NO_MODEL, timeout: 600, exit2: true, plainStdout: "log",
    fields: {}, decision: "blocks the change from taking effect (never for policy_settings); nothing is shown to anyone", continue: null, systemMessage: null, verified: "recorded",
  },
  {
    name: "CwdChanged", when: "when a shell command changes the working directory", matcher: null, values: null,
    types: NO_MODEL, timeout: 600, exit2: "Shows stderr to the user only", plainStdout: "log",
    fields: { watchPaths: "string[]" }, decision: null, continue: null, systemMessage: "a brief terminal notification", verified: "docs",
    notes: ["CLAUDE_ENV_FILE is available; variables written there last until the next CwdChanged."],
  },
  {
    name: "DirectoryAdded", when: "when a working directory is added with /add-dir", matcher: "source", values: ["slash_command", "register_repo_root"],
    types: NO_MODEL, timeout: 600, exit2: "Stderr goes to the debug log; the directory is already added", plainStdout: "log",
    fields: {}, decision: null, continue: null, systemMessage: "delivered to Claude as context on the next turn (slash_command) or the debug log (register_repo_root)", verified: "docs",
    notes: ["Runs in the background; the add completes first."],
  },
  {
    name: "FileChanged", when: "when a watched file changes on disk", matcher: "file_name", values: "open", narrow: true,
    types: NO_MODEL, timeout: 600, exit2: "Shows stderr to the user only", plainStdout: "log",
    fields: { watchPaths: "string[]" }, decision: null, continue: null, systemMessage: "a brief terminal notification", verified: "recorded",
    notes: ["The matcher is also the watch list: each |-separated segment is a literal file name in the working directory, so a regex watches a file literally named like it."],
  },
  {
    name: "WorktreeCreate", when: "when a worktree is created", matcher: null, values: null,
    types: NO_MODEL, timeout: 600, exit2: "Any non-zero exit code makes the worktree creation fail", plainStdout: "path",
    fields: { worktreePath: "string" }, decision: null, continue: null, systemMessage: null, verified: "docs",
    notes: ["A command hook prints the worktree path as the last non-empty line of stdout and cannot return JSON; configuring the hook replaces Claude Code's own git worktree behaviour."],
  },
  {
    name: "WorktreeRemove", when: "when a hook-created worktree is removed", matcher: null, values: null,
    types: NO_MODEL, timeout: 600, exit2: "Any non-zero exit code makes the removal fail if the directory still exists", plainStdout: "log",
    fields: {}, decision: null, continue: null, systemMessage: null, verified: "docs",
    notes: ["JSON output is discarded; the exit code and whether the directory is gone decide."],
  },
  {
    name: "PreCompact", when: "before context compaction", matcher: "trigger", values: ["manual", "auto"],
    types: NO_MODEL, timeout: 600, exit2: true, plainStdout: "log",
    fields: {}, decision: "blocks the compaction", continue: null, systemMessage: null, verified: "docs",
  },
  {
    name: "PostCompact", when: "after context compaction", matcher: "trigger", values: ["manual", "auto"],
    types: NO_MODEL, timeout: 600, exit2: "Shows stderr to the user only", plainStdout: "log",
    fields: {}, decision: null, continue: null, systemMessage: null, verified: "docs",
  },
  {
    name: "PreModelSwitch", when: "before a requested model switch", matcher: "to_model", values: "open",
    types: NO_MODEL, timeout: 30, exit2: true, plainStdout: "log",
    fields: { permissionDecision: "enum:allow|deny|ask", permissionDecisionReason: "string" }, decision: "cancels the switch", continue: "stops Claude", systemMessage: "shown to the user whatever the decision", verified: "docs",
    notes: ["A timed-out hook blocks the switch here, unlike on PreToolUse.", "\"ask\" works only for /model in an interactive session; elsewhere it is a refusal."],
  },
  {
    name: "PostModelSwitch", when: "after the session's model changed", matcher: "to_model", values: "open",
    types: NO_MODEL, timeout: 30, exit2: "Shows stderr to the user only; the model already switched", plainStdout: "context",
    fields: { additionalContext: "string" }, decision: null, continue: null, systemMessage: "shown to the user", verified: "docs",
  },
  {
    name: "SessionEnd", when: "when a session ends", matcher: "reason", values: ["clear", "resume", "logout", "prompt_input_exit", "other"],
    types: NO_MODEL, timeout: 1.5, exit2: "Shows stderr to the user only", plainStdout: "log",
    fields: {}, decision: null, continue: null, systemMessage: null, verified: "recorded",
    notes: ["All SessionEnd hooks share a 1.5-second budget; a per-hook timeout in a settings file raises it, up to 60 seconds."],
  },
  {
    name: "Elicitation", when: "when an MCP server asks the user for input", matcher: "mcp_server_name", values: "open",
    types: NO_MODEL, timeout: 600, exit2: true, plainStdout: "log",
    fields: { action: "enum:accept|decline|cancel", content: "object" }, decision: "declines the request", continue: null, systemMessage: null, verified: "docs",
    notes: ["hookSpecificOutput applies on exit 0 only; reason, systemMessage and continue are discarded."],
  },
  {
    name: "ElicitationResult", when: "after the user answers an MCP elicitation", matcher: "mcp_server_name", values: "open",
    types: NO_MODEL, timeout: 600, exit2: true, plainStdout: "log",
    fields: { action: "enum:accept|decline|cancel", content: "object" }, decision: "blocks the response (a decline)", continue: null, systemMessage: null, verified: "docs",
    notes: ["content replaces the user's whole content object; return action with it, or the output is ignored."],
  },
];

export const EVENT_NAMES = EVENTS.map((e) => e.name);
const BY_NAME = new Map(EVENTS.map((e) => [e.name, e]));
export const eventByName = (name) => BY_NAME.get(name) || null;

/** Events on which exit code 2 blocks the action. */
export const blocksOnExit2 = (e) => e.exit2 === true;

/** The default timeout in seconds for a handler of this type on this event. */
export function defaultTimeout(event, type) {
  if (type === "prompt") return 30;
  if (type === "agent") return 60;
  return event ? event.timeout : 600;
}

/** Events where plain stdout on exit 0 reaches Claude as context. */
export const plainStdoutIsContext = (e) => e.plainStdout === "context";

/** The universal fields every event accepts at the top level, with their types (the schema Claude Code prints). */
export const UNIVERSAL = { continue: "boolean", suppressOutput: "boolean", stopReason: "string", decision: "enum:approve|block", reason: "string", systemMessage: "string", terminalSequence: "string", hookSpecificOutput: "object" };

/** Letters, digits, _, -, spaces, commas and |: an exact string or a list; anything else is a regular expression. */
export function matcherKind(matcher, event) {
  if (matcher === undefined || matcher === null || matcher === "" || matcher === "*") return "all";
  if (typeof matcher !== "string") return "invalid";
  const exact = event && event.narrow ? /^[A-Za-z0-9_|]+$/ : /^[A-Za-z0-9_\- ,|]+$/;
  return exact.test(matcher) ? "exact" : "regex";
}

/** The exact values a list matcher names. */
export const matcherList = (matcher, event) => (event && event.narrow ? matcher.split("|") : matcher.split(/[|,]/)).map((s) => s.trim()).filter(Boolean);

/**
 * Does this matcher match the value? Exact strings, |- or ,-separated lists, or an unanchored regular expression,
 * as the reference describes. Returns { match, error } (error when the regex does not compile).
 */
export function matcherMatches(matcher, value, event) {
  const kind = matcherKind(matcher, event);
  if (kind === "all") return { match: true };
  if (kind === "invalid") return { match: false, error: "the matcher is not a string" };
  if (kind === "exact") return { match: matcherList(matcher, event).includes(value) };
  try {
    return { match: new RegExp(matcher).test(value) };
  } catch (e) {
    return { match: false, error: `the matcher is not a valid regular expression (${e.message})` };
  }
}
