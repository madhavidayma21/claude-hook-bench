// Shared test helpers. Nothing here, and nothing in the tests, touches the real Claude config: the moment this
// file loads, every way the tool can find a config, home or managed-settings folder is pointed at a throwaway
// folder, and every project the tests build lives under the OS temp folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const made = [];
const cleanup = () => {
  for (const dir of made) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the OS cleans the temp folder eventually */ }
  }
};
process.on("exit", cleanup);

/** A fresh temp folder (real path, short name). */
export function tmp(prefix = "hb-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

// The safety net: this process's own idea of "home", "the Claude config" and "the managed settings" is a temp folder.
const SAFE = tmp("hb-safe-");
fs.mkdirSync(path.join(SAFE, ".claude"));
Object.assign(process.env, {
  HOME: SAFE,
  USERPROFILE: SAFE,
  CLAUDE_CONFIG_DIR: path.join(SAFE, ".claude"),
  CLAUDE_HOOK_BENCH_MANAGED_DIR: path.join(SAFE, "no-managed-settings"),
  NO_COLOR: "1",
});
delete process.env.CLAUDE_PROJECT_DIR;
delete process.env.CLAUDE_PLUGIN_ROOT;
delete process.env.CLAUDE_ENV_FILE;

export const BIN = fileURLToPath(new URL("../bin/claude-hook-bench.mjs", import.meta.url));
export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const NODE = process.execPath;
export const IS_WIN = process.platform === "win32";

export const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return file;
};

/** A node one-liner as an exec-form hook: { type: "command", command: node, args: ["-e", code] }. */
export const nodeHook = (code, extra = {}) => ({ type: "command", command: NODE, args: ["-e", code], ...extra });
/** A hook that prints the given JSON (object) and exits with `code`. */
export const printJson = (obj, code = 0, extra = {}) => nodeHook(`process.stdout.write(${JSON.stringify(JSON.stringify(obj))}); process.exit(${code})`, extra);
/** A hook that prints text to stdout, text to stderr and exits with code. */
export const printText = (out, err = "", code = 0, extra = {}) => nodeHook(`process.stdout.write(${JSON.stringify(out)}); process.stderr.write(${JSON.stringify(err)}); process.exit(${code})`, extra);
/** A hook that echoes its stdin back as JSON under {"got": ...}: lets a test see exactly what was sent. */
export const echoHook = (extra = {}) => nodeHook("const s=require('fs').readFileSync(0,'utf8'); process.stdout.write(JSON.stringify({got: JSON.parse(s), env: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^CLAUDE/.test(k))), cwd: process.cwd(), argv: process.argv.slice(2)}))", extra);

/**
 * A sandbox: base/proj (the project), base/cfg (Claude's config folder), base/home, base/managed.
 * Settings files are written from the options: user, project, local, managed (objects or raw text).
 * plugins: [{ name, marketplace = "mkt", hooks, manifest, enabled = true, files }] become installed plugins.
 */
export function sandbox({ user, project, local, managed, plugins = [], files = {} } = {}) {
  const base = tmp();
  const s = { base, proj: path.join(base, "proj"), cfg: path.join(base, "cfg"), home: path.join(base, "home"), managedDir: path.join(base, "managed") };
  for (const d of [s.proj, s.cfg, s.home]) fs.mkdirSync(d, { recursive: true });
  s.userFile = path.join(s.cfg, "settings.json");
  s.projectFile = path.join(s.proj, ".claude", "settings.json");
  s.localFile = path.join(s.proj, ".claude", "settings.local.json");
  s.managedFile = path.join(s.managedDir, "managed-settings.json");
  if (user !== undefined) write(s.userFile, user);
  if (project !== undefined) write(s.projectFile, project);
  if (local !== undefined) write(s.localFile, local);
  if (managed !== undefined) write(s.managedFile, managed);
  for (const [rel, text] of Object.entries(files)) write(path.join(s.proj, rel), text);
  if (plugins.length) {
    const installed = { version: 2, plugins: {} };
    const enabled = {};
    for (const p of plugins) {
      const market = p.marketplace || "mkt";
      const id = `${p.name}@${market}`;
      const root = path.join(s.cfg, "plugins", "cache", market, p.name, p.version || "1.0.0");
      write(path.join(root, ".claude-plugin", "plugin.json"), p.manifest || { name: p.name, version: p.version || "1.0.0" });
      if (p.hooks !== undefined) write(path.join(root, "hooks", "hooks.json"), typeof p.hooks === "string" ? p.hooks : { hooks: p.hooks });
      for (const [rel, text] of Object.entries(p.files || {})) write(path.join(root, rel), text);
      installed.plugins[id] = [{ scope: "user", installPath: root, version: p.version || "1.0.0", installedAt: "2026-10-15T00:00:00.000Z", lastUpdated: "2026-10-15T00:00:00.000Z" }];
      if (p.enabled !== false) enabled[id] = true;
      else if (p.enabled === false) enabled[id] = false;
      p.root = root;
    }
    write(path.join(s.cfg, "plugins", "installed_plugins.json"), installed);
    const current = fs.existsSync(s.userFile) ? JSON.parse(fs.readFileSync(s.userFile, "utf8")) : {};
    current.enabledPlugins = { ...(current.enabledPlugins || {}), ...enabled };
    write(s.userFile, current);
  }
  s.write = (rel, value) => write(path.join(s.proj, rel), value);
  s.env = (extra = {}) => ({ HOME: s.home, USERPROFILE: s.home, CLAUDE_CONFIG_DIR: s.cfg, CLAUDE_HOOK_BENCH_MANAGED_DIR: s.managedDir, NO_COLOR: "1", ...extra });
  s.io = (extra = {}) => ({ env: { ...process.env, ...s.env() }, home: s.home, cwd: s.proj, managed: s.managedDir, project: s.proj, ...extra });
  s.cli = (args, extra = {}) => runCli(args, { cwd: s.proj, env: s.env(extra) });
  return s;
}

/** Run the CLI as a separate process. */
export function runCli(args, { cwd, env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd, input, encoding: "utf8", windowsHide: true, timeout: 120000,
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

/** Run main() in this process with captured output. */
export async function runMain(main, argv, io) {
  let out = "";
  let err = "";
  const code = await main(argv, { stdout: { write: (x) => { out += x; }, isTTY: false }, stderr: { write: (x) => { err += x; } }, ...io });
  return { code, out, err };
}

export const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
