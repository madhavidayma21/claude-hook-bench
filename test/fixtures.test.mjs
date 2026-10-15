// The JSON the bench sends: the exact key lists (in order) that Claude Code 2.1.295 sent a recording hook on
// 2026-10-15 for the recorded events, the reference's examples for the rest, and the realistic tool inputs.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { EVENTS, TOOL_EVENTS, eventByName } from "../src/events.mjs";
import { TOOLS, TOOL_NAMES, candidateValues, defaultValues, fixtureFor, sessionContext } from "../src/fixtures.mjs";

const ctx = sessionContext({ project: path.resolve("/work/app"), sessionId: "11111111-1111-4111-8111-111111111111", promptId: "22222222-2222-4222-8222-222222222222", transcriptPath: "/cfg/projects/-work-app/11111111-1111-4111-8111-111111111111.jsonl", agentTranscriptPath: "/cfg/projects/-work-app/11111111-1111-4111-8111-111111111111/subagents/agent-a4d2c8f1e0b3a297.jsonl", home: "/home/me" });
const keys = (o) => Object.keys(o);

// Recorded with a hook on every event in a -p run of Claude Code 2.1.295 (Windows), 15 October 2026.
const RECORDED = {
  SessionStart: ["session_id", "transcript_path", "cwd", "hook_event_name", "source"],
  Setup: ["session_id", "transcript_path", "cwd", "hook_event_name", "trigger"],
  InstructionsLoaded: ["session_id", "transcript_path", "cwd", "hook_event_name", "file_path", "memory_type", "load_reason"],
  UserPromptSubmit: ["session_id", "transcript_path", "cwd", "prompt_id", "permission_mode", "hook_event_name", "prompt"],
  UserPromptExpansion: ["session_id", "transcript_path", "cwd", "prompt_id", "permission_mode", "hook_event_name", "expansion_type", "command_name", "command_args", "command_source", "prompt"],
  PreToolUse: ["session_id", "transcript_path", "cwd", "prompt_id", "permission_mode", "effort", "hook_event_name", "tool_name", "tool_input", "tool_use_id"],
  PostToolUse: ["session_id", "transcript_path", "cwd", "prompt_id", "permission_mode", "effort", "hook_event_name", "tool_name", "tool_input", "tool_response", "tool_use_id", "duration_ms"],
  PostToolUseFailure: ["session_id", "transcript_path", "cwd", "prompt_id", "permission_mode", "effort", "hook_event_name", "tool_name", "tool_input", "tool_use_id", "error", "is_interrupt", "duration_ms"],
  PostToolBatch: ["session_id", "transcript_path", "cwd", "prompt_id", "permission_mode", "effort", "hook_event_name", "tool_calls"],
  PermissionRequest: ["session_id", "transcript_path", "cwd", "prompt_id", "permission_mode", "effort", "hook_event_name", "tool_name", "tool_input", "permission_suggestions"],
  SubagentStart: ["session_id", "transcript_path", "cwd", "prompt_id", "agent_id", "agent_type", "hook_event_name"],
  SubagentStop: ["session_id", "transcript_path", "cwd", "prompt_id", "permission_mode", "agent_id", "agent_type", "effort", "hook_event_name", "stop_hook_active", "agent_transcript_path", "last_assistant_message", "background_tasks", "session_crons"],
  MessageDisplay: ["session_id", "transcript_path", "cwd", "prompt_id", "hook_event_name", "turn_id", "message_id", "index", "final", "delta"],
  Stop: ["session_id", "transcript_path", "cwd", "prompt_id", "permission_mode", "effort", "hook_event_name", "stop_hook_active", "last_assistant_message", "background_tasks", "session_crons"],
  SessionEnd: ["session_id", "transcript_path", "cwd", "prompt_id", "hook_event_name", "reason"],
  FileChanged: ["session_id", "transcript_path", "cwd", "prompt_id", "hook_event_name", "file_path", "event"],
  ConfigChange: ["session_id", "transcript_path", "cwd", "prompt_id", "hook_event_name", "source", "file_path"],
};

