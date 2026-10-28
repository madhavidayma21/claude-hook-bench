# Roadmap

What could come next. None of it is promised; all of it is open to contributors. Comment on an issue or start a [discussion](https://github.com/nrzz/claude-hook-bench/discussions) before a large change.

- Hooks in skill and subagent frontmatter: list them with where they come from, and run them with the event's JSON, as the settings and plugin hooks are today.
- `trace on` and `trace off`: wrap every command hook in the settings file so each real call is logged with its input, output and duration, and put the file back byte for byte.
- Record fixtures from your own Claude Code: a `record` command that writes a hook on every event into a throwaway config, runs the binary against a fake API as the tests do, and saves what it sent, so the bench runs with your version's JSON rather than the one checked at release.
