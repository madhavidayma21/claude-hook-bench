// A hook for the real-binary checks: appends what Claude Code sent (stdin JSON, the CLAUDE_* environment, cwd)
// as one line to the file named by HB_LOG, then prints HB_STDOUT, writes HB_STDERR and exits HB_EXIT.
import fs from "node:fs";

// `node --test` also runs every file under test/: without HB_LOG this is not a hook run, so do nothing (reading stdin would block)
if (!process.env.HB_LOG) process.exit(0);

const label = process.argv[2] || "";
let raw = "";
try { raw = fs.readFileSync(0, "utf8"); } catch { raw = ""; }
let input = null;
try { input = JSON.parse(raw); } catch { input = { unparsed: raw }; }
const env = {};
for (const [k, v] of Object.entries(process.env)) if (/^CLAUDE/.test(k)) env[k] = v;
if (process.env.HB_LOG) fs.appendFileSync(process.env.HB_LOG, `${JSON.stringify({ label, at: Date.now(), cwd: process.cwd(), env, input })}\n`);
if (process.env.HB_STDOUT) process.stdout.write(process.env.HB_STDOUT);
if (process.env.HB_STDERR) process.stderr.write(process.env.HB_STDERR);
process.exit(Number(process.env.HB_EXIT || 0));
