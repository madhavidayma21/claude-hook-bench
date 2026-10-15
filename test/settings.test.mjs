// Finding the hooks: the settings files, their precedence, plugins, --plugin-dir, and files that are not JSON.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandbox, write } from "./helpers.mjs";
import { collectHooks, configDir, gitRoot, loadHooks, localSettingsPaths, managedDir, readJson, shortPath } from "../src/settings.mjs";

const hook = (command, extra = {}) => ({ type: "command", command, ...extra });
const hooks = (event, matcher, ...hs) => ({ [event]: [matcher === null ? { hooks: hs } : { matcher, hooks: hs }] });

test("configDir: CLAUDE_CONFIG_DIR or ~/.claude; managedDir per platform", () => {
  assert.deepEqual(configDir({ CLAUDE_CONFIG_DIR: "/x/cfg" }, "/home/me"), { dir: path.resolve("/x/cfg"), source: "CLAUDE_CONFIG_DIR" });
  assert.deepEqual(configDir({}, "/home/me"), { dir: path.join("/home/me", ".claude"), source: "default" });
  assert.equal(managedDir("win32"), "C:\\Program Files\\ClaudeCode");
  assert.equal(managedDir("darwin"), "/Library/Application Support/ClaudeCode");
  assert.equal(managedDir("linux"), "/etc/claude-code");
});

test("readJson: missing, empty, not an object, invalid, with a BOM", () => {
  const s = sandbox();
  assert.deepEqual(readJson(path.join(s.base, "nope.json")), { exists: false });
  assert.equal(readJson(write(path.join(s.base, "empty.json"), "")).error, "is empty");
  assert.equal(readJson(write(path.join(s.base, "arr.json"), "[1]")).error, "is not a JSON object");
  assert.match(readJson(write(path.join(s.base, "bad.json"), "{ 'x': 1 }")).error, /not valid JSON/);
  assert.deepEqual(readJson(write(path.join(s.base, "bom.json"), "\uFEFF{\"a\":1}")).data, { a: 1 });
});

test("loadHooks: every file, its scope and label, counts, and the hooks in precedence order", () => {
  const s = sandbox({
    user: { hooks: { ...hooks("PreToolUse", "Bash", hook("echo user")), ...hooks("Stop", null, hook("echo stop")) } },
    project: { hooks: hooks("PreToolUse", "Edit", hook("echo project")) },
    local: { hooks: hooks("SessionStart", "startup", hook("echo local")) },
    managed: { hooks: hooks("Notification", "idle_prompt", hook("echo managed")) },
  });
  const m = loadHooks(s.io());
  assert.equal(m.configDir, s.cfg);
  assert.equal(m.configSource, "CLAUDE_CONFIG_DIR");
  assert.deepEqual(m.files.map((f) => [f.scope, f.exists, f.hooks]), [["managed", true, 1], ["local", true, 1], ["project", true, 1], ["user", true, 2]]);
  assert.deepEqual(m.hooks.map((h) => [h.n, h.scope, h.event, h.matcher, h.raw.command]), [[1, "managed", "Notification", "idle_prompt", "echo managed"], [2, "local", "SessionStart", "startup", "echo local"], [3, "project", "PreToolUse", "Edit", "echo project"], [4, "user", "PreToolUse", "Bash", "echo user"], [5, "user", "Stop", undefined, "echo stop"]]);
  assert.equal(m.hooks[4].matcher, undefined);
  assert.equal(m.hooks[3].label, "user settings");
  assert.equal(m.hooks[3].file, s.userFile);
  assert.equal(m.hooks[3].line, 3, "the line of the event key");
  assert.deepEqual(m.notes, []);
  assert.equal(m.disableAllHooks, null);
  assert.equal(m.allowManagedHooksOnly, false);
});

test("loadHooks: a managed-settings.d folder, allowManagedHooksOnly and disableAllHooks by precedence", () => {
  const s = sandbox({ managed: { allowManagedHooksOnly: true, hooks: hooks("Stop", null, hook("a")) }, user: { disableAllHooks: true, hooks: hooks("Stop", null, hook("b")) }, project: { disableAllHooks: false } });
  write(path.join(s.managedDir, "managed-settings.d", "10-extra.json"), { hooks: hooks("Stop", null, hook("c")) });
  const m = loadHooks(s.io());
  assert.deepEqual(m.files.slice(0, 2).map((f) => f.label), ["managed settings", "managed settings (10-extra.json)"]);
  assert.deepEqual(m.hooks.map((h) => h.raw.command), ["a", "c", "b"]);
  assert.equal(m.allowManagedHooksOnly, true);
  assert.deepEqual(m.disableAllHooks, { value: false, scope: "project" }, "the project file's false outranks the user file's true");
  const t = sandbox({ user: { disableAllHooks: true }, local: { disableAllHooks: true }, managed: { disableAllHooks: false } });
  assert.deepEqual(loadHooks(t.io()).disableAllHooks, { value: false, scope: "managed" });
});

