// Running a hook the way Claude Code does: exec form, shell form, the placeholders and variables, stdin,
// timeouts, and hooks that cannot start.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { IS_WIN, NODE, echoHook, nodeHook, sandbox, parse } from "./helpers.mjs";
import { findGitBash, plan, resolveExecutable, runHook, substitute } from "../src/runner.mjs";

const session = { sessionId: "33333333-3333-4333-8333-333333333333", effort: "high", envFile: null };
const vars = (project, extra = {}) => ({ CLAUDE_PROJECT_DIR: project, ...extra });
const input = { hook_event_name: "Stop", session_id: "x", stop_hook_active: false };

test("substitute: the three placeholders, and the PowerShell rewrite", () => {
  assert.equal(substitute("${CLAUDE_PROJECT_DIR}/a ${CLAUDE_PLUGIN_ROOT}/b ${CLAUDE_PLUGIN_DATA}/c ${OTHER}", { CLAUDE_PROJECT_DIR: "/p", CLAUDE_PLUGIN_ROOT: "/r", CLAUDE_PLUGIN_DATA: "/d" }), "/p/a /r/b /d/c ${OTHER}");
  assert.equal(substitute("${CLAUDE_PLUGIN_ROOT}/b", { CLAUDE_PROJECT_DIR: "/p" }), "${CLAUDE_PLUGIN_ROOT}/b", "a placeholder without a value stays as written");
  assert.equal(substitute("${CLAUDE_PROJECT_DIR}\\x.ps1", { CLAUDE_PROJECT_DIR: "C:\\p" }, { powershell: true }), "${env:CLAUDE_PROJECT_DIR}\\x.ps1");
});

test("resolveExecutable: on PATH, as a path, and not at all", () => {
  assert.equal(resolveExecutable(NODE), NODE);
  assert.ok(resolveExecutable("node"), "node is on PATH");
  assert.equal(resolveExecutable("no-such-program-hb"), null);
  assert.equal(resolveExecutable("./nope/x", { cwd: process.cwd() }), null);
  if (IS_WIN) assert.ok(/node\.exe$/i.test(resolveExecutable("node")), "the .exe is found through PATHEXT");
});

test("plan: exec form spawns the command directly; shell form picks sh, Git Bash or PowerShell", () => {
  const p = plan({ type: "command", command: NODE, args: ["${CLAUDE_PROJECT_DIR}/x.mjs", "--fix"] }, vars("/proj"));
  assert.equal(p.form, "exec");
  assert.deepEqual(p.argv, ["/proj/x.mjs", "--fix"]);
  assert.equal(p.resolved, NODE);
  const s = plan({ type: "command", command: 'echo "${CLAUDE_PROJECT_DIR}"' }, vars("C:\\proj"));
  assert.equal(s.form, "shell");
  if (!IS_WIN) { assert.equal(s.shell, "sh"); assert.deepEqual(s.argv, ["-c", 'echo "C:\\proj"']); }
  else if (findGitBash()) { assert.equal(s.shell, "bash"); assert.deepEqual(s.argv, ["-c", 'echo "C:/proj"'], "Git Bash gets forward slashes"); }
  else assert.equal(s.shell, "powershell");
  const ps = plan({ type: "command", command: 'Write-Host "${CLAUDE_PROJECT_DIR}"', shell: "powershell" }, vars("C:\\proj"));
  assert.equal(ps.shell, "powershell");
  if (ps.file) assert.deepEqual(ps.argv.slice(-1), ['Write-Host "${env:CLAUDE_PROJECT_DIR}"']);
});

