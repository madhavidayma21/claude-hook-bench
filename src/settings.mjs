// Find every hook a Claude Code setup has: the user, project and local settings files, managed settings,
// and the hooks.json of each enabled installed plugin (plus plugin folders given with --plugin-dir). Nothing
// here writes. A file that is not valid JSON is reported and left out, as Claude Code does.
//
// Precedence and scopes follow the reference ("Hook locations"): managed, local, project, user; plugin hooks
// load when the plugin is enabled. Hook entries merge across files; the same handler in two files runs once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EVENT_NAMES } from "./events.mjs";

export const SCOPES = ["managed", "local", "project", "user", "plugin"];

/** The folder Claude Code keeps its user settings, transcripts and plugins in. */
export function configDir(env = process.env, home = os.homedir()) {
  if (env.CLAUDE_CONFIG_DIR) return { dir: path.resolve(env.CLAUDE_CONFIG_DIR), source: "CLAUDE_CONFIG_DIR" };
  return { dir: path.join(home, ".claude"), source: "default" };
}

/** Where a machine-wide managed-settings.json lives on this system. */
export function managedDir(platform = process.platform) {
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
  return "/etc/claude-code";
}

export function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return { exists: false };
    return { exists: true, error: `cannot be read (${e.code || e.message})` };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.trim() === "") return { exists: true, error: "is empty", text };
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== "object" || Array.isArray(data)) return { exists: true, error: "is not a JSON object", text };
    return { exists: true, data, text };
  } catch (e) {
    return { exists: true, error: `is not valid JSON (${String(e.message).replace(/\s+/g, " ").slice(0, 120)})`, text };
  }
}

/** The git repository root above `dir` (a worktree resolves to its main checkout), or null. */
export function gitRoot(dir) {
  let d = path.resolve(dir);
  for (let i = 0; i < 64; i++) {
    const dotgit = path.join(d, ".git");
    let st = null;
    try { st = fs.statSync(dotgit); } catch { /* not here */ }
    if (st) {
      if (st.isFile()) {
        try {
          const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotgit, "utf8"));
          if (m) {
            const gd = path.resolve(d, m[1].trim());
            const w = gd.split(path.sep).lastIndexOf("worktrees");
            if (w > 0) return path.dirname(gd.split(path.sep).slice(0, w).join(path.sep));
          }
        } catch { /* use d */ }
      }
      return d;
    }
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}

/**
 * Where the local settings file is for a session started in `project`: the repository root in a git repository,
 * else the folder itself (not at the root on Windows, when the root is the home folder, or when the root belongs to
 * someone else). Claude Code also still reads a file older versions left in the folder itself.
 */
export function localSettingsPaths(project, { home = os.homedir(), platform = process.platform } = {}) {
  const own = path.join(project, ".claude", "settings.local.json");
  if (platform === "win32") return [own];
  const root = gitRoot(project);
  if (!root || path.resolve(root) === path.resolve(home)) return [own];
  try {
    const me = typeof process.getuid === "function" ? process.getuid() : null;
    if (me !== null && fs.statSync(root).uid !== me) return [own];
  } catch { /* cannot tell: use the root */ }
  const atRoot = path.join(root, ".claude", "settings.local.json");
  return atRoot === own ? [own] : [atRoot, own];
}

/** Line number (1-based) of the n-th occurrence of `"<key>"` in a JSON text, best effort, or null. */
function lineOf(text, key, occurrence = 0) {
  if (!text) return null;
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) {
    idx = text.indexOf(`"${key}"`, idx + 1);
    if (idx < 0) return null;
  }
  return text.slice(0, idx).split("\n").length;
}

/** Flatten a `hooks` object into hook entries. `source` is { scope, label, path, plugin? }. */
export function collectHooks(hooksObj, source, text, notes) {
  const out = [];
  if (hooksObj === undefined) return out;
  if (hooksObj === null || typeof hooksObj !== "object" || Array.isArray(hooksObj)) {
    notes.push({ severity: "error", message: `${source.label}: "hooks" is not an object, so Claude Code reads no hook from it` });
    return out;
  }
  const eventSeen = {};
  for (const [event, groups] of Object.entries(hooksObj)) {
    if (event === "modules") continue; // a mod's function-hooks module list lives in hooks.json too
    const known = EVENT_NAMES.includes(event);
    if (!Array.isArray(groups)) {
      notes.push({ severity: "error", message: `${source.label}: hooks.${event} is not a list, so Claude Code reads no hook from it` });
      continue;
    }
    groups.forEach((group, gi) => {
      if (group === null || typeof group !== "object" || Array.isArray(group)) {
        notes.push({ severity: "error", message: `${source.label}: hooks.${event}[${gi}] is not an object` });
        return;
      }
      const handlers = Array.isArray(group.hooks) ? group.hooks : null;
      if (!handlers) {
        notes.push({ severity: "error", message: `${source.label}: hooks.${event}[${gi}] has no "hooks" list, so Claude Code runs nothing for it` });
        return;
      }
      handlers.forEach((h, hi) => {
        const n = eventSeen[event] = (eventSeen[event] || 0) + 1;
        out.push({
          event, eventKnown: known, matcher: group.matcher, group: gi, index: hi, raw: h,
          scope: source.scope, label: source.label, file: source.path, plugin: source.plugin || null, pluginRoot: source.pluginRoot || null, pluginData: source.pluginData || null,
          line: lineOf(text, event, 0) && n === 1 ? lineOf(text, event, 0) : null,
        });
      });
    });
  }
  return out;
}