test("every event has a fixture for each of its candidate values, named after the event", () => {
  for (const e of EVENTS) {
    for (const v of candidateValues(e)) {
      const fx = fixtureFor(e.name, v, ctx);
      assert.ok(fx, `${e.name}:${v}`);
      assert.equal(fx.input.hook_event_name, e.name);
      assert.equal(fx.input.session_id, ctx.sessionId);
      assert.equal(fx.input.transcript_path, ctx.transcriptPath);
      assert.ok(typeof fx.input.cwd === "string" && fx.input.cwd.length, `${e.name}: cwd`);
      if (e.matcher && e.matcher !== "file_name") assert.equal(fx.input[e.matcher], v, `${e.name}: the matcher field carries the value`);
      if (e.matcher === "file_name") assert.equal(path.basename(fx.input.file_path), v);
      assert.ok(["recorded", "docs", "none"].includes(fx.verified));
      JSON.stringify(fx.input);
    }
  }
});

test("the recorded events have exactly the recorded keys, in order", () => {
  for (const [name, expected] of Object.entries(RECORDED)) {
    const e = eventByName(name);
    assert.equal(e.verified, "recorded", `${name} is marked recorded`);
    const value = TOOL_EVENTS.includes(name) ? "Bash" : candidateValues(e)[0];
    const fx = fixtureFor(name, value, ctx);
    assert.deepEqual(keys(fx.input), expected, name);
    assert.equal(fx.verified, "recorded");
  }
  // SessionStart on resume adds the cost fields of 2.1.251+
  assert.deepEqual(keys(fixtureFor("SessionStart", "resume", ctx).input), ["session_id", "transcript_path", "cwd", "hook_event_name", "source", "model", "seconds_since_last_response", "context_tokens", "prompt_cache_likely_expired", "estimated_cache_write_usd"]);
  const nonRecorded = EVENTS.filter((e) => e.verified !== "recorded").map((e) => e.name).sort();
  assert.deepEqual(nonRecorded, ["CwdChanged", "DirectoryAdded", "Elicitation", "ElicitationResult", "Notification", "PermissionDenied", "PostCompact", "PostModelSwitch", "PreCompact", "PreModelSwitch", "StopFailure", "TaskCompleted", "TaskCreated", "TeammateIdle", "WorktreeCreate", "WorktreeRemove"]);
});

