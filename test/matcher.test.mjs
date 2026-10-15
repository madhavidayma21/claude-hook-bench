// Matchers and the `if` field: which fixtures a hook fires for, and whether a rule lets a tool call through.
import test from "node:test";
import assert from "node:assert/strict";
import { eventByName } from "../src/events.mjs";
import { TOOL_NAMES } from "../src/fixtures.mjs";
import { globMatches, ifAllows, parseRule, patternMatches, shellParts, valuesFor } from "../src/matcher.mjs";

const call = (tool, input, cwd = "/work/app") => ({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, cwd });
const bash = (command) => call("Bash", { command });

test("parseRule: Tool, Tool(content), MCP names, and what is not a rule", () => {
  assert.deepEqual(parseRule("Bash"), { tool: "Bash", content: undefined });
  assert.deepEqual(parseRule("Bash(git *)"), { tool: "Bash", content: "git *" });
  assert.deepEqual(parseRule("Edit(*.ts)"), { tool: "Edit", content: "*.ts" });
  assert.deepEqual(parseRule("mcp__memory__create_entities"), { tool: "mcp__memory__create_entities", content: undefined });
  assert.deepEqual(parseRule("Bash(echo $(date))"), { tool: "Bash", content: "echo $(date)" });
  assert.equal(parseRule("git *"), null);
  assert.equal(parseRule(5), null);
  assert.equal(parseRule(""), null);
});

test("patternMatches: *, prefix:*, exact", () => {
  assert.equal(patternMatches("git *", "git push"), true);
  assert.equal(patternMatches("git *", "git"), false);
  assert.equal(patternMatches("git:*", "git"), true);
  assert.equal(patternMatches("git:*", "git push"), true);
  assert.equal(patternMatches("git:*", "gitk"), false);
  assert.equal(patternMatches("npm test", "npm test"), true);
  assert.equal(patternMatches("npm test", "npm tests"), false);
  assert.equal(patternMatches("*", "anything at all"), true);
  assert.equal(patternMatches("rm -rf *", "rm -rf /"), true);
  assert.equal(patternMatches("*.ts", "a.ts"), true);
});

test("shellParts: separators, substitutions and leading assignments", () => {
  assert.deepEqual(shellParts("npm test && git push"), ["npm test", "git push"]);
  assert.deepEqual(shellParts("FOO=bar git push"), ["git push"]);
  assert.deepEqual(shellParts("echo $(rm -rf /)"), ["rm -rf /", "echo"]);
  assert.deepEqual(shellParts("echo `date`"), ["date", "echo"]);
  assert.deepEqual(shellParts("a | b; c || d\ne"), ["a", "b", "c", "d", "e"]);
});

test("ifAllows: the reference's Bash table", () => {
  assert.equal(ifAllows("Bash(git *)", "PreToolUse", bash("FOO=bar git push")).runs, true, "leading assignments are stripped");
  assert.equal(ifAllows("Bash(git *)", "PreToolUse", bash("npm test && git push")).runs, true, "each subcommand is checked");
  assert.equal(ifAllows("Bash(rm *)", "PreToolUse", bash("echo $(rm -rf /)")).runs, true, "commands inside $() are checked");
  assert.equal(ifAllows("Bash(rm *)", "PreToolUse", bash("echo $(date)")).runs, false, "no subcommand matches");
  const more = ifAllows("Bash(git push *)", "PreToolUse", bash("echo $(date)"));
  assert.equal(more.runs, true, "a pattern that says more than the command name runs the hook on $()");
  assert.match(more.reason, /substitution or variable/);
  assert.equal(ifAllows("Bash(git *)", "PreToolUse", bash("npm test")).runs, false);
  assert.equal(ifAllows("Bash", "PreToolUse", bash("anything")).runs, true);
  assert.equal(ifAllows("Bash(git *)", "PreToolUse", call("Edit", { file_path: "/work/app/a.ts" })).runs, false, "another tool");
  assert.equal(ifAllows("PowerShell(Remove-Item *)", "PreToolUse", call("PowerShell", { command: "Remove-Item -Recurse x" })).runs, true);
});

