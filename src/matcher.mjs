// Which fixture values a hook's matcher fires for, and whether its `if` rule lets a tool call through.
//
// The `if` field holds one permission rule (Tool or Tool(pattern)). The reference's Bash table is followed:
// leading VAR=value assignments are stripped, each subcommand is checked, commands inside $() and backticks are
// checked, and a pattern that says more than the command name runs the hook anyway when the command has $(),
// backticks or a $VAR. Claude Code calls its own filter best-effort; this one is a reading of the same rules,
// so a verdict here says "would run" or "would not run", never "is safe".
import path from "node:path";
import { TOOL_EVENTS, eventByName, matcherKind, matcherList, matcherMatches } from "./events.mjs";
import { candidateValues, defaultValues, TOOL_NAMES } from "./fixtures.mjs";

/** Parse `Tool(content)` or `Tool`. Returns { tool, content } or null. */
export function parseRule(rule) {
  if (typeof rule !== "string") return null;
  const m = /^([A-Za-z][\w-]*(?:__[\w-]+)*)(?:\((.*)\))?$/s.exec(rule.trim());
  if (!m) return null;
  return { tool: m[1], content: m[2] === undefined ? undefined : m[2] };
}

/** A permission-style pattern against a string: `*` matches anything, `prefix:*` is a prefix of a word boundary. */
export function patternMatches(pattern, text) {
  if (pattern === undefined || pattern === "*") return true;
  const t = String(text);
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -2);
    return t === prefix || t.startsWith(`${prefix} `);
  }
  const re = new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*")}$`);
  return re.test(t);
}

/** Split a shell command line into its subcommands (&&, ||, ;, |, newlines) and the commands inside $() and backticks. */
export function shellParts(command) {
  const parts = [];
  const text = String(command);
  // substitutions first
  for (const m of text.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) parts.push(...splitSimple(m[1] !== undefined ? m[1] : m[2]));
  parts.push(...splitSimple(text.replace(/\$\(([^()]*)\)/g, " ").replace(/`[^`]*`/g, " ")));
  return parts.map((p) => p.replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "").trim()).filter(Boolean);
}
const splitSimple = (s) => s.split(/&&|\|\||;|\||\r?\n/).map((x) => x.trim()).filter(Boolean);

/**
 * Does the `if` rule let this fixture through? Returns { runs, reason }.
 * Only the tool events evaluate `if`; on any other event a hook with `if` never runs (the reference).
 */
export function ifAllows(ifRule, event, input) {
  if (ifRule === undefined || ifRule === null) return { runs: true, reason: null };
  if (!TOOL_EVENTS.includes(event)) return { runs: false, reason: `"if" is only evaluated on tool events, so on ${event} this hook never runs` };
  const rule = parseRule(ifRule);
  if (!rule) return { runs: false, reason: `"if": ${JSON.stringify(ifRule)} is not a permission rule such as Bash(git *)` };
  const tool = input.tool_name;
  if (rule.tool !== tool) return { runs: false, reason: `"if" names ${rule.tool}, the call is ${tool}` };
  if (rule.content === undefined) return { runs: true, reason: null };
  const ti = input.tool_input || {};
  if (tool === "Bash" || tool === "PowerShell") {
    const cmd = String(ti.command || "");
    const parts = shellParts(cmd);
    if (parts.some((p) => patternMatches(rule.content, p))) return { runs: true, reason: null };
    const saysMore = /\s/.test(rule.content.replace(/:\*$/, "").replace(/\*$/, "").trim());
    if (saysMore && /\$\(|`|\$[A-Za-z_{]/.test(cmd)) return { runs: true, reason: `"if" says more than a command name and the command has a substitution or variable, so Claude Code runs the hook anyway` };
    return { runs: false, reason: `no subcommand of ${JSON.stringify(cmd)} matches ${ifRule}` };
  }
  if (tool === "Read" || tool === "Edit" || tool === "Write" || tool === "NotebookEdit") {
    const file = String(ti.file_path || ti.notebook_path || "");
    const rel = path.isAbsolute(file) && input.cwd ? path.relative(input.cwd, file).replace(/\\/g, "/") : file.replace(/\\/g, "/");
    const ok = globMatches(rule.content, rel) || globMatches(rule.content, file.replace(/\\/g, "/")) || globMatches(rule.content, path.basename(file));
    return ok ? { runs: true, reason: null } : { runs: false, reason: `${JSON.stringify(rel)} does not match ${ifRule}` };
  }
  if (tool === "WebFetch") {
    const url = String(ti.url || "");
    const m = /^domain:(.+)$/.exec(rule.content);
    let host = "";
    try { host = new URL(url).hostname; } catch { /* not a url */ }
    const ok = m ? host === m[1] || host.endsWith(`.${m[1]}`) : patternMatches(rule.content, url);
    return ok ? { runs: true, reason: null } : { runs: false, reason: `${url} does not match ${ifRule}` };
  }
  const text = typeof ti === "object" ? Object.values(ti).filter((v) => typeof v === "string").join(" ") : String(ti);
  return patternMatches(rule.content, text) ? { runs: true, reason: null } : { runs: false, reason: `the input does not match ${ifRule}` };
}

/** A path glob: ** crosses folders, * stays inside one; a pattern without a slash matches the base name. */
export function globMatches(pattern, text) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") { re += "[\\s\\S]*"; i++; if (pattern[i + 1] === "/") i++; }
      else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const anchored = new RegExp(`^${re}$`);
  if (anchored.test(text)) return true;
  if (!pattern.includes("/")) return anchored.test(path.posix.basename(text));
  return false;
}

