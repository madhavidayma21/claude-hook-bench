// The event table: complete against the reference's list, consistent with itself, and its matcher rules.
import test from "node:test";
import assert from "node:assert/strict";
import { EVENTS, EVENT_NAMES, TOOL_EVENTS, UNIVERSAL, blocksOnExit2, defaultTimeout, eventByName, matcherKind, matcherList, matcherMatches } from "../src/events.mjs";

// the "When it fires" table of the hooks reference, read 2026-10-15
const DOCS = ["SessionStart", "Setup", "UserPromptSubmit", "UserPromptExpansion", "PreToolUse", "PermissionRequest", "PermissionDenied", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "Notification", "MessageDisplay", "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "Stop", "StopFailure", "TeammateIdle", "InstructionsLoaded", "ConfigChange", "CwdChanged", "DirectoryAdded", "FileChanged", "WorktreeCreate", "WorktreeRemove", "PreCompact", "PostCompact", "PreModelSwitch", "PostModelSwitch", "Elicitation", "ElicitationResult", "SessionEnd"];

test("every event of the reference is in the table, once, and nothing else", () => {
  assert.deepEqual([...EVENT_NAMES].sort(), [...DOCS].sort());
  assert.equal(new Set(EVENT_NAMES).size, EVENT_NAMES.length);
  assert.equal(EVENTS.length, 33);
});

test("every entry has the fields the reports rely on, with sensible values", () => {
  const types = new Set(["command", "http", "mcp_tool", "prompt", "agent"]);
  for (const e of EVENTS) {
    assert.ok(e.when && /^[a-z]/.test(e.when), `${e.name}: when`);
    assert.ok(e.matcher === null || typeof e.matcher === "string", `${e.name}: matcher`);
    assert.ok(e.values === null || e.values === "open" || (Array.isArray(e.values) && e.values.length), `${e.name}: values`);
    assert.ok(e.matcher ? e.values !== null : e.values === null, `${e.name}: values only with a matcher`);
    assert.ok(e.types.length && e.types.every((t) => types.has(t)), `${e.name}: types`);
    assert.ok(typeof e.timeout === "number" && e.timeout > 0, `${e.name}: timeout`);
    assert.ok(e.exit2 === true || (typeof e.exit2 === "string" && e.exit2.length > 10), `${e.name}: exit2`);
    assert.ok(["context", "log", "path"].includes(e.plainStdout), `${e.name}: plainStdout`);
    assert.ok(e.fields && typeof e.fields === "object", `${e.name}: fields`);
    for (const [k, t] of Object.entries(e.fields)) assert.match(t, /^(string|boolean|number|object|array|any|string\[\]|enum:[a-z|]+)$/, `${e.name}.${k}: ${t}`);
    assert.ok(["recorded", "docs"].includes(e.verified), `${e.name}: verified`);
    assert.ok(e.decision === null || typeof e.decision === "string", `${e.name}: decision`);
  }
});

test("the per-event facts the reference states", () => {
  const e = eventByName;
  assert.equal(e("SessionStart").plainStdout, "context");
  assert.equal(e("UserPromptSubmit").plainStdout, "context");
  assert.equal(e("UserPromptExpansion").plainStdout, "context");
  assert.equal(e("PostModelSwitch").plainStdout, "context");
  assert.equal(e("PreToolUse").plainStdout, "log");
  assert.equal(e("WorktreeCreate").plainStdout, "path");
  assert.deepEqual(e("SessionStart").types, ["command", "mcp_tool"]);
  assert.deepEqual(e("Setup").types, ["command", "mcp_tool"]);
  assert.ok(!e("PermissionRequest").types.includes("agent") && e("PermissionRequest").types.includes("prompt"));
  for (const n of ["ConfigChange", "CwdChanged", "DirectoryAdded", "Elicitation", "ElicitationResult", "FileChanged", "InstructionsLoaded", "MessageDisplay", "Notification", "PostCompact", "PostModelSwitch", "PreCompact", "PreModelSwitch", "SessionEnd", "StopFailure", "SubagentStart", "WorktreeCreate", "WorktreeRemove"]) assert.deepEqual(e(n).types, ["command", "http", "mcp_tool"], n);
  for (const n of ["PermissionDenied", "PostToolBatch", "PostToolUse", "PostToolUseFailure", "PreToolUse", "Stop", "SubagentStop", "TaskCompleted", "TaskCreated", "TeammateIdle", "UserPromptExpansion", "UserPromptSubmit"]) assert.equal(e(n).types.length, 5, n);
  assert.equal(e("UserPromptSubmit").timeout, 30);
  assert.equal(e("PreModelSwitch").timeout, 30);
  assert.equal(e("PostModelSwitch").timeout, 30);
  assert.equal(e("MessageDisplay").timeout, 10);
  assert.equal(e("SessionEnd").timeout, 1.5);
  assert.equal(e("PreToolUse").timeout, 600);
  assert.equal(defaultTimeout(e("PreToolUse"), "prompt"), 30);
  assert.equal(defaultTimeout(e("PreToolUse"), "agent"), 60);
  assert.equal(defaultTimeout(e("UserPromptSubmit"), "command"), 30);
  assert.equal(defaultTimeout(null, "command"), 600);
  // the exit code 2 table
  const blocking = ["PreToolUse", "UserPromptSubmit", "UserPromptExpansion", "Stop", "SubagentStop", "TeammateIdle", "TaskCreated", "TaskCompleted", "ConfigChange", "PostToolBatch", "PreCompact", "PreModelSwitch", "Elicitation", "ElicitationResult"];
  for (const ev of EVENTS) assert.equal(blocksOnExit2(ev), blocking.includes(ev.name), ev.name);
  assert.match(e("PermissionRequest").exit2, /not honored/i);
  assert.match(e("PostToolUse").exit2, /stderr to Claude/);
  assert.match(e("Notification").exit2, /ignored/);
  assert.match(e("WorktreeCreate").exit2, /non-zero/);
});

test("the matcher field of each event, and the events without one", () => {
  const none = ["UserPromptSubmit", "PostToolBatch", "Stop", "TeammateIdle", "TaskCreated", "TaskCompleted", "WorktreeCreate", "WorktreeRemove", "MessageDisplay", "CwdChanged"];
  for (const ev of EVENTS) assert.equal(ev.matcher === null, none.includes(ev.name), ev.name);
  for (const n of TOOL_EVENTS) assert.equal(eventByName(n).matcher, "tool_name", n);
  assert.deepEqual(eventByName("SessionStart").values, ["startup", "resume", "clear", "compact", "fork"]);
  assert.deepEqual(eventByName("SessionEnd").values, ["clear", "resume", "logout", "prompt_input_exit", "other"]);
  assert.equal(eventByName("Notification").values.length, 12);
  assert.equal(eventByName("StopFailure").values.length, 12);
  assert.ok(eventByName("FileChanged").narrow && eventByName("StopFailure").narrow);
});

test("matcher kinds: all, exact (with | or , lists), regex, and the narrow set for FileChanged and StopFailure", () => {
  const pre = eventByName("PreToolUse");
  for (const m of [undefined, null, "", "*"]) assert.equal(matcherKind(m, pre), "all");
  assert.equal(matcherKind("Bash", pre), "exact");
  assert.equal(matcherKind("Edit|Write", pre), "exact");
  assert.equal(matcherKind("Edit, Write", pre), "exact");
  assert.equal(matcherKind("code-reviewer", pre), "exact");
  assert.equal(matcherKind("^Notebook", pre), "regex");
  assert.equal(matcherKind("mcp__memory__.*", pre), "regex");
  assert.equal(matcherKind("mcp__memory", pre), "exact", "only exact-match characters: compared as a string, matches no tool");
  assert.equal(matcherKind(5, pre), "invalid");
  const fc = eventByName("FileChanged");
  assert.equal(matcherKind(".envrc|.env", fc), "regex", "a dot is outside the narrow set");
  assert.equal(matcherKind("env_file|other", fc), "exact");
  assert.equal(matcherKind("a b", fc), "regex", "a space keeps the narrow events on the regex path");
  assert.deepEqual(matcherList("Edit, Write |Read", pre), ["Edit", "Write", "Read"]);
  assert.deepEqual(matcherList("a,b|c", eventByName("StopFailure")), ["a,b", "c"], "only | separates in the narrow set");
});

test("matcherMatches follows the reference's examples", () => {
  const pre = eventByName("PreToolUse");
  assert.equal(matcherMatches("Bash", "Bash", pre).match, true);
  assert.equal(matcherMatches("Bash", "bash", pre).match, false, "case-sensitive");
  assert.equal(matcherMatches("Edit|Write", "Write", pre).match, true);
  assert.equal(matcherMatches("Edit, Write", "Edit", pre).match, true);
  assert.equal(matcherMatches("Edit|Write", "NotebookEdit", pre).match, false);
  assert.equal(matcherMatches("Edit.*", "NotebookEdit", pre).match, true, "unanchored regex");
  assert.equal(matcherMatches("^Edit$", "NotebookEdit", pre).match, false);
  assert.equal(matcherMatches("mcp__memory__.*", "mcp__memory__create_entities", pre).match, true);
  assert.equal(matcherMatches("mcp__memory", "mcp__memory__create_entities", pre).match, false);
  assert.equal(matcherMatches("mcp__.*__write.*", "mcp__db__write_rows", pre).match, true);
  assert.equal(matcherMatches("*", "anything", pre).match, true);
  assert.equal(matcherMatches("", "anything", pre).match, true);
  assert.equal(matcherMatches(undefined, "anything", pre).match, true);
  assert.match(matcherMatches("(unclosed", "x", pre).error, /regular expression/);
  assert.equal(matcherMatches("^my-plugin:reviewer$", "my-plugin:reviewer", eventByName("SubagentStart")).match, true);
});

test("the universal output fields and their types, as Claude Code's own schema summary prints them", () => {
  assert.deepEqual(UNIVERSAL, { continue: "boolean", suppressOutput: "boolean", stopReason: "string", decision: "enum:approve|block", reason: "string", systemMessage: "string", terminalSequence: "string", hookSpecificOutput: "object" });
});

test("event-specific output fields match the reference's decision-control tables", () => {
  const f = (n) => eventByName(n).fields;
  assert.deepEqual(f("PreToolUse"), { permissionDecision: "enum:allow|deny|ask|defer", permissionDecisionReason: "string", updatedInput: "object", additionalContext: "string" });
  assert.deepEqual(f("PreModelSwitch"), { permissionDecision: "enum:allow|deny|ask", permissionDecisionReason: "string" });
  assert.deepEqual(Object.keys(f("PermissionRequest")), ["decision"]);
  assert.deepEqual(eventByName("PermissionRequest").decisionObject, { behavior: "enum:allow|deny", updatedInput: "object", updatedPermissions: "array", message: "string", interrupt: "boolean" });
  assert.deepEqual(f("PostToolUse"), { additionalContext: "string", classifierContext: "string", updatedToolOutput: "any", updatedMCPToolOutput: "any" });
  assert.deepEqual(f("UserPromptSubmit"), { additionalContext: "string", sessionTitle: "string", suppressOriginalPrompt: "boolean" });
  assert.deepEqual(f("SessionStart"), { additionalContext: "string", initialUserMessage: "string", sessionTitle: "string", watchPaths: "string[]", reloadSkills: "boolean" });
  assert.deepEqual(f("PermissionDenied"), { retry: "boolean" });
  assert.deepEqual(f("MessageDisplay"), { displayContent: "string" });
  assert.deepEqual(f("Elicitation"), { action: "enum:accept|decline|cancel", content: "object" });
  assert.deepEqual(f("CwdChanged"), { watchPaths: "string[]" });
  for (const n of ["Setup", "InstructionsLoaded", "Notification", "SessionEnd", "PostCompact", "StopFailure", "WorktreeRemove", "TaskCreated", "TaskCompleted", "TeammateIdle", "ConfigChange", "PreCompact", "DirectoryAdded"]) assert.deepEqual(f(n), {}, n);
  // decision: "block" works on the events the table lists, and nowhere else
  const block = ["UserPromptSubmit", "UserPromptExpansion", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "Stop", "SubagentStop", "ConfigChange", "PreCompact", "TaskCreated", "PreModelSwitch", "Elicitation", "ElicitationResult", "PreToolUse"];
  for (const ev of EVENTS) assert.equal(ev.decision !== null, block.includes(ev.name), `${ev.name} decision`);
  // events that discard systemMessage and continue
  for (const n of ["Notification", "Setup", "SessionEnd", "PostCompact", "InstructionsLoaded", "StopFailure", "WorktreeCreate", "WorktreeRemove", "Elicitation", "ElicitationResult", "MessageDisplay", "PreCompact", "ConfigChange", "PermissionDenied"]) {
    assert.equal(eventByName(n).systemMessage, null, `${n} systemMessage`);
    assert.equal(eventByName(n).continue, null, `${n} continue`);
  }
  assert.equal(eventByName("TaskCreated").continue, null, "TaskCreated ignores continue: false");
  assert.ok(eventByName("CwdChanged").systemMessage && eventByName("CwdChanged").continue === null);
});