test("loadHooks: files that are not JSON or not the right shape are reported and skipped, like Claude Code does", () => {
  const s = sandbox({ user: "{ not json", project: { hooks: "nope" }, local: { hooks: { Stop: "x", PreToolUse: [{ matcher: "Bash" }, "junk", { hooks: [hook("ok")] }] } } });
  const m = loadHooks(s.io());
  assert.equal(m.files.find((f) => f.scope === "user").error.slice(0, 17), "is not valid JSON");
  assert.deepEqual(m.hooks.map((h) => h.raw.command), ["ok"]);
  const msgs = m.notes.map((n) => n.message);
  assert.ok(msgs.some((x) => /user settings .* is not valid JSON/.test(x)), msgs.join("\n"));
  assert.ok(msgs.some((x) => /project settings: "hooks" is not an object/.test(x)));
  assert.ok(msgs.some((x) => /hooks\.Stop is not a list/.test(x)));
  assert.ok(msgs.some((x) => /hooks\.PreToolUse\[0\] has no "hooks" list/.test(x)));
  assert.ok(msgs.some((x) => /hooks\.PreToolUse\[1\] is not an object/.test(x)));
});

test("loadHooks: the same handler in two settings files is marked as running once", () => {
  const h = hook("echo same", { timeout: 5 });
  const s = sandbox({ user: { hooks: hooks("Stop", null, h) }, project: { hooks: hooks("Stop", null, h, hook("echo other")) } });
  const m = loadHooks(s.io());
  assert.equal(m.hooks.length, 3);
  assert.equal(m.hooks[0].duplicateOf, undefined);
  assert.equal(m.hooks[2].duplicateOf, m.hooks[0], "the user copy points at the project copy");
  assert.equal(m.hooks[1].duplicateOf, undefined);
});

test("loadHooks: unknown event names are kept (and flagged), `modules` is left alone", () => {
  const s = sandbox({ user: { hooks: { PreToolUs: [{ hooks: [hook("typo")] }], modules: ["./mod.mjs"] } } });
  const m = loadHooks(s.io());
  assert.deepEqual(m.hooks.map((h) => [h.event, h.eventKnown]), [["PreToolUs", false]]);
});

test("loadHooks: installed plugins from installed_plugins.json, enabled through enabledPlugins, with their folders and data dirs", () => {
  const s = sandbox({
    plugins: [
      { name: "alpha", hooks: hooks("Stop", null, hook("node", { args: ["${CLAUDE_PLUGIN_ROOT}/stop.mjs"] })) },
      { name: "beta", marketplace: "other", version: "2.0.0", hooks: hooks("PreToolUse", "Bash", hook("echo beta")), enabled: false },
      { name: "gamma", hooks: "{ bad json" },
      { name: "delta", manifest: { name: "delta", version: "1.0.0", hooks: { PostToolUse: [{ matcher: "Write", hooks: [hook("echo delta")] }] } } },
      { name: "epsilon", manifest: { name: "epsilon", version: "1.0.0", hooks: "./my-hooks.json" }, files: { "my-hooks.json": JSON.stringify({ hooks: hooks("SessionEnd", null, hook("echo eps")) }) } },
    ],
  });
  const m = loadHooks(s.io());
  const names = m.hooks.map((h) => [h.plugin, h.event, h.raw.command]);
  assert.deepEqual(names, [["alpha", "Stop", "node"], ["delta", "PostToolUse", "echo delta"], ["epsilon", "SessionEnd", "echo eps"]]);
  const alpha = m.hooks[0];
  assert.equal(alpha.scope, "plugin");
  assert.equal(alpha.label, "plugin alpha@mkt");
  assert.equal(alpha.pluginRoot, path.join(s.cfg, "plugins", "cache", "mkt", "alpha", "1.0.0"));
  assert.equal(alpha.pluginData, path.join(s.cfg, "plugins", "data", "alpha-mkt"));
  assert.deepEqual(m.plugins.map((p) => [p.id, p.enabled, p.hooks]), [["alpha@mkt", true, 1], ["beta@other", false, 0], ["gamma@mkt", true, 0], ["delta@mkt", true, 1], ["epsilon@mkt", true, 1]]);
  assert.ok(m.notes.some((n) => /plugin gamma@mkt: hooks\/hooks.json is not valid JSON/.test(n.message)), JSON.stringify(m.notes));
  // enabledPlugins precedence: the project file can switch a user-enabled plugin off, and on again
  write(s.projectFile, { enabledPlugins: { "alpha@mkt": false } });
  assert.deepEqual(loadHooks(s.io()).hooks.map((h) => h.plugin), ["delta", "epsilon"]);
  write(s.localFile, { enabledPlugins: { "alpha@mkt": true } });
  assert.deepEqual(loadHooks(s.io()).hooks.map((h) => h.plugin), ["alpha", "delta", "epsilon"]);
  // --no-plugins
  assert.deepEqual(loadHooks({ ...s.io(), plugins: false }).hooks, []);
});