test("the recorded field types", () => {
  const pre = fixtureFor("PreToolUse", "Bash", ctx).input;
  assert.equal(typeof pre.prompt_id, "string");
  assert.equal(pre.permission_mode, "default");
  assert.deepEqual(pre.effort, { level: "medium" });
  assert.match(pre.tool_use_id, /^toolu_/);
  const post = fixtureFor("PostToolUse", "Bash", ctx).input;
  assert.deepEqual(keys(post.tool_response), ["stdout", "stderr", "interrupted", "isImage", "noOutputExpected"]);
  assert.equal(typeof post.duration_ms, "number");
  assert.deepEqual(keys(fixtureFor("PostToolUse", "Read", ctx).input.tool_response), ["type", "file"]);
  assert.deepEqual(keys(fixtureFor("PostToolUse", "Read", ctx).input.tool_response.file), ["filePath", "content", "numLines", "startLine", "totalLines"]);
  assert.deepEqual(keys(fixtureFor("PostToolUse", "Write", ctx).input.tool_response), ["type", "filePath", "content", "structuredPatch", "originalFile", "userModified"]);
  assert.deepEqual(keys(fixtureFor("PostToolUse", "Edit", ctx).input.tool_response), ["filePath", "oldString", "newString", "originalFile", "structuredPatch", "userModified", "replaceAll"]);
  assert.deepEqual(keys(fixtureFor("PostToolUse", "Glob", ctx).input.tool_response), ["filenames", "durationMs", "numFiles", "truncated", "totalMatches", "countIsComplete"]);
  assert.deepEqual(keys(fixtureFor("PostToolUse", "Grep", ctx).input.tool_response), ["mode", "numFiles", "filenames", "content", "numLines", "totalLines"]);
  const fail = fixtureFor("PostToolUseFailure", "Bash", ctx).input;
  assert.match(fail.error, /^Exit code \d/);
  assert.equal(fail.is_interrupt, false);
  const batch = fixtureFor("PostToolBatch", null, ctx).input;
  assert.equal(batch.tool_calls.length, 2);
  assert.deepEqual(keys(batch.tool_calls[0]), ["tool_name", "tool_input", "tool_use_id", "tool_response"]);
  assert.equal(typeof batch.tool_calls[0].tool_response, "string", "PostToolBatch carries the serialized text the model sees");
  const stop = fixtureFor("Stop", null, ctx).input;
  assert.equal(stop.stop_hook_active, false);
  assert.ok(Array.isArray(stop.background_tasks) && Array.isArray(stop.session_crons));
  const sub = fixtureFor("SubagentStop", "Explore", ctx).input;
  assert.equal(sub.agent_transcript_path, ctx.agentTranscriptPath);
  const perm = fixtureFor("PermissionRequest", "Write", ctx).input;
  assert.equal(perm.tool_use_id, undefined, "PermissionRequest has no tool_use_id");
  assert.deepEqual(perm.permission_suggestions, [{ type: "setMode", mode: "acceptEdits", destination: "session" }]);
  assert.equal(fixtureFor("PermissionRequest", "Bash", ctx).input.permission_suggestions[0].type, "addRules");
  const disp = fixtureFor("MessageDisplay", null, ctx).input;
  assert.equal(disp.index, 0);
  assert.equal(disp.final, true);
  assert.equal(fixtureFor("PermissionDenied", "Bash", ctx).input.permission_mode, "auto");
  assert.equal(fixtureFor("UserPromptSubmit", null, ctx).input.permission_mode, "default");
  assert.equal(fixtureFor("SessionStart", "startup", ctx).input.permission_mode, undefined, "SessionStart carries no permission_mode");
  assert.equal(fixtureFor("SessionEnd", "other", ctx).input.permission_mode, undefined);
});

test("tool inputs: every tool, the documented fields, and the options that change them", () => {
  assert.deepEqual(TOOL_NAMES, ["Bash", "PowerShell", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "Agent", "mcp__memory__create_entities"]);
  for (const name of TOOL_NAMES) {
    const t = TOOLS[name];
    assert.ok(["recorded", "docs"].includes(t.verified), name);
    for (const fn of ["input", "response", "error", "serialized"]) assert.equal(typeof t[fn], "function", `${name}.${fn}`);
    assert.equal(typeof t.error(ctx), "string");
    assert.equal(typeof t.serialized(ctx), "string");
  }
  assert.deepEqual(TOOLS.Bash.input(ctx), { command: "npm test", description: "Run the test suite" });
  assert.deepEqual(TOOLS.Bash.input({ ...ctx, command: "rm -rf /" }), { command: "rm -rf /", description: "Run the command" });
  assert.deepEqual(keys(TOOLS.Edit.input(ctx)), ["file_path", "old_string", "new_string", "replace_all"]);
  assert.deepEqual(keys(TOOLS.Write.input(ctx)), ["file_path", "content"]);
  assert.deepEqual(keys(TOOLS.Read.input(ctx)), ["file_path"]);
  assert.deepEqual(keys(TOOLS.WebFetch.input(ctx)), ["url", "prompt"]);
  assert.deepEqual(keys(TOOLS.WebSearch.input(ctx)), ["query"]);
  assert.deepEqual(keys(TOOLS.Agent.input(ctx)), ["description", "prompt", "subagent_type"]);
  assert.deepEqual(keys(TOOLS.Glob.input(ctx)), ["pattern"]);
  assert.deepEqual(keys(TOOLS.Grep.input(ctx)), ["pattern", "output_mode"]);
  // file paths are absolute, inside the project, with the platform's separators; the default file need not exist
  assert.ok(path.isAbsolute(TOOLS.Write.input(ctx).file_path));
  assert.equal(TOOLS.Write.input(ctx).file_path, path.join(ctx.project, "src", "hook-bench-sample.ts"));
  assert.equal(TOOLS.Read.input(ctx).file_path, path.join(ctx.project, "README.md"));
  const own = sessionContext({ ...ctx, readFile: undefined, file: "/work/app/lib/x.ts" });
  assert.equal(TOOLS.Edit.input(own).file_path, "/work/app/lib/x.ts");
  assert.equal(TOOLS.Read.input(own).file_path, "/work/app/lib/x.ts", "--file also points Read at the file");
  // MCP tools carry mcp_server, and an unknown mcp__ name gets a fixture of its own
  const mcp = fixtureFor("PreToolUse", "mcp__memory__create_entities", ctx).input;
  assert.deepEqual(mcp.mcp_server, { name: "memory", source: "user" });
  assert.deepEqual(keys(mcp), ["session_id", "transcript_path", "cwd", "prompt_id", "permission_mode", "effort", "hook_event_name", "tool_name", "tool_input", "mcp_server", "tool_use_id"]);
  const other = fixtureFor("PreToolUse", "mcp__github__search_repositories", ctx);
  assert.equal(other.input.tool_name, "mcp__github__search_repositories");
  assert.equal(other.input.mcp_server.name, "github");
  assert.equal(other.verified, "docs");
  const unknown = fixtureFor("PreToolUse", "Frobnicate", ctx);
  assert.deepEqual(unknown.input.tool_input, {});
  assert.equal(unknown.verified, "none");
  assert.match(unknown.note, /no realistic input/);
});

