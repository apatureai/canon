import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CliIo } from "../src/index.js";
import { runCli } from "../src/index.js";

/** Repo root, so tests can run the CLI against the same `examples/` a reader does. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export interface CaptureResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the CLI exactly as `bin.ts` does, capturing both streams. */
export async function runCapture(argv: string[], cwd = REPO_ROOT): Promise<CaptureResult> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (text) => out.push(text), err: (text) => err.push(text), cwd };
  const code = await runCli(argv, io);
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

/** A throwaway directory tree described as `{ "relative/path": contents }`. */
export function makeTree(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "ui-dna-cli-"));
  for (const [relative, contents] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
