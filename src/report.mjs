// Plain-text, markdown and JSON reports. Text goes to a terminal (colored when it is one), markdown is what the
// skill hands to Claude (capped), JSON is for other tools.
import { blocksOnExit2, eventByName, matcherKind } from "./events.mjs";
import { VERSION } from "./version.mjs";

export const palette = (on) => {
  const c = (code) => (s) => (on ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return { red: c(31), green: c(32), yellow: c(33), blue: c(36), dim: c(2), bold: c(1) };
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const trunc = (s, n) => { const t = String(s ?? ""); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);

const TONE = { block: "red", stop: "red", continue: "yellow", ask: "yellow", defer: "yellow", allow: "green", context: "blue", message: "blue", replace: "blue", silent: "dim", error: "red", cancelled: "red", ignored: "yellow" };

function header(m, p, what) {
  const out = [`${p.bold(`claude-hook-bench ${VERSION}`)}  ${what}`];
  out.push(`project   ${m.project}`);
  out.push(`config    ${m.configDir}  ${m.configSource === "CLAUDE_CONFIG_DIR" ? "(from CLAUDE_CONFIG_DIR)" : "(the default; CLAUDE_CONFIG_DIR is not set)"}`);
  return out;
}

function sources(m, p) {
  const out = ["", "Hook sources (managed, local, project and user settings, then enabled plugins)"];
  const w = Math.max(10, ...m.files.map((f) => f.display.length));
  for (const f of m.files) {
    const state = !f.exists ? p.dim("not found") : f.error ? p.red(f.error) : f.hooks ? plural(f.hooks, "hook") : p.dim("no hooks");
    out.push(`  ${f.scope.padEnd(8)} ${f.display.padEnd(w)}  ${state}`);
  }
  for (const pl of m.plugins) {
    const state = pl.missing ? p.red("enabled, install folder missing") : !pl.enabled ? p.dim("disabled") : pl.hooks ? plural(pl.hooks, "hook") : p.dim("no hooks");
    out.push(`  ${"plugin".padEnd(8)} ${`${pl.id}${pl.version ? ` ${pl.version}` : ""}`.padEnd(w)}  ${state}`);
  }
  if (m.disableAllHooks && m.disableAllHooks.value) out.push(p.red(`  disableAllHooks is true (${m.disableAllHooks.scope} settings): Claude Code runs none of these`));
  if (m.allowManagedHooksOnly) out.push(p.red("  allowManagedHooksOnly is set in managed settings: only managed hooks run"));
  return out;
}

const findingLine = (f, p) => `      ${f.severity === "error" ? p.red("error") : f.severity === "warn" ? p.yellow("warn ") : p.dim("note ")} ${f.message}`;

function hookLine(h, p) {
  const m = h.matcher === null || h.matcher === undefined || h.matcher === "" || h.matcher === "*" ? p.dim("(every)") : JSON.stringify(h.matcher);
  const where = `${h.plugin ? `plugin ${h.plugin}` : h.scope}${h.line ? `, ${h.display}:${h.line}` : h.scope === "plugin" ? "" : `, ${h.display}`}`;
  return `  ${p.bold(`#${h.n}`)} ${p.bold(h.event)} ${m}  ${h.type || p.red("no type")}  ${trunc(oneLine(h.handler), 90)}\n      ${p.dim(where)}${h.if ? `  if ${h.if}` : ""}${h.async ? "  async" : ""}  timeout ${h.timeout}s${h.timeoutDefault ? p.dim(" (default)") : ""}${h.onFailure === "block" ? "  onFailure block" : ""}`;
}

export function renderList(m, { color = false } = {}) {
  const p = palette(color);
  const out = header(m, p, "the hooks Claude Code would run here");
  out.push(...sources(m, p));
  if (!m.hooks.length) {
    out.push("", m.total ? "No hook matches the filter." : "No hooks found. Claude Code reads hooks from settings.json files and from enabled plugins' hooks/hooks.json.");
  }
  let lastEvent = null;
  for (const h of m.hooks) {
    if (h.event !== lastEvent) { out.push(""); lastEvent = h.event; }
    out.push(hookLine(h, p));
    for (const f of h.findings) out.push(findingLine(f, p));
  }
  if (m.notes.length) { out.push(""); for (const n of m.notes) out.push(`${n.severity === "error" ? p.red("error") : p.yellow("note")}  ${n.message}`); }
  out.push("", `${plural(m.summary.hooks, "hook")} on ${plural(m.summary.events.length, "event")}; ${plural(m.summary.errors, "error")}, ${plural(m.summary.warns, "warning")}`);
  out.push("", "Not read by this tool: hooks in skill and subagent frontmatter, hooks added for the session, and server-managed settings.");
  return `${out.join("\n")}\n`;
}

function verdictWord(r, p) {
  if (r.skipped) return p.dim("skipped");
  const v = r.verdict;
  const tone = TONE[v.outcome] || "dim";
  return p[tone](v.verdict);
}

export function renderRun(m, { color = false, verbose = false } = {}) {
  const p = palette(color);
  const out = header(m, p, "every hook, run with its event's JSON");
  out.push(...sources(m, p));
  if (m.custom) out.push("", `Input: your JSON for ${m.custom.event}`);
  const byHook = new Map();
  for (const r of m.runs) { if (!byHook.has(r.hook)) byHook.set(r.hook, []); byHook.get(r.hook).push(r); }
  for (const h of m.hooks) {
    const runs = byHook.get(h.n) || [];
    out.push("", hookLine(h, p));
    for (const f of h.findings) out.push(findingLine(f, p));
    for (const r of runs) {
      const label = r.label ? `${h.event}:${r.label}` : h.event;
      if (r.skipped) { out.push(`      ${p.dim(label.padEnd(28))} ${p.dim("skipped")}  ${r.skipped}`); continue; }
      const run = r.run;
      const how = run.status === "ran" ? `exit ${run.exitCode}, ${ms(run.ms)}` : run.status === "timed-out" ? `no answer in ${ms(run.timeoutMs)}` : "did not start";
      out.push(`      ${label.padEnd(28)} ${verdictWord(r, p)}  ${p.dim(`(${how})`)}${r.verified === "docs" ? p.dim("  [input from the docs]") : r.verified === "none" ? p.dim("  [no realistic input]") : ""}`);
      for (const e of r.verdict.effects) out.push(`          ${e}`);
      for (const pr of r.verdict.problems) out.push(`          ${p.red("problem")}  ${pr}`);
      for (const w of r.verdict.warnings) out.push(`          ${p.yellow("warn")}     ${w}`);
      if (r.ifNote) out.push(`          ${p.dim(`if: ${r.ifNote}`)}`);
      if (r.note) out.push(`          ${p.dim(r.note)}`);
      if (r.matcherNote) out.push(`          ${p.yellow("warn")}     ${r.matcherNote}`);
      const show = (name, text) => {
        if (!text || !text.trim()) return;
        const lines = text.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
        const keep = verbose ? lines : lines.slice(0, 4);
        out.push(`          ${p.dim(name)}${lines.length > keep.length ? p.dim(` (${lines.length} lines, first ${keep.length})`) : ""}`);
        for (const l of keep) out.push(`            ${verbose ? l : trunc(l, 160)}`);
      };
      show("stdout:", run.stdout);
      show("stderr:", run.stderr);
      if (r.envFile) show("CLAUDE_ENV_FILE:", r.envFile);
    }
  }
  if (m.notes.length) { out.push(""); for (const n of m.notes) out.push(`${n.severity === "error" ? p.red("error") : p.yellow("note")}  ${n.message}`); }
  const s = m.summary;
  const counts = Object.entries(s.outcomes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${OUTCOME_WORDS[k] || k}`).join(", ");
  out.push("", `${plural(s.runs, "run")} of ${plural(s.hooks, "hook")}${s.skipped ? `, ${s.skipped} skipped` : ""}${counts ? `: ${counts}` : ""}`);
  out.push(`${plural(s.problems, "problem")}, ${plural(s.warnings, "warning")}${s.problems ? "" : p.green("  (every hook ran clean)")}`);
  return `${out.join("\n")}\n`;
}

const OUTCOME_WORDS = { block: "block", allow: "allow", ask: "ask", defer: "defer", continue: "keep Claude working", stop: "stop Claude", context: "add context", message: "show a message", replace: "replace something", silent: "stay silent", error: "fail", ignored: "have no effect", cancelled: "time out" };

export function renderExplain(m, { color = false } = {}) {
  const p = palette(color);
  if (m.kind === "event") return renderExplainEvent(m, p);
  if (m.matches !== undefined) {
    const out = [`${p.bold(`claude-hook-bench ${VERSION}`)}  explain`];
    out.push(m.matches === 0 ? `No hook matches. ${m.total ? `Pick one of the ${m.total} by number (#1 to #${m.total}) or by a unique part of its command, or name an event (PreToolUse, Stop ...).` : "There are no hooks in this setup."}` : `${m.matches} hooks match; give a number instead:`);
    if (m.matches > 1) for (const h of m.hooks) out.push(hookLine(h, p));
    return `${out.join("\n")}\n`;
  }
  const h = m.hook;
  const e = m.event;
  const out = header(m, p, `hook #${h.n}`);
  out.push("", hookLine(h, p));
  for (const f of h.findings) out.push(findingLine(f, p));
  out.push("", `Defined in ${h.plugin ? `the plugin ${h.plugin} (${h.file})` : `${h.source} (${h.file}${h.line ? `, line ${h.line}` : ""})`}.`);
  if (!e) { out.push(`"${h.event}" is not an event Claude Code fires, so this hook never runs.`); return `${out.join("\n")}\n`; }
  out.push("", `${p.bold("When it fires")}  ${e.name}: ${e.when}.`);
  if (e.matcher) {
    const kind = matcherKind(h.matcher, e);
    const how = kind === "all" ? `every ${e.matcher}` : kind === "exact" ? `exactly ${m.values.values.map((v) => JSON.stringify(v)).join(" or ")}` : kind === "regex" ? `any ${e.matcher} the regular expression ${JSON.stringify(h.matcher)} matches` : "nothing (the matcher is not a string)";
    out.push(`  The matcher is tested against ${e.matcher}: ${how}.`);
    if (m.values.note) out.push(`  ${p.yellow(m.values.note)}`);
  } else out.push("  The event has no matcher: the hook runs every time.");
  if (h.if) out.push(`  if ${h.if}: ${/^(Pre|Post|Permission)/.test(e.name) ? "the hook runs only when the tool call matches this rule (best effort, as in Claude Code)" : p.red("never runs: \"if\" is only evaluated on tool events")}.`);
  out.push("", `${p.bold("How it runs")}  ${h.type} hook${h.type === "command" ? m.plan && m.plan.form === "exec" ? ` in exec form: ${m.plan.file} is spawned directly with ${h.raw.args.length} argument(s), no shell` : ` in shell form through ${m.plan ? m.plan.shell : "a shell"}` : ""}; timeout ${h.timeout} s${h.timeoutDefault ? " (the default for this event and type)" : ""}${h.async ? "; async, so it cannot block" : ""}.`);
  if (m.plan && m.plan.form === "exec" && !m.plan.resolved) out.push(`  ${p.red(`${m.plan.file} was not found, so the hook cannot start.`)}`);
  out.push("", `${p.bold("What Claude Code sends it")}  (stdin, one JSON object)${m.fixtures.length > 1 ? `, one run per matcher value: ${m.fixtures.map((f) => f.label).join(", ")}` : ""}`);
  if (m.fixtures[0]) out.push(...JSON.stringify(m.fixtures[0].input, null, 2).split("\n").map((l) => `  ${l}`));
  out.push(`  ${p.dim(e.verified === "recorded" ? "This shape was recorded from Claude Code 2.1.295." : "This shape follows the hooks reference; it was not recorded from the binary.")}`);
  out.push("", `${p.bold("What Claude Code does with its answer")}`);
  out.push(`  exit 0, nothing printed: ${["Stop", "SubagentStop"].includes(e.name) ? "Claude stops as usual" : blocksOnExit2(e) ? "no decision, the normal flow applies" : "nothing"}.`);
  out.push(`  exit 2: ${blocksOnExit2(e) ? `blocks (${e.name === "Stop" || e.name === "SubagentStop" ? "keeps Claude working" : "stops the action"}); stderr is the reason` : e.exit2}.`);
  out.push(`  any other exit code: a non-blocking error (the action goes ahead${h.onFailure === "block" ? `; here onFailure "block" turns it into a block` : "; onFailure \"block\" would turn it into a block"}); a hook error notice names the first line of stderr.`);
  out.push(`  plain stdout on exit 0: ${e.plainStdout === "context" ? "added to Claude's context" : e.plainStdout === "path" ? "the last non-empty line is the worktree path" : "written to the debug log only"}.`);
  const fields = Object.entries(e.fields);
  out.push(`  JSON on stdout: ${fields.length ? `hookSpecificOutput may hold ${fields.map(([k, t]) => `${k} (${t.replace("enum:", "")})`).join(", ")}` : "hookSpecificOutput has no fields for this event"}${e.decision ? `; a top-level "decision": "block" ${e.decision}` : ""}.`);
  out.push(`  continue: false ${e.continue ? e.continue : p.yellow("is discarded on this event")}; systemMessage ${e.systemMessage ? e.systemMessage : p.yellow("is discarded on this event")}.`);
  out.push("  A field of the wrong type anywhere makes Claude Code drop the whole output (nothing applied, a non-blocking error); a key hookSpecificOutput does not know for this event is ignored.");
  for (const n of e.notes || []) out.push(`  ${n}`);
  out.push("", `Run it: claude-hook-bench run --hook ${h.n}`);
  return `${out.join("\n")}\n`;
}

function renderExplainEvent(m, p) {
  const e = m.event;
  const out = [`${p.bold(`claude-hook-bench ${VERSION}`)}  ${p.bold(e.name)}: ${e.when}`];
  out.push("", `Matcher: ${e.matcher ? `tested against ${e.matcher}${Array.isArray(e.values) ? `; documented values: ${e.values.join(", ")}` : " (any value)"}` : "none; the hook runs every time"}.`);
  out.push(`Handler types: ${e.types.join(", ")}. Default timeout: ${e.timeout} s${e.name === "SessionEnd" ? " (a shared budget)" : ""}.`);
  out.push(`Exit 2: ${blocksOnExit2(e) ? "blocks" : e.exit2}. Plain stdout: ${e.plainStdout === "context" ? "reaches Claude as context" : e.plainStdout === "path" ? "the worktree path" : "debug log only"}.`);
  const fields = Object.entries(e.fields);
  out.push(`JSON fields: ${fields.length ? fields.map(([k, t]) => `${k} (${t.replace("enum:", "")})`).join(", ") : "none in hookSpecificOutput"}${e.decision ? `; decision "block" ${e.decision}` : ""}.`);
  out.push(`continue: false ${e.continue || "is discarded"}; systemMessage ${e.systemMessage || "is discarded"}.`);
  for (const n of e.notes || []) out.push(n);
  out.push("", `What a hook receives (${e.verified === "recorded" ? "recorded from Claude Code 2.1.295" : "from the hooks reference"}):`);
  if (m.sample) out.push(...JSON.stringify(m.sample, null, 2).split("\n").map((l) => `  ${l}`));
  return `${out.join("\n")}\n`;
}

/** The markdown report the skill hands to Claude: capped at about 60 lines. */
export function markdownRun(m) {
  const out = [`## hook-bench: ${m.summary.runs} runs of ${m.summary.hooks} hooks in ${m.project}`, ""];
  if (!m.hooks.length) { out.push("No hooks found in the settings files or enabled plugins."); return `${out.join("\n")}\n`; }
  out.push("| # | hook | event | verdict | exit | time | problems |", "| --- | --- | --- | --- | --- | --- | --- |");
  const byHook = new Map();
  for (const r of m.runs) { if (!byHook.has(r.hook)) byHook.set(r.hook, []); byHook.get(r.hook).push(r); }
  let rows = 0;
  for (const h of m.hooks) {
    const runs = byHook.get(h.n) || [];
    const errs = h.findings.filter((f) => f.severity === "error").map((f) => f.message);
    if (!runs.length) { out.push(`| ${h.n} | \`${trunc(oneLine(h.handler), 40)}\` | ${h.event} | not run | | | ${trunc(errs.join("; "), 120)} |`); rows++; continue; }
    for (const r of runs) {
      if (rows >= 40) break;
      const label = r.label ? `${h.event}:${r.label}` : h.event;
      if (r.skipped) { out.push(`| ${h.n} | \`${trunc(oneLine(h.handler), 40)}\` | ${label} | skipped | | | ${trunc(r.skipped, 120)} |`); rows++; continue; }
      const probs = [...errs, ...r.verdict.problems];
      out.push(`| ${h.n} | \`${trunc(oneLine(h.handler), 40)}\` | ${label} | ${r.verdict.verdict} | ${r.run.status === "ran" ? r.run.exitCode : r.run.status} | ${ms(r.run.ms)} | ${trunc(probs.join("; "), 160)} |`);
      rows++;
    }
  }
  if (rows >= 40) out.push("", `(${m.runs.length - rows} more runs not shown; run \`claude-hook-bench run\` in a terminal for all of them)`);
  out.push("", `${plural(m.summary.problems, "problem")}, ${plural(m.summary.warnings, "warning")}.`);
  const words = Object.entries(m.summary.outcomes).map(([k, v]) => `${v} ${OUTCOME_WORDS[k] || k}`);
  if (words.length) out.push(`Verdicts: ${words.join(", ")}.`);
  return `${out.join("\n")}\n`;
}

/** Strip what JSON output does not need (raw handlers stay). */
export function toJson(m) {
  return JSON.stringify(m, (k, v) => (k === "duplicateOf" && v && typeof v === "object" ? v.n : v), 2);
}