/**
 * The fixture values a hook fires for: for a catch-all matcher the event's default values (every tool for a tool
 * event), for an exact list its values (also ones outside the known set, which get a plain fixture), for a
 * regex every known value that matches. Returns { values, kind, error, note }.
 */
export function valuesFor(hook, eventName, { allTools = false } = {}) {
  const event = eventByName(eventName);
  if (!event) return { values: [], kind: "none", error: null };
  if (!event.matcher) {
    const note = hook.matcher !== undefined && hook.matcher !== null && hook.matcher !== "" && hook.matcher !== "*" ? `${eventName} has no matcher support: the matcher ${JSON.stringify(hook.matcher)} is ignored` : null;
    return { values: [null], kind: "none", error: null, note };
  }
  const kind = matcherKind(hook.matcher, event);
  if (kind === "invalid") return { values: [], kind, error: "the matcher is not a string, so Claude Code never fires this hook" };
  // FileChanged's matcher is also its watch list: each |-separated segment is a literal file name
  if (eventName === "FileChanged" && kind !== "all") return { values: String(hook.matcher).split("|").map((s) => s.trim()).filter(Boolean), kind: "files", error: null };
  if (kind === "all") {
    const vals = TOOL_EVENTS.includes(eventName) && !allTools ? TOOL_NAMES : defaultValues(eventName);
    return { values: vals, kind, error: null };
  }
  if (kind === "exact") {
    const list = matcherList(hook.matcher, event);
    const known = candidateValues(event);
    const unknown = Array.isArray(event.values) ? list.filter((v) => !known.includes(v)) : [];
    const note = unknown.length ? `${unknown.map((u) => JSON.stringify(u)).join(", ")} ${unknown.length === 1 ? "is not a" : "are not"} documented ${event.matcher} value${unknown.length === 1 ? "" : "s"} for ${eventName} (${known.join(", ")}), so that part of the matcher never matches` : null;
    const values = Array.isArray(event.values) ? list.filter((v) => known.includes(v)) : list;
    return { values, kind, error: null, note, matchedByDefault: values.length === 0 ? false : undefined };
  }
  // regex: every known value that matches
  const known = candidateValues(event);
  const values = [];
  for (const v of known) {
    const r = matcherMatches(hook.matcher, v, event);
    if (r.error) return { values: [], kind, error: r.error };
    if (r.match) values.push(v);
  }
  const note = values.length ? null : `no known ${event.matcher} value matches the regular expression ${JSON.stringify(hook.matcher)}; use --input to run it with your own JSON`;
  return { values, kind, error: null, note };
}