test("loadHooks: a missing install folder is an error; a broken installed_plugins.json a warning", () => {
  const s = sandbox({ plugins: [{ name: "gone", hooks: hooks("Stop", null, hook("x")) }] });
  const m0 = loadHooks(s.io());
  fs.rmSync(m0.plugins[0].installPath, { recursive: true, force: true });
  const m = loadHooks(s.io());
  assert.ok(m.notes.some((n) => n.severity === "error" && /gone@mkt is enabled but its install folder is missing/.test(n.message)));
  assert.equal(m.plugins[0].missing, true);
  write(path.join(s.cfg, "plugins", "installed_plugins.json"), "nope");
  assert.ok(loadHooks(s.io()).notes.some((n) => n.severity === "warn" && /installed_plugins.json/.test(n.message)));
});

test("loadHooks: --plugin-dir folders load as inline plugins, named by their manifest", () => {
  const s = sandbox();
  const dir = path.join(s.base, "myplug");
  write(path.join(dir, ".claude-plugin", "plugin.json"), { name: "my-plugin", version: "0.1.0" });
  write(path.join(dir, "hooks", "hooks.json"), { hooks: hooks("UserPromptSubmit", null, hook("node", { args: ["${CLAUDE_PLUGIN_ROOT}/p.mjs"] })) });
  const m = loadHooks({ ...s.io(), pluginDirs: [dir, path.join(s.base, "missing")] });
  assert.deepEqual(m.hooks.map((h) => [h.plugin, h.event, h.label]), [["my-plugin", "UserPromptSubmit", "plugin my-plugin (--plugin-dir)"]]);
  assert.equal(m.hooks[0].pluginRoot, dir);
  assert.equal(m.hooks[0].pluginData, path.join(s.cfg, "plugins", "data", "my-plugin-inline"));
  assert.deepEqual(m.plugins.map((p) => [p.id, p.inline, p.version]), [["my-plugin@inline", true, "0.1.0"]]);
  assert.ok(m.notes.some((n) => /--plugin-dir .*missing: the folder does not exist/.test(n.message)));
});

test("collectHooks keeps the group and index of each handler, and the matcher per group", () => {
  const notes = [];
  const out = collectHooks({ PreToolUse: [{ matcher: "Bash", hooks: [hook("a"), hook("b")] }, { hooks: [hook("c")] }] }, { scope: "user", label: "user settings", path: "/x" }, null, notes);
  assert.deepEqual(out.map((h) => [h.matcher, h.group, h.index, h.raw.command]), [["Bash", 0, 0, "a"], ["Bash", 0, 1, "b"], [undefined, 1, 0, "c"]]);
  assert.deepEqual(collectHooks(undefined, {}, null, notes), []);
  assert.deepEqual(notes, []);
});

test("localSettingsPaths and gitRoot", () => {
  const s = sandbox();
  const own = path.join(s.proj, ".claude", "settings.local.json");
  assert.deepEqual(localSettingsPaths(s.proj, { home: s.home, platform: "win32" }), [own]);
  assert.deepEqual(localSettingsPaths(s.proj, { home: s.home, platform: "linux" }), [own], "no git repository: the folder itself");
  fs.mkdirSync(path.join(s.proj, ".git"));
  const sub = path.join(s.proj, "sub");
  fs.mkdirSync(sub);
  assert.equal(gitRoot(sub), s.proj);
  const paths = localSettingsPaths(sub, { home: s.home, platform: "linux" });
  assert.deepEqual(paths, [own, path.join(sub, ".claude", "settings.local.json")]);
  write(path.join(s.proj, "wt", ".git"), `gitdir: ${path.join(s.proj, ".git", "worktrees", "wt")}\n`);
  assert.equal(gitRoot(path.join(s.proj, "wt")), s.proj, "a worktree resolves to its main checkout");
  assert.equal(gitRoot(s.base), null);
});

test("shortPath: project-relative, ~ for home, forward slashes", () => {
  assert.equal(shortPath("/home/me/app/.claude/settings.json", { home: "/home/me", project: "/home/me/app" }), ".claude/settings.json");
  assert.equal(shortPath("/home/me/.claude/settings.json", { home: "/home/me", project: "/home/me/app" }), "~/.claude/settings.json");
  assert.equal(shortPath(path.resolve("/etc/claude-code/managed-settings.json"), { home: "/home/me", project: "/home/me/app" }), path.resolve("/etc/claude-code/managed-settings.json").replace(/\\/g, "/"));
});
