// Checks against the real Claude Code binary, run only when E2E_CLAUDE points at one (see claude-sandbox.mjs):
//   1. the plugin validates;
//   2. the fixtures: a recording hook on every event a -p run can fire gets the binary's JSON, and for each
//      recorded event the keys and their types are exactly what the bench's fixture has (the fixture oracle);
//   3. the output rules: a PreToolUse hook prints each of a table of outputs, and whether the binary then ran
//      or refused the tool call agrees with judge()'s verdict (the output oracle);
//   4. the bench itself, pointed at that config, reports the same verdicts.
// Everything runs against a fake API on 127.0.0.1: no token is spent and nothing leaves the machine.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, parse, runCli, write } from "./helpers.mjs";
import { CLAUDE, RECORD, fakeApi, readLog, recordingHooks, runClaude, sandbox, skip } from "./claude-sandbox.mjs";
import { eventByName } from "../src/events.mjs";
import { fixtureFor, sessionContext } from "../src/fixtures.mjs";
import { judge } from "../src/output.mjs";

const J = (o) => JSON.stringify(o);
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const shape = (o) => Object.keys(o).map((k) => `${k}:${typeOf(o[k])}`);

test("claude plugin validate accepts the plugin, also with --strict", { skip: skip(), timeout: 120000 }, () => {
  const sb = sandbox("validate");
  for (const args of [["plugin", "validate", ROOT], ["plugin", "validate", ROOT, "--strict"]]) {
    const r = spawnSync(CLAUDE, args, { encoding: "utf8", timeout: 100000, env: { ...process.env, CLAUDE_CONFIG_DIR: sb.cfg, HOME: sb.home, USERPROFILE: sb.home }, windowsHide: true, shell: process.platform === "win32" && !/\.exe$/i.test(CLAUDE) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Validation passed/);
  }
});

// The events a -p run with one tool call fires, and the matcher value each run carries.
const RECORDABLE = ["SessionStart", "InstructionsLoaded", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolBatch", "MessageDisplay", "Stop", "SessionEnd"];

test("the fixture oracle: for every event a -p run fires, the bench's JSON has the keys and types the binary sends", { skip: skip(), timeout: 180000 }, async () => {
  const sb = sandbox("fixtures");
  write(sb.settings, { permissions: { allow: ["Bash(echo *)"] }, hooks: recordingHooks(RECORDABLE) });
  write(path.join(sb.work, "CLAUDE.md"), "# Probe\n");
  const api = await fakeApi({ tool: "Bash", input: { command: "echo hook-bench-probe", description: "Probe echo" } });
  try {
    const r = await runClaude(sb, api, ["-p", "PROBE-MAIN start", "--output-format", "json", "--permission-mode", "default", "--max-turns", "3"]);
    assert.equal(r.code, 0, r.err);
    const log = readLog(sb);
    const seen = new Set(log.map((l) => l.label));
    for (const ev of RECORDABLE) assert.ok(seen.has(ev), `${ev} fired (saw: ${[...seen].join(", ")})`);
    const ctx = sessionContext({ project: sb.work, sessionId: "x", promptId: "y", transcriptPath: "t", agentTranscriptPath: "a", home: sb.home });
    for (const rec of log) {
      const e = eventByName(rec.label);
      const value = e.matcher === "tool_name" ? rec.input.tool_name : e.matcher ? rec.input[e.matcher] : null;
      const fx = fixtureFor(rec.label, value, ctx);
      assert.ok(fx, `${rec.label}:${value} has a fixture`);
      const got = shape(rec.input);
      const ours = shape(fx.input);
      const extra = ours.filter((k) => !got.includes(k));
      const missing = got.filter((k) => !ours.includes(k));
      // the binary may add fields (a newer version); the bench may not invent one or get a type wrong
      assert.deepEqual(extra, [], `${rec.label}:${value}: the fixture has keys or types the binary did not send. Binary: ${got.join(" ")}`);
      if (missing.length) console.log(`note: ${rec.label}:${value}: the binary sent ${missing.join(", ")}, which the fixture lacks (a newer Claude Code?)`);
      if (rec.label === "PostToolUse" || rec.label === "PreToolUse") assert.deepEqual(shape(fx.input.tool_input), shape(rec.input.tool_input), `${rec.label} tool_input`);
      if (rec.label === "PostToolUse") assert.deepEqual(shape(fx.input.tool_response), shape(rec.input.tool_response), "PostToolUse tool_response for Bash");
      assert.deepEqual(Object.keys(rec.input), Object.keys(fx.input).filter((k) => got.some((g) => g.startsWith(`${k}:`))), `${rec.label}: key order`);
    }
    // the environment a hook gets
    const pre = log.find((l) => l.label === "PreToolUse");
    for (const k of ["CLAUDE_PROJECT_DIR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_EFFORT", "CLAUDECODE"]) assert.ok(k in pre.env, k);
    assert.ok("CLAUDE_ENV_FILE" in log.find((l) => l.label === "SessionStart").env, "SessionStart gets CLAUDE_ENV_FILE");
    assert.ok(!("CLAUDE_ENV_FILE" in pre.env), "PreToolUse does not");
  } finally { await api.close(); }
});

const DENY = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "probe deny" } };
// [id, stdout, exit code, stderr, hook fields, needs an allow rule?, expected: did the tool run?]
const OUTPUT_CASES = [
  ["deny-json", J(DENY), 0, "", {}, true, false],
  ["deny+systemMessage-number", J({ ...DENY, systemMessage: 5 }), 0, "", {}, true, true],
  ["deny+unknown-field", J({ ...DENY, foo: 1 }), 0, "", {}, true, false],
  ["deny-uppercase", J({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "DENY" } }), 0, "", {}, true, true],
  ["deny-no-eventname", J({ hookSpecificOutput: { permissionDecision: "deny" } }), 0, "", {}, true, true],
  ["deprecated-block", J({ decision: "block", reason: "probe block" }), 0, "", {}, true, false],
  ["plain-text", "deny", 0, "", {}, true, true],
  ["exit2-stderr", "", 2, "probe exit 2", {}, true, false],
  ["exit1-stderr", "", 1, "boom", {}, true, true],
  ["exit1+deny-json", J(DENY), 1, "", {}, true, false],
  ["two-json-lines", `{"a":1}\n${J(DENY)}`, 0, "", {}, true, true],
  ["allow-no-rule", J({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } }), 0, "", {}, false, true],
  ["deny-pretty-multiline", JSON.stringify(DENY, null, 2), 0, "", {}, true, false],
  ["deny+trailing-text", `${J(DENY)}\ndone`, 0, "", {}, true, true],
  ["deny-trailing-comma", '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",}}', 0, "", {}, true, true],
  ["exit1-onFailure-block", "", 1, "boom", { onFailure: "block" }, true, false],
  ["permissionDecision-top-level", J({ permissionDecision: "deny" }), 0, "", {}, true, true],
];

