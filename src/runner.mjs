// Run one command hook the way Claude Code runs it, with the event's JSON on stdin: exec form (command plus
// args, spawned directly, no shell) or shell form (the command string through sh -c, Git Bash on Windows, or
// PowerShell when Git Bash is not installed or the hook says shell: "powershell"). The placeholders
// ${CLAUDE_PROJECT_DIR}, ${CLAUDE_PLUGIN_ROOT} and ${CLAUDE_PLUGIN_DATA} are substituted and exported, as are
// the other variables a hook gets from Claude Code (CLAUDE_CODE_SESSION_ID, CLAUDE_EFFORT, CLAUDE_ENV_FILE ...).
// This is the only file that starts a process.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const IS_WIN = process.platform === "win32";

/** Git Bash on Windows: CLAUDE_CODE_GIT_BASH_PATH, then next to git, then the usual folders. */
export function findGitBash(env = process.env) {
  if (!IS_WIN) return null;
  const candidates = [];
  if (env.CLAUDE_CODE_GIT_BASH_PATH) candidates.push(env.CLAUDE_CODE_GIT_BASH_PATH);
  const where = spawnSync("where", ["git"], { encoding: "utf8", windowsHide: true, env });
  for (const line of (where.stdout || "").split(/\r?\n/).filter(Boolean)) candidates.push(path.join(path.dirname(line), "..", "bin", "bash.exe"), path.join(path.dirname(line), "..", "usr", "bin", "bash.exe"));
  candidates.push("C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe");
  for (const c of candidates) if (c && fs.existsSync(c)) return path.resolve(c);
  return null;
}

/** PowerShell: pwsh when present, else powershell.exe. */
export function findPowerShell(env = process.env) {
  const which = spawnSync(IS_WIN ? "where" : "which", ["pwsh"], { encoding: "utf8", windowsHide: true, env });
  const first = (which.stdout || "").split(/\r?\n/).find(Boolean);
  if (which.status === 0 && first) return first.trim();
  return IS_WIN ? "powershell.exe" : null;
}

/** Find an executable on PATH (or as a path). Returns the resolved path or null. */
export function resolveExecutable(command, { cwd, env = process.env } = {}) {
  if (!command || typeof command !== "string") return null;
  const hasSep = /[\\/]/.test(command);
  const exts = IS_WIN ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase()) : [""];
  const tryFile = (p) => {
    const candidates = [p, ...(IS_WIN && !exts.some((e) => e && p.toLowerCase().endsWith(e)) ? exts.filter(Boolean).map((e) => p + e) : [])];
    for (const c of candidates) {
      try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ }
    }
    return null;
  };
  if (hasSep || path.isAbsolute(command)) return tryFile(path.resolve(cwd || process.cwd(), command));
  const dirs = String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    const found = tryFile(path.join(d, command));
    if (found) return found;
  }
  return null;
}

/** Substitute the path placeholders in a string. `powershell` rewrites them to ${env:NAME} as Claude Code does for PowerShell shell-form. */
export function substitute(text, vars, { powershell = false } = {}) {
  return String(text).replace(/\$\{(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)\}/g, (m, name) => {
    if (powershell) return `\${env:${name}}`;
    return vars[name] !== undefined ? vars[name] : m;
  });
}

/**
 * Decide how a command hook runs: { form: "exec" | "shell", shell: "bash" | "powershell" | "sh" | null, file, argv, display }.
 * `hook` is the raw handler; `vars` the placeholder values; `env` the environment used to find shells.
 */
