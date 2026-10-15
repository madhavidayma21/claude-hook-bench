# Changelog

All notable changes to claude-hook-bench are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-16

- First release. `run` runs every command hook of a Claude Code setup (the managed, user, project and local settings files, the enabled plugins' `hooks/hooks.json`, and folders given with `--plugin-dir`) once per matching event value, with the JSON Claude Code sends for that event on stdin, from a throwaway session folder, and reports per run: did it run, exit code, time, stdout and stderr, whether the output is valid for the event, and what Claude Code would do with it (`denies`, `allows`, `asks`, `keeps Claude working`, `adds context`, `shows a message`, `silent`, `non-blocking error`, `timed out`, `cannot start`). `--command` and `--file` change the shell and file fixtures, `--input` sends your own JSON, `--event Event:value` and `--hook` pick a run, `--timeout` caps a run. `list` shows every hook with its source and the findings of the static checks. `explain` describes one hook (when it fires, how it runs, the exact JSON it gets, how its answer is read) or one event. `--json` everywhere, `--markdown` for the skill, `--fail-on error|warn` for a build.
- A plugin with one user-only skill, `/hook-bench:check`.
- The event table covers the 33 events of the hooks reference. The JSON for 17 of them was recorded from Claude Code 2.1.295 through its own binary and a fake API, and the fixtures pin the recorded keys, order and types; 86 hook outputs were put to the binary to see what it does with each, and the verdicts follow the binary where it and the reference differ (README "What was verified"). `test/e2e-claude.test.mjs` repeats the recording and 17 of the outputs against the binary; CI runs it on Linux and macOS with the newest npm release.

[1.0.0]: https://github.com/nrzz/claude-hook-bench/releases/tag/v1.0.0
