#!/usr/bin/env node
// claude-hook-bench: run every hook of a Claude Code setup with the JSON Claude Code sends, and see what each
// one would do. All the work lives in src/cli.mjs; run `claude-hook-bench --help`.
import { main } from "../src/cli.mjs";

// `claude-hook-bench list | head` closes the pipe early: that is not an error.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

process.exitCode = await main(process.argv.slice(2));