test("the output oracle: what the binary does with each output agrees with judge()", { skip: skip(), timeout: 600000 }, async () => {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < OUTPUT_CASES.length) {
      const c = OUTPUT_CASES[next++];
      const [id, stdout, code, stderr, fields, rule, expectRan] = c;
      const sb = sandbox("out");
      const wrapper = path.join(sb.root, "wrap.mjs");
      write(wrapper, `import { spawnSync } from "node:child_process";\nimport fs from "node:fs";\nconst input = fs.readFileSync(0, "utf8");\nconst r = spawnSync(process.execPath, [${J(RECORD)}, "case"], { input, encoding: "utf8", env: { ...process.env, HB_STDOUT: ${J(stdout)}, HB_STDERR: ${J(stderr)}, HB_EXIT: ${J(String(code))} } });\nprocess.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.status);\n`);
      write(sb.settings, {
        permissions: rule ? { allow: ["Bash(node *)"] } : {},
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: process.execPath, args: [wrapper], ...fields }] }], PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: process.execPath, args: [RECORD, "PostToolUse"] }] }] },
      });
      const api = await fakeApi({ tool: "Bash", input: { command: "node -e 0", description: "Probe" } });
      const r = await runClaude(sb, api, ["-p", "PROBE-MAIN start", "--output-format", "json", "--permission-mode", "default", "--max-turns", "3"]);
      await api.close();
      const log = readLog(sb);
      const ran = log.some((l) => l.label === "PostToolUse");
      const hookRan = log.some((l) => l.label === "case");
      const verdict = judge("PreToolUse", { type: "command", async: false, onFailure: fields.onFailure || "continue" }, { status: "ran", exitCode: code, stdout, stderr, ms: 1, timeoutMs: 600000 });
      const benchSaysBlocked = verdict.outcome === "block";
      results.push({ id, ran, hookRan, expectRan, benchSaysBlocked, verdict: verdict.verdict, code: r.code, err: r.err.slice(0, 200) });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  for (const r of results) {
    assert.equal(r.hookRan, true, `${r.id}: the hook ran (claude exit ${r.code}: ${r.err})`);
    assert.equal(r.ran, r.expectRan, `${r.id}: the binary ${r.ran ? "ran" : "refused"} the tool; the table expected ${r.expectRan ? "ran" : "refused"}`);
    assert.equal(!r.benchSaysBlocked, r.ran, `${r.id}: the bench says "${r.verdict}", the binary ${r.ran ? "ran" : "refused"} the tool`);
  }
});

