---
name: check
description: Run every hook and report what each does.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/claude-hook-bench.mjs" *) Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/claude-hook-bench.mjs *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/claude-hook-bench.mjs" run --project "${CLAUDE_PROJECT_DIR}" --markdown`

The table above is from claude-hook-bench: every command hook of this setup was run once per matching event value with the JSON Claude Code sends, in a throwaway session folder. In at most 10 lines: the hooks that fail or time out (with the problem column's reason), the hooks whose output Claude Code would drop (invalid JSON, a wrong type, a misplaced field), and whether any hook blocks on its fixture. A silent hook is fine. Change nothing until the user agrees.
