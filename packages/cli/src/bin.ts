#!/usr/bin/env node
import { runCli } from "./cli.js";

/**
 * Process entry point: the only place in the repo that touches `process`.
 * Everything it does is hand argv and two sinks to `runCli` and set the exit
 * code it returns.
 */
// A downstream reader that stops early (`ui-dna tokens x.json | head`) closes the
// pipe under us. That is a normal way to read a report, not a failure worth a
// stack trace: stop writing and exit cleanly.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
}

const code = await runCli(process.argv.slice(2), {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  cwd: process.cwd(),
});
process.exitCode = code;