test("the bench, pointed at a real config, reports the denial the binary enforces", { skip: skip(), timeout: 180000 }, async () => {
  const sb = sandbox("bench");
  const script = path.join(sb.root, "guard.cjs");
  write(script, "const i = JSON.parse(require('fs').readFileSync(0, 'utf8')); if (/rm -rf/.test(i.tool_input.command)) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no rm -rf' } }));");
  write(sb.settings, { permissions: { allow: ["Bash(node *)"] }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: process.execPath, args: [script] }] }], PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: process.execPath, args: [RECORD, "PostToolUse"] }] }] } });
  // the binary: a harmless command runs, rm -rf is refused by the hook
  const api = await fakeApi({ tool: "Bash", input: { command: "node -e 0", description: "Probe" } });
  const ok = await runClaude(sb, api, ["-p", "PROBE-MAIN start", "--output-format", "json", "--permission-mode", "default", "--max-turns", "3"]);
  await api.close();
  assert.ok(readLog(sb).some((l) => l.label === "PostToolUse"), `node -e 0 ran (${ok.err})`);
  fs.rmSync(sb.log, { force: true });
  const api2 = await fakeApi({ tool: "Bash", input: { command: "rm -rf /tmp/build", description: "Probe" } });
  const refused = await runClaude(sb, api2, ["-p", "PROBE-MAIN start", "--output-format", "json", "--permission-mode", "default", "--max-turns", "3"]);
  await api2.close();
  assert.ok(!readLog(sb).some((l) => l.label === "PostToolUse"), "rm -rf was refused");
  assert.ok((refused.result && refused.result.permission_denials || []).some((d) => d.tool_use_id === "toolu_probe"), refused.out.slice(0, 300));
  // the bench on the same config
  const env = { HOME: sb.home, USERPROFILE: sb.home, CLAUDE_CONFIG_DIR: sb.cfg, CLAUDE_HOOK_BENCH_MANAGED_DIR: path.join(sb.root, "managed") };
  const silent = parse(runCli(["run", "--json", "--event", "PreToolUse:Bash", "--command", "node -e 0"], { cwd: sb.work, env }).out);
  assert.equal(silent.runs[0].verdict.outcome, "silent", JSON.stringify(silent.runs[0].verdict));
  const deny = parse(runCli(["run", "--json", "--event", "PreToolUse:Bash", "--command", "rm -rf /tmp/build"], { cwd: sb.work, env }).out);
  assert.equal(deny.runs[0].verdict.outcome, "block", JSON.stringify(deny.runs[0].verdict));
  assert.match(deny.runs[0].verdict.effects[0], /no rm -rf/);
});

test("installed from a marketplace, the plugin's own cost projection is small and the skill is user-only", { skip: skip(), timeout: 240000 }, () => {
  const sb = sandbox("details");
  const mkt = path.join(sb.root, "mkt");
  const dest = path.join(mkt, "plugins", "hook-bench");
  fs.mkdirSync(path.join(mkt, ".claude-plugin"), { recursive: true });
  for (const item of ["bin", "src", "skills", ".claude-plugin", "package.json"]) fs.cpSync(path.join(ROOT, item), path.join(dest, item), { recursive: true });
  fs.writeFileSync(path.join(mkt, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "local-test", owner: { name: "test" }, plugins: [{ name: "hook-bench", description: "x", source: "./plugins/hook-bench" }] }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: sb.cfg, HOME: sb.home, USERPROFILE: sb.home, DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1" };
  for (const k of Object.keys(env)) if (/^(CLAUDE_CODE_|ANTHROPIC_)/.test(k)) delete env[k];
  const claude = (...args) => spawnSync(CLAUDE, args, { encoding: "utf8", timeout: 100000, env, windowsHide: true, shell: process.platform === "win32" && !/\.exe$/i.test(CLAUDE) });
  const added = claude("plugin", "marketplace", "add", mkt);
  assert.equal(added.status, 0, added.stdout + added.stderr);
  const installed = claude("plugin", "install", "hook-bench@local-test");
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const details = claude("plugin", "details", "hook-bench");
  assert.equal(details.status, 0, details.stdout + details.stderr);
  assert.match(details.stdout, /Skills \(1\)\s+check/);
  const always = /Always-on:\s+~(\d+) tok/.exec(details.stdout);
  assert.ok(always && Number(always[1]) < 30, `always-on is ${always && always[1]} tokens`);
  // the bench finds the installed plugin's (absent) hooks without complaint, and lists it
  const list = parse(runCli(["list", "--json"], { cwd: sb.work, env: { HOME: sb.home, USERPROFILE: sb.home, CLAUDE_CONFIG_DIR: sb.cfg, CLAUDE_HOOK_BENCH_MANAGED_DIR: path.join(sb.root, "managed") } }).out);
  assert.deepEqual(list.plugins.map((p) => [p.id, p.enabled, p.hooks]), [["hook-bench@local-test", true, 0]]);
});
