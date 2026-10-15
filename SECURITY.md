# Security policy

## Supported versions

Security fixes go into the latest release on `main`.

## Reporting a vulnerability

Please do not report a vulnerability in a public issue. Use GitHub's private reporting: [https://github.com/nrzz/claude-hook-bench/security/advisories/new](https://github.com/nrzz/claude-hook-bench/security/advisories/new), or the contact in the [nrzz security policy](https://github.com/nrzz/.github/blob/master/SECURITY.md). You can expect a first answer within 72 hours, and credit in the release notes if you want it.

## What this tool does, and does not do

It reads the Claude Code settings files that apply to a project (`managed-settings.json`, the user `settings.json`, the project's `.claude/settings.json` and `.claude/settings.local.json`), the list of installed plugins under the Claude config folder (`$CLAUDE_CONFIG_DIR` or `~/.claude`) and each enabled plugin's `hooks/hooks.json`. It opens no network connection and has no telemetry or account.

`run` executes your command hooks. They are your own scripts, run with your own account, in your project folder, with the JSON of a made-up session on stdin: a hook that deletes files, sends a message or pushes a branch when it runs will do that in the bench too. Read a hook before you bench it, and use `--hook`, `--event` or `--input` to run one at a time. The bench writes only a throwaway session folder under the system temp folder (a synthetic transcript, an empty file for `CLAUDE_ENV_FILE`), which it removes afterwards unless `--keep` is given; it never edits a settings file, a plugin or a hook script. `http`, `mcp_tool`, `prompt` and `agent` hooks are listed and checked, never run.

The verdicts are a reading of how Claude Code treats a hook's answer, checked against the binary as the README's "What was verified" describes; they are a prediction, not a guard. A hook that passes the bench is not thereby safe, and a hook the bench calls a block is not a security control: Claude Code's own permission rules are.