test("ifAllows: file tools, WebFetch, other tools, and non-tool events", () => {
  assert.equal(ifAllows("Edit(*.ts)", "PreToolUse", call("Edit", { file_path: "/work/app/src/a.ts" })).runs, true);
  assert.equal(ifAllows("Edit(*.ts)", "PreToolUse", call("Edit", { file_path: "/work/app/src/a.js" })).runs, false);
  assert.equal(ifAllows("Edit(src/**)", "PreToolUse", call("Edit", { file_path: "/work/app/src/deep/a.ts" })).runs, true);
  assert.equal(ifAllows("Edit(src/**)", "PreToolUse", call("Edit", { file_path: "/work/app/lib/src/a.ts" })).runs, false, "a single-segment pattern is the working directory's src only");
  assert.equal(ifAllows("Edit(**/src/**)", "PreToolUse", call("Edit", { file_path: "/work/app/lib/src/a.ts" })).runs, true);
  assert.equal(ifAllows("Write(.env)", "PreToolUse", call("Write", { file_path: "C:\\work\\app\\.env" }, "C:\\work\\app")).runs, true, "backslash paths are normalized");
  assert.equal(ifAllows("WebFetch(domain:example.com)", "PreToolUse", call("WebFetch", { url: "https://docs.example.com/x" })).runs, true);
  assert.equal(ifAllows("WebFetch(domain:example.com)", "PreToolUse", call("WebFetch", { url: "https://evil.com/x" })).runs, false);
  assert.equal(ifAllows("Agent(Explore *)", "PreToolUse", call("Agent", { subagent_type: "Explore", prompt: "find" })).runs, true);
  const other = ifAllows("Bash(git *)", "Stop", { hook_event_name: "Stop" });
  assert.equal(other.runs, false);
  assert.match(other.reason, /only evaluated on tool events/);
  assert.match(ifAllows("git *", "PreToolUse", bash("git push")).reason, /not a permission rule/);
  assert.equal(ifAllows(undefined, "Stop", {}).runs, true);
});

test("globMatches", () => {
  assert.equal(globMatches("*.ts", "a.ts"), true);
  assert.equal(globMatches("*.ts", "src/a.ts"), true, "no slash in the pattern: the base name counts");
  assert.equal(globMatches("src/*.ts", "src/a.ts"), true);
  assert.equal(globMatches("src/*.ts", "src/x/a.ts"), false);
  assert.equal(globMatches("src/**", "src/x/a.ts"), true);
  assert.equal(globMatches("**/src/**", "lib/src/a.ts"), true);
  assert.equal(globMatches("a?c", "abc"), true);
  assert.equal(globMatches("a.c", "abc"), false, "a dot is literal");
});

test("valuesFor: catch-all, exact lists, regexes, unknown values, and events without a matcher", () => {
  const h = (matcher) => ({ matcher });
  assert.deepEqual(valuesFor(h(undefined), "PreToolUse").values, TOOL_NAMES);
  assert.deepEqual(valuesFor(h("*"), "PostToolUse").values, TOOL_NAMES);
  assert.deepEqual(valuesFor(h("Bash"), "PreToolUse").values, ["Bash"]);
  assert.deepEqual(valuesFor(h("Edit|Write"), "PreToolUse").values, ["Edit", "Write"]);
  assert.deepEqual(valuesFor(h("Edit, Write"), "PreToolUse").values, ["Edit", "Write"]);
  assert.deepEqual(valuesFor(h("^Notebook"), "PreToolUse").values, []);
  assert.match(valuesFor(h("^Notebook"), "PreToolUse").note, /no known tool_name value matches/);
  assert.deepEqual(valuesFor(h("mcp__.*"), "PreToolUse").values, ["mcp__memory__create_entities"]);
  assert.deepEqual(valuesFor(h("Edit.*"), "PreToolUse").values, ["Edit"]);
  assert.deepEqual(valuesFor(h("mcp__github__search_repositories"), "PreToolUse").values, ["mcp__github__search_repositories"], "an unknown exact tool gets a fixture of its own");
  assert.deepEqual(valuesFor(h(undefined), "SessionStart").values, ["startup", "resume"]);
  assert.deepEqual(valuesFor(h("startup|clear"), "SessionStart").values, ["startup", "clear"]);
  const bad = valuesFor(h("start"), "SessionStart");
  assert.deepEqual(bad.values, []);
  assert.match(bad.note, /"start" is not a documented source value/);
  assert.deepEqual(valuesFor(h("resume|start"), "SessionStart").values, ["resume"]);
  assert.deepEqual(valuesFor(h(".*"), "Notification").values, eventByName("Notification").values);
  assert.deepEqual(valuesFor(h("quota.*"), "Notification").values, ["quota_auto_resume_fired", "quota_auto_resume_stale", "quota_auto_resume_disabled"]);
  assert.deepEqual(valuesFor(h("my-reviewer"), "SubagentStart").values, ["my-reviewer"], "open sets take the matcher's value");
  assert.deepEqual(valuesFor(h(undefined), "Stop").values, [null]);
  assert.match(valuesFor(h("Bash"), "Stop").note, /no matcher support/);
  assert.match(valuesFor(h("(unclosed"), "PreToolUse").error, /regular expression/);
  assert.match(valuesFor(h(5), "PreToolUse").error, /not a string/);
  assert.deepEqual(valuesFor(h(".envrc|.env"), "FileChanged").values, [".envrc", ".env"], "FileChanged: the matcher is the watch list, one literal file name per segment");
  assert.deepEqual(valuesFor(h("data.csv"), "FileChanged").values, ["data.csv"]);
});