/** installed_plugins.json (version 2): { "name@market": [{ scope, installPath, version }] }. */
function readInstalledPlugins(cfgDir) {
  const r = readJson(path.join(cfgDir, "plugins", "installed_plugins.json"));
  if (!r.data) return { entries: [], error: r.exists ? r.error : null };
  const entries = [];
  const plugins = r.data.plugins && typeof r.data.plugins === "object" ? r.data.plugins : {};
  for (const [id, list] of Object.entries(plugins)) {
    const arr = Array.isArray(list) ? list : [list];
    for (const e of arr) if (e && typeof e.installPath === "string") entries.push({ id, name: id.split("@")[0], marketplace: id.split("@")[1] || "", installPath: e.installPath, version: e.version || null, scope: e.scope || "user" });
  }
  return { entries, error: null };
}

function pluginSource(root, name, marketplace, cfgDir, kind) {
  const label = kind === "inline" ? `plugin ${name} (--plugin-dir)` : `plugin ${name}@${marketplace}`;
  return { scope: "plugin", label, path: path.join(root, "hooks", "hooks.json"), plugin: name, pluginRoot: root, pluginData: path.join(cfgDir, "plugins", "data", `${name}-${kind === "inline" ? "inline" : marketplace}`) };
}

/** Hooks of one plugin folder: hooks/hooks.json and the manifest's `hooks` key (an object or a path). */
function pluginHooks(root, name, marketplace, cfgDir, kind, notes) {
  const out = [];
  const src = pluginSource(root, name, marketplace, cfgDir, kind);
  const hooksFile = readJson(src.path);
  const files = [];
  if (hooksFile.exists) {
    if (hooksFile.error) notes.push({ severity: "error", message: `${src.label}: hooks/hooks.json ${hooksFile.error}, so none of its hooks load` });
    else { files.push(src.path); out.push(...collectHooks(hooksFile.data.hooks, src, hooksFile.text, notes)); }
  }
  const manifest = readJson(path.join(root, ".claude-plugin", "plugin.json"));
  if (manifest.data && manifest.data.hooks !== undefined) {
    const h = manifest.data.hooks;
    if (typeof h === "string") {
      const file = path.resolve(root, h.replace(/^\.\//, ""));
      if (path.resolve(file) !== path.resolve(src.path)) {
        const r = readJson(file);
        if (r.data) { files.push(file); out.push(...collectHooks(r.data.hooks, { ...src, path: file }, r.text, notes)); }
        else notes.push({ severity: "error", message: `${src.label}: the manifest's hooks file ${h} ${r.exists ? r.error : "does not exist"}` });
      }
    } else if (h && typeof h === "object") {
      files.push(path.join(root, ".claude-plugin", "plugin.json"));
      out.push(...collectHooks(h.hooks && typeof h.hooks === "object" ? h.hooks : h, { ...src, path: path.join(root, ".claude-plugin", "plugin.json") }, manifest.text, notes));
    }
  }
  return { hooks: out, files, name: (manifest.data && manifest.data.name) || name, version: (manifest.data && manifest.data.version) || null };
}

/**
 * Read every hook that applies.
 *   project      the folder Claude Code starts in
 *   pluginDirs   plugin folders to load as --plugin-dir would
 *   plugins      false to skip installed plugins
 *   env, home, platform, managed   injectable so tests never touch the real machine
 */
export function loadHooks({ project, pluginDirs = [], plugins = true, env = process.env, home = os.homedir(), platform = process.platform, managed } = {}) {
  const cfg = configDir(env, home);
  const proj = path.resolve(project || process.cwd());
  const notes = [];
  const files = [];
  const hooks = [];
  const settingsData = {};
  const add = (scope, label, file) => {
    const r = readJson(file);
    const f = { scope, label, path: file, exists: r.exists, error: r.error || null, hooks: 0 };
    files.push(f);
    if (r.error) notes.push({ severity: "error", message: `${label} (${file}) ${r.error}: Claude Code reads nothing from it, hooks included` });
    if (r.data) {
      settingsData[scope] = settingsData[scope] || [];
      settingsData[scope].push(r.data);
      const list = collectHooks(r.data.hooks, { scope, label, path: file }, r.text, notes);
      f.hooks = list.length;
      hooks.push(...list);
    }
    return f;
  };

  const mdir = managed || env.CLAUDE_HOOK_BENCH_MANAGED_DIR || managedDir(platform);
  add("managed", "managed settings", path.join(mdir, "managed-settings.json"));
  try {
    for (const name of fs.readdirSync(path.join(mdir, "managed-settings.d")).filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort()) {
      add("managed", `managed settings (${name})`, path.join(mdir, "managed-settings.d", name));
    }
  } catch { /* no drop-in folder */ }
  for (const p of localSettingsPaths(proj, { home, platform })) add("local", "local settings", p);
  add("project", "project settings", path.join(proj, ".claude", "settings.json"));
  add("user", "user settings", path.join(cfg.dir, "settings.json"));

  // settings read by precedence: managed, local, project, user
  const setting = (key) => {
    for (const scope of ["managed", "local", "project", "user"]) for (const d of settingsData[scope] || []) if (d[key] !== undefined) return { value: d[key], scope };
    return null;
  };
  const disableAll = setting("disableAllHooks");
  const managedOnly = (settingsData.managed || []).some((d) => d.allowManagedHooksOnly === true);

  // enabledPlugins merge: later scopes override earlier ones (user, project, local; managed wins)
  const enabled = {};
  for (const scope of ["user", "project", "local", "managed"]) for (const d of settingsData[scope] || []) if (d.enabledPlugins && typeof d.enabledPlugins === "object") Object.assign(enabled, d.enabledPlugins);

  const pluginList = [];
  if (plugins) {
    const installed = readInstalledPlugins(cfg.dir);
    if (installed.error) notes.push({ severity: "warn", message: `plugins/installed_plugins.json ${installed.error}: installed plugins could not be listed` });
    for (const p of installed.entries) {
      const on = enabled[p.id];
      if (on !== true) { pluginList.push({ ...p, enabled: false, hooks: 0 }); continue; }
      if (!fs.existsSync(p.installPath)) { notes.push({ severity: "error", message: `plugin ${p.id} is enabled but its install folder is missing (${p.installPath}); Claude Code shows it as not cached` }); pluginList.push({ ...p, enabled: true, missing: true, hooks: 0 }); continue; }
      const ph = pluginHooks(p.installPath, p.name, p.marketplace, cfg.dir, "installed", notes);
      hooks.push(...ph.hooks);
      pluginList.push({ ...p, enabled: true, hooks: ph.hooks.length, files: ph.files });
    }
  }
  for (const dir of pluginDirs) {
    const root = path.resolve(dir);
    const manifest = readJson(path.join(root, ".claude-plugin", "plugin.json"));
    const name = (manifest.data && manifest.data.name) || path.basename(root);
    if (!fs.existsSync(root)) { notes.push({ severity: "error", message: `--plugin-dir ${dir}: the folder does not exist` }); continue; }
    const ph = pluginHooks(root, name, "inline", cfg.dir, "inline", notes);
    hooks.push(...ph.hooks);
    pluginList.push({ id: `${name}@inline`, name, marketplace: "inline", installPath: root, version: ph.version, enabled: true, hooks: ph.hooks.length, files: ph.files, inline: true });
  }

  // the same handler in several settings files runs once
  const seen = new Map();
  for (const h of hooks) {
    if (h.scope === "plugin") continue;
    const key = `${h.event}\u0000${JSON.stringify(h.matcher ?? "")}\u0000${JSON.stringify(h.raw)}`;
    if (seen.has(key)) h.duplicateOf = seen.get(key);
    else seen.set(key, h);
  }
  hooks.forEach((h, i) => { h.n = i + 1; });

  return {
    configDir: cfg.dir, configSource: cfg.source, project: proj, home, files, hooks, plugins: pluginList, notes,
    disableAllHooks: disableAll ? { value: disableAll.value === true, scope: disableAll.scope } : null,
    allowManagedHooksOnly: managedOnly,
  };
}

/** Display form of a path: forward slashes, ~ for the home folder, project-relative inside the project. */
export function shortPath(file, { home, project } = {}) {
  const f = path.resolve(String(file));
  const within = (base) => {
    if (!base) return null;
    const rel = path.relative(base, f);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : null;
  };
  const p = within(project);
  if (p) return p.replace(/\\/g, "/");
  const h = within(home);
  if (h) return `~/${h.replace(/\\/g, "/")}`;
  return f.replace(/\\/g, "/");
}