export function plan(hook, vars, { env = process.env, cwd } = {}) {
  const posix = (p) => (p === undefined ? p : String(p).replace(/\\/g, "/"));
  if (Array.isArray(hook.args)) {
    const file = substitute(hook.command, vars);
    const argv = hook.args.map((a) => substitute(String(a), vars));
    return { form: "exec", shell: null, file, argv, display: [file, ...argv].join(" "), resolved: resolveExecutable(file, { cwd, env }) };
  }
  const wantsPs = hook.shell === "powershell";
  const bash = IS_WIN ? findGitBash(env) : null;
  if (!IS_WIN && !wantsPs) {
    const command = substitute(hook.command, vars);
    return { form: "shell", shell: "sh", file: "/bin/sh", argv: ["-c", command], display: command, resolved: "/bin/sh" };
  }
  if (!wantsPs && bash) {
    // Git Bash: the exported placeholders are written with forward slashes, as Claude Code does
    const command = substitute(hook.command, { CLAUDE_PROJECT_DIR: posix(vars.CLAUDE_PROJECT_DIR), CLAUDE_PLUGIN_ROOT: posix(vars.CLAUDE_PLUGIN_ROOT), CLAUDE_PLUGIN_DATA: posix(vars.CLAUDE_PLUGIN_DATA) });
    return { form: "shell", shell: "bash", file: bash, argv: ["-c", command], display: command, resolved: bash, posixEnv: true };
  }
  const ps = findPowerShell(env);
  if (!ps) return { form: "shell", shell: "powershell", file: null, argv: [], display: hook.command, resolved: null };
  const command = substitute(hook.command, vars, { powershell: true });
  return { form: "shell", shell: "powershell", file: ps, argv: ["-NoProfile", "-NonInteractive", "-Command", command], display: command, resolved: ps };
}

/**
 * Run a command hook. Resolves { status: "ran" | "timed-out" | "failed-to-start", exitCode, stdout, stderr, ms, timeoutMs, error, envFile }.
 *   input      the JSON object for stdin
 *   vars       { CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT?, CLAUDE_PLUGIN_DATA? }
 *   session    { sessionId, effort, envFile (path or null) }
 *   timeoutMs  when to give up
 */
export function runHook(hook, { input, vars, session, cwd, env = process.env, timeoutMs = 30000 }) {
  const p = plan(hook, vars, { env, cwd });
  return new Promise((resolve) => {
    const t0 = Date.now();
    if (!p.file || (p.form === "exec" && !p.resolved)) {
      resolve({ status: "failed-to-start", exitCode: null, stdout: "", stderr: "", ms: 0, timeoutMs, error: p.form === "exec" ? `${p.file}: not found on PATH` : "no shell found to run the command", plan: p });
      return;
    }
    const posix = (v) => (p.posixEnv && v ? String(v).replace(/\\/g, "/") : v);
    const childEnv = { ...env };
    for (const k of ["CLAUDE_ENV_FILE", "CLAUDE_PLUGIN_ROOT", "CLAUDE_PLUGIN_DATA", "CLAUDE_PROJECT_DIR"]) delete childEnv[k];
    Object.assign(childEnv, { CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_PROJECT_DIR: posix(vars.CLAUDE_PROJECT_DIR), CLAUDE_CODE_SESSION_ID: session.sessionId, CLAUDE_EFFORT: session.effort || "medium", CLAUDE_HOOK_BENCH: "1" });
    if (vars.CLAUDE_PLUGIN_ROOT) childEnv.CLAUDE_PLUGIN_ROOT = posix(vars.CLAUDE_PLUGIN_ROOT);
    if (vars.CLAUDE_PLUGIN_DATA) childEnv.CLAUDE_PLUGIN_DATA = posix(vars.CLAUDE_PLUGIN_DATA);
    if (session.envFile) childEnv.CLAUDE_ENV_FILE = posix(session.envFile);
    let child;
    try {
      child = spawn(p.file, p.argv, { cwd, env: childEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      resolve({ status: "failed-to-start", exitCode: null, stdout: "", stderr: "", ms: Date.now() - t0, timeoutMs, error: e.message, plan: p });
      return;
    }
    let stdout = "";
    let stderr = "";
    let done = false;
    let timedOut = false;
    child.stdin.on("error", () => { /* the hook closed stdin before reading it: not an error of the hook */ });
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ status: "failed-to-start", exitCode: null, stdout, stderr, ms: Date.now() - t0, timeoutMs, error: e.code === "ENOENT" ? `${p.file}: not found` : e.message, plan: p });
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); else child.kill("SIGKILL"); } catch { /* gone */ }
    }, timeoutMs);
    child.on("close", (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const ms = Date.now() - t0;
      if (timedOut) resolve({ status: "timed-out", exitCode: null, stdout, stderr, ms, timeoutMs, error: null, plan: p });
      else resolve({ status: "ran", exitCode: code === null ? (signal ? 128 : 1) : code, stdout, stderr, ms, timeoutMs, error: null, signal: signal || null, plan: p });
    });
    try { child.stdin.end(JSON.stringify(input)); } catch { /* the hook closed stdin first */ }
  });
}