test("default values per event, and the candidate values", () => {
  assert.deepEqual(defaultValues("PreToolUse"), TOOL_NAMES);
  assert.deepEqual(defaultValues("SessionStart"), ["startup", "resume"]);
  assert.deepEqual(defaultValues("Notification"), ["permission_prompt", "idle_prompt"]);
  assert.deepEqual(defaultValues("Stop"), [null]);
  assert.deepEqual(candidateValues(eventByName("SessionStart")), ["startup", "resume", "clear", "compact", "fork"]);
  assert.deepEqual(candidateValues(eventByName("SubagentStart")), ["Explore"]);
  assert.deepEqual(candidateValues(eventByName("PostToolUse")), TOOL_NAMES);
});

test("the Notification fixture carries a message and a title for every documented type, and ConfigChange names the right file", () => {
  for (const v of eventByName("Notification").values) {
    const i = fixtureFor("Notification", v, ctx).input;
    assert.ok(i.message.length > 5 && i.title.length > 3, v);
    assert.deepEqual(keys(i), ["session_id", "transcript_path", "cwd", "hook_event_name", "message", "title", "notification_type"]);
  }
  assert.equal(fixtureFor("ConfigChange", "user_settings", ctx).input.file_path, path.join("/home/me", ".claude", "settings.json"));
  assert.equal(fixtureFor("ConfigChange", "local_settings", ctx).input.file_path, path.join(ctx.project, ".claude", "settings.local.json"));
  assert.equal(fixtureFor("PreCompact", "manual", ctx).input.custom_instructions, null);
  assert.equal(typeof fixtureFor("PostCompact", "auto", ctx).input.compact_summary, "string");
  assert.deepEqual(keys(fixtureFor("PreModelSwitch", "claude-opus-5", ctx).input), ["session_id", "transcript_path", "cwd", "prompt_id", "hook_event_name", "from_model", "to_model", "requested_model", "source", "context_tokens", "prompt_cache_warm", "cache_ttl", "estimated_cache_write_usd", "pricing"]);
  assert.equal(fixtureFor("Elicitation", "issue-tracker", ctx).input.mode, "form");
  assert.equal(fixtureFor("ElicitationResult", "issue-tracker", ctx).input.action, "accept");
  assert.equal(fixtureFor("WorktreeCreate", null, ctx).input.name, "feature-auth");
  assert.equal(fixtureFor("CwdChanged", null, ctx).input.new_cwd, path.join(ctx.project, "src"));
  assert.equal(fixtureFor("StopFailure", "rate_limit", ctx).input.error_details, "429 Too Many Requests");
});
