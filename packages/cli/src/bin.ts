#!/usr/bin/env node
import { runCli } from "./cli.js";

/**
 * Process entry point: the only place in the repo that touches `process`.
 * Everything it does is hand argv and two sinks to `runCli` and set the exit
 * code it returns.
 */
const code = await runCli(process.argv.slice(2), {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  cwd: process.cwd(),
});
process.exitCode = code;