test("runHook, exec form: stdin JSON, exit code, stdout, stderr, the environment Claude Code sets, cwd", async () => {
  const s = sandbox();
  const r = await runHook(echoHook(), { input, vars: vars(s.proj, { CLAUDE_PLUGIN_ROOT: "/plug", CLAUDE_PLUGIN_DATA: "/data" }), session, cwd: s.proj, env: { ...process.env, CLAUDE_ENV_FILE: "stale" } });
  assert.equal(r.status, "ran");
  assert.equal(r.exitCode, 0);
  assert.equal(r.plan.form, "exec");
  const got = parse(r.stdout);
  assert.deepEqual(got.got, input, "the JSON arrived on stdin");
  assert.equal(got.env.CLAUDE_PROJECT_DIR, s.proj);
  assert.equal(got.env.CLAUDE_PLUGIN_ROOT, "/plug");
  assert.equal(got.env.CLAUDE_PLUGIN_DATA, "/data");
  assert.equal(got.env.CLAUDE_CODE_SESSION_ID, session.sessionId);
  assert.equal(got.env.CLAUDE_EFFORT, "high");
  assert.equal(got.env.CLAUDECODE, "1");
  assert.equal(got.env.CLAUDE_HOOK_BENCH, "1");
  assert.equal(got.env.CLAUDE_ENV_FILE, undefined, "no env file unless the event has one; the machine's own value is not passed on");
  assert.equal(path.resolve(got.cwd), path.resolve(s.proj));
  assert.ok(typeof r.ms === "number" && r.ms >= 0);
  const fail = await runHook(nodeHook("process.stderr.write('bad'); process.exit(3)"), { input, vars: vars(s.proj), session, cwd: s.proj });
  assert.deepEqual([fail.status, fail.exitCode, fail.stderr], ["ran", 3, "bad"]);
});

test("runHook: CLAUDE_ENV_FILE is passed when given, and what the hook writes there can be read back", async () => {
  const s = sandbox();
  const envFile = path.join(s.base, "env.sh");
  fs.writeFileSync(envFile, "");
  const r = await runHook(nodeHook("require('fs').appendFileSync(process.env.CLAUDE_ENV_FILE, 'export A=1\\n')"), { input, vars: vars(s.proj), session: { ...session, envFile }, cwd: s.proj });
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(fs.readFileSync(envFile, "utf8"), "export A=1\n");
});

test("runHook, shell form: the command runs through a shell with the placeholder filled in", async () => {
  const s = sandbox();
  const r = await runHook({ type: "command", command: `"${NODE.replace(/\\/g, "/")}" -e "process.stdout.write(process.env.CLAUDE_PROJECT_DIR)"` }, { input, vars: vars(s.proj), session, cwd: s.proj });
  assert.equal(r.status, "ran", r.error);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(r.plan.form, "shell");
  assert.equal(path.resolve(r.stdout.trim().replace(/\//g, path.sep)), path.resolve(s.proj));
  const missing = await runHook({ type: "command", command: `${s.proj.replace(/\\/g, "/")}/no-such-hook.sh` }, { input, vars: vars(s.proj), session, cwd: s.proj });
  assert.equal(missing.status, "ran");
  assert.notEqual(missing.exitCode, 0, "the shell reports the missing script with a non-zero code");
});

test("runHook: a timeout kills the hook and reports timed-out; a missing executable reports failed-to-start", async () => {
  const s = sandbox();
  const slow = await runHook(nodeHook("setTimeout(() => {}, 10000)"), { input, vars: vars(s.proj), session, cwd: s.proj, timeoutMs: 500 });
  assert.equal(slow.status, "timed-out");
  assert.equal(slow.timeoutMs, 500);
  assert.ok(slow.ms < 9000);
  const gone = await runHook({ type: "command", command: "no-such-program-hb", args: [] }, { input, vars: vars(s.proj), session, cwd: s.proj });
  assert.equal(gone.status, "failed-to-start");
  assert.match(gone.error, /not found/);
});

test("runHook: a hook that exits before reading stdin still ends cleanly", async () => {
  const s = sandbox();
  const r = await runHook(nodeHook("process.exit(0)"), { input: { hook_event_name: "Stop", big: "x".repeat(200000) }, vars: vars(s.proj), session, cwd: s.proj });
  assert.equal(r.status, "ran");
  assert.equal(r.exitCode, 0);
});
