# Contributing to claude-hook-bench

Thanks for helping. claude-hook-bench is a CLI and a Claude Code plugin with one user-only skill, part of the [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit). The bar for a change is the bar the code already meets: it works on Windows, macOS and Linux, it is tested, and it never wastes anyone's tokens.

## Start here

- **Good first issues:** [the issues labelled good first issue](https://github.com/nrzz/claude-hook-bench/issues?q=is%3Aopen+label%3A%22good+first+issue%22), and the ideas in [ROADMAP.md](ROADMAP.md).
- **Questions and ideas:** [Discussions](https://github.com/nrzz/claude-hook-bench/discussions).
- **Bugs:** [open an issue](https://github.com/nrzz/claude-hook-bench/issues/new/choose) with the Claude Code version (`claude --version`), your OS, `node --version`, and the exact command and output. For a wrong verdict, add the hook entry and what it printed; that pair is the test case.

## Set up

There is nothing to install: the project has no dependencies.

```bash
git clone https://github.com/nrzz/claude-hook-bench
cd claude-hook-bench
npm test
```

- `node bin/claude-hook-bench.mjs list --project <a project>` shows the hooks it finds there; `run` runs them.
- `E2E_CLAUDE=claude node --test test/e2e-claude.test.mjs` also puts the fixtures and a table of hook outputs to the real Claude Code binary (see below).

## Where things are

| Path | What it holds |
| --- | --- |
| `bin/claude-hook-bench.mjs` | the CLI |
| `src/events.mjs` | the table of events: matcher field and values, handler types, timeouts, exit-code rules, output fields and their types |
| `src/fixtures.mjs` | the JSON for each event and tool, in the shape Claude Code sends |
| `src/settings.mjs`, `src/matcher.mjs`, `src/check.mjs` | finding the hooks, matchers and `if` rules, the static checks |
| `src/runner.mjs`, `src/output.mjs` | the only file that starts a process; how an output is parsed, validated and judged |
| `src/bench.mjs`, `src/report.mjs`, `src/cli.mjs` | the three commands as objects, the reports, the options |
| `test/*.test.mjs` | unit tests; `e2e-claude.test.mjs` runs against the real binary when `E2E_CLAUDE` is set |

## House rules

1. **No dependencies.** Node built-ins only, Node 18 or newer, ES modules (`.mjs`). A pull request that adds a package to `dependencies` will not be merged. Only `src/runner.mjs` may start a process, and only `src/http.mjs` may open a network connection (the opt-in `run --http`); a test fails otherwise.
2. **Every change comes with a test**, and `npm test` passes. CI runs the suite on Windows, macOS and Linux with Node 20, 22 and 24, and on Linux with Node 18, and the real-binary checks on Linux and macOS; a change that only works on one of them is not done.
3. **The binary is right.** The fixtures and the verdicts describe what Claude Code does. When they are wrong, add the case to `test/e2e-claude.test.mjs` (a fixture oracle row or an output oracle row) with what the binary does, fix the table, and say so in the README's "What was verified". Do not change a row to make a test pass without running it against the binary.
4. **Token cost is a feature.** It runs outside Claude; the optional skill is user-only and its report is capped. If your change puts anything new in front of Claude, say how many tokens in the pull request and update the README's "What it costs in tokens".
5. **Never touch real user data in tests.** Use a temporary folder and point `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` at it, in the same command, whenever you run this tool, `claude` or anything else that reads them. `test/helpers.mjs` points every way the tool finds a config folder at a throwaway one the moment it loads.
6. **The hooks are the user's.** The bench runs them; it never edits a settings file, a plugin or a hook script.
7. **Keep the README honest.** Its "What was verified, and how" section says what was checked and what was not. If your change affects either, update it in the same pull request.

## The real-binary checks

`test/e2e-claude.test.mjs` starts a fake Messages API on 127.0.0.1 and runs the real Claude Code binary against it: a recording hook on every event a `-p` run fires shows what the binary sends, which must match the bench's fixtures key for key; a table of hook outputs is printed by a `PreToolUse` hook, and whether the binary then runs or refuses the tool call must match the bench's verdict. No model is reached and nothing leaves your machine; every run has its own throwaway `HOME`, `USERPROFILE` and `CLAUDE_CONFIG_DIR`.

```bash
E2E_CLAUDE=/path/to/claude node --test test/e2e-claude.test.mjs
```

## Pull requests

- One logical change per pull request, with its test. Commit messages in the imperative mood ("Add the Notification title to the fixture").
- Fill in the pull request template; CI must be green on every job.
- Signed commits are welcome but not required.
- Plain, specific writing in docs, messages and comments.

## Releases (maintainers)

Bump the version in `src/version.mjs`, `package.json` and `.claude-plugin/plugin.json` (`npm test` fails until every copy agrees), add a section to [CHANGELOG.md](CHANGELOG.md), tag `vX.Y.Z` and publish a GitHub release with the changelog section as its notes.

## Conduct and security

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as [SECURITY.md](SECURITY.md) describes, never in a public issue.
