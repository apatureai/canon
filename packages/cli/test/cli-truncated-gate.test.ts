import { describe, expect, it } from "vitest";
import { EXIT_OK, EXIT_STRICT } from "../src/index.js";
import { makeTree, runCapture } from "./helpers.js";
import { scanProject } from "../src/scan.js";

/**
 * `--strict` is the documented CI gate. It used to exit 0 on any repository big
 * enough to trip the default 5,000-file walk, printing
 *
 *   conflicts (0)
 *     (none: no two sources declared the same token with different values)
 *
 * over real conflicts the walk never reached. The gate passed because the scan
 * ran out of budget, which is a result that reads as verified when the check did
 * not finish.
 *
 * These tests build a tree whose only two token files sort AFTER the filler, so
 * a bounded walk provably never opens them, and pin both halves of the fix: the
 * report must say it did not finish, and `--strict` must refuse to call it
 * clean.
 */

const CONFLICTING_A = JSON.stringify({
  space: {
    md: { $type: "dimension", $value: { value: 8, unit: "px" } },
    lg: { $type: "dimension", $value: { value: 24, unit: "px" } },
  },
});

const CONFLICTING_B = JSON.stringify({
  space: {
    md: { $type: "dimension", $value: { value: 16, unit: "px" } },
    lg: { $type: "dimension", $value: { value: 32, unit: "px" } },
  },
});

/**
 * `filler` files under `aaa/`, then two disagreeing token files under `zzz/`.
 * The walk sorts entries, so any file-count bound at or below `filler` stops
 * before `zzz/` and sees neither conflict.
 */
function conflictTreeBehindFiller(filler: number): { root: string; cleanup: () => void } {
  const files: Record<string, string> = {
    "zzz/a.tokens.json": CONFLICTING_A,
    "zzz/b.tokens.json": CONFLICTING_B,
  };
  for (let i = 0; i < filler; i += 1) {
    files[`aaa/f${String(i).padStart(5, "0")}.txt`] = "x";
  }
  return makeTree(files);
}

describe("a truncated walk can never pass --strict", () => {
  it("exits 2 and says why, where it used to exit 0 over two unreached conflicts", async () => {
    const tree = conflictTreeBehindFiller(40);
    try {
      const truncated = await runCapture(["context", tree.root, "--strict", "--max-files", "20"]);

      // The regression: this was EXIT_OK.
      expect(truncated.code).toBe(EXIT_STRICT);
      expect(truncated.stderr).toContain("--strict: the walk did not finish");
      expect(truncated.stderr).toContain("file-count bound (--max-files 20) reached");
      expect(truncated.stderr).toContain("not a clean result");

      // And the conflicts really were there to be found.
      const complete = await runCapture(["context", tree.root, "--strict", "--max-files", "1000"]);
      expect(complete.code).toBe(EXIT_STRICT);
      expect(complete.stdout).toContain("conflicts (2)");
      expect(complete.stdout).not.toContain("walk truncated");
      expect(complete.stderr).not.toContain("did not finish");
    } finally {
      tree.cleanup();
    }
  });

  it("never claims 'no two sources declared the same token with different values'", async () => {
    const tree = conflictTreeBehindFiller(40);
    try {
      const result = await runCapture(["context", tree.root, "--max-files", "20"]);

      expect(result.stdout).toContain("conflicts (0)");
      // The old gloss is a claim about the whole repository, made off a walk
      // that stopped early. It must not appear on a truncated scan.
      expect(result.stdout).not.toContain("(none: no two sources declared the same token with different values)");
      expect(result.stdout).toContain("none among the sources reached before the walk was truncated");
    } finally {
      tree.cleanup();
    }
  });

  it("says it did not finish before any count, not only in a footnote", async () => {
    const tree = conflictTreeBehindFiller(40);
    try {
      const result = await runCapture(["context", tree.root, "--max-files", "20"]);
      const lines = result.stdout.split("\n");

      const banner = lines.findIndex((line) => line.startsWith("walk truncated"));
      const firstCount = lines.findIndex((line) => line.startsWith("sources ("));
      expect(banner).toBeGreaterThanOrEqual(0);
      expect(banner).toBeLessThan(firstCount);

      // Every count that a truncated walk under-reports carries the qualifier.
      for (const heading of ["sources (", "resolved tokens (", "conflicts (", "token diagnostics ("]) {
        const line = lines.find((l) => l.startsWith(heading));
        expect(line, heading).toBeDefined();
        expect(line, heading).toContain("[INCOMPLETE:");
      }
    } finally {
      tree.cleanup();
    }
  });

  it("distinguishes 'nothing to find' from 'I stopped looking'", async () => {
    const empty = makeTree({ "notes.md": "no design system here" });
    const stopped = conflictTreeBehindFiller(40);
    try {
      const nothingToFind = await runCapture(["context", empty.root, "--strict"]);
      expect(nothingToFind.code).toBe(EXIT_OK);
      expect(nothingToFind.stdout).toContain("(none: walked 1 file and none of them was a");
      expect(nothingToFind.stdout).not.toContain("walk truncated");

      const stoppedLooking = await runCapture(["context", stopped.root, "--strict", "--max-files", "20"]);
      expect(stoppedLooking.code).toBe(EXIT_STRICT);
      expect(stoppedLooking.stdout).toContain("(none reached: the walk stopped after 20 files without");
    } finally {
      empty.cleanup();
      stopped.cleanup();
    }
  });

  it("gates on a depth bound too, not only a file-count bound", async () => {
    const tree = makeTree({
      "a/b/c/deep.tokens.json": CONFLICTING_A,
      "shallow.css": ":root { --color-ink: #101010; }",
    });
    try {
      const result = await runCapture(["context", tree.root, "--strict", "--max-depth", "1"]);
      expect(result.code).toBe(EXIT_STRICT);
      expect(result.stderr).toContain("depth bound (--max-depth 1) reached");

      const complete = await runCapture(["context", tree.root, "--strict", "--max-depth", "8"]);
      expect(complete.code).toBe(EXIT_OK);
      expect(complete.stdout).not.toContain("walk truncated");
    } finally {
      tree.cleanup();
    }
  });

  it("reports the truncation, and its reasons, in --json", async () => {
    const tree = conflictTreeBehindFiller(40);
    try {
      const result = await runCapture(["context", tree.root, "--json", "--max-files", "20"]);
      const report = JSON.parse(result.stdout) as {
        truncated: boolean;
        truncationReasons: string[];
        conflicts: unknown[];
      };
      expect(report.truncated).toBe(true);
      expect(report.truncationReasons).toEqual(["file-count bound (--max-files 20) reached"]);
      expect(report.conflicts).toHaveLength(0);
    } finally {
      tree.cleanup();
    }
  });

  it("leaves truncationReasons empty exactly when the walk finished", async () => {
    const tree = conflictTreeBehindFiller(40);
    try {
      const complete = await scanProject(tree.root, { maxFiles: 1000 });
      expect(complete.truncated).toBe(false);
      expect(complete.truncationReasons).toEqual([]);

      const stopped = await scanProject(tree.root, { maxFiles: 20 });
      expect(stopped.truncated).toBe(true);
      expect(stopped.truncationReasons).toEqual(["file-count bound (--max-files 20) reached"]);
      expect(stopped.filesWalked).toBe(20);
    } finally {
      tree.cleanup();
    }
  });
});
