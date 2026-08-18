import { describe, expect, it } from "vitest";
import { EXIT_OK, EXIT_STRICT } from "../src/index.js";
import { makeTree, runCapture } from "./helpers.js";

/**
 * A walk has two ways of not examining a design system, and until now it only
 * admitted to one of them.
 *
 * A bound can stop the walk before the end of the tree. That case is handled:
 * banner, `[INCOMPLETE: ...]` on every count, no bare `(none)`, `--strict`
 * exit 2 (`cli-truncated-gate.test.ts`, `cli-truncated-report.test.ts`).
 *
 * Or the walk can reach a candidate design source, open it, and fail to parse
 * it. Nothing in `skipped` was ever handed to a resolver, so it raises no
 * diagnostic and joins no conflict, and the report said nothing about that at
 * all. A repository whose only token file was malformed printed
 *
 *   token diagnostics (0)
 *     (none)
 *
 *   conflicts (0)
 *     (none: no two sources declared the same token with different values)
 *
 * and exited 0 under `--strict`. That is the truncation bug with a different
 * hole in the walk: a result that reads as verified when nothing verified it.
 *
 * These tests pin both halves, and pin the mirror image too - a scan that
 * refused nothing must carry none of this, or the qualifier is decoration
 * rather than a claim about the run.
 */

const BRAND_DARK = JSON.stringify({
  color: { brand: { $type: "color", $value: { colorSpace: "srgb", components: [0.1, 0.1, 0.1] } } },
});

const BRAND_LIGHT = JSON.stringify({
  color: { brand: { $type: "color", $value: { colorSpace: "srgb", components: [0.9, 0.9, 0.9] } } },
});

/**
 * `a.tokens.json` declares `color.brand`; `b.tokens.json` declares it again
 * with a different value. `readable` decides whether the second file is valid
 * JSON, so the same tree can be run with the disagreement visible and with it
 * behind a parse failure. That is what makes `conflicts (0)` in the broken run
 * a false negative rather than a wording quibble.
 */
function conflictBehindAParseError(readable: boolean): { root: string; cleanup: () => void } {
  return makeTree({
    "a.tokens.json": BRAND_DARK,
    "b.tokens.json": readable ? BRAND_LIGHT : `${BRAND_LIGHT.slice(0, 30)}`,
  });
}

/** Every top-level heading in the report that states a count. */
function countHeadings(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => /^\S/.test(line) && /\(\d+/.test(line) && !line.startsWith("walk truncated"));
}

describe("a scan that refused a design source can never pass --strict", () => {
  it("exits 2, where it used to exit 0 over a conflict it could not read", async () => {
    const broken = conflictBehindAParseError(false);
    const whole = conflictBehindAParseError(true);
    try {
      const result = await runCapture(["context", broken.root, "--strict"]);

      // The regression: this was EXIT_OK.
      expect(result.code).toBe(EXIT_STRICT);
      expect(result.stderr).toContain("--strict: 1 candidate design source could not be read");
      expect(result.stderr).toContain("b.tokens.json (invalid JSON)");
      expect(result.stderr).toContain("not a clean result");

      // And the conflict really was there, in the file the walk could not read.
      expect(result.stdout).toContain("conflicts (0)");
      const complete = await runCapture(["context", whole.root, "--strict"]);
      expect(complete.code).toBe(EXIT_STRICT);
      expect(complete.stdout).toContain("conflicts (1)");
    } finally {
      broken.cleanup();
      whole.cleanup();
    }
  });

  it("gates on every way a source is refused, not only on bad JSON", async () => {
    // The three entries `skipped` can hold: over the 2 MiB ceiling, unparseable
    // CSS, unparseable JSON. All three mean the same thing to a reader of the
    // counts below - this file was never parsed - so all three must gate.
    const tree = makeTree({
      "big.tokens.json": JSON.stringify({ note: "x".repeat(2 * 1024 * 1024 + 16) }),
      "broken.css": ":root { --color-ink: #101010;\n.card { color: red;\n",
      "broken.tokens.json": "{ color: ",
    });
    try {
      const result = await runCapture(["context", tree.root, "--strict"]);
      expect(result.code).toBe(EXIT_STRICT);
      expect(result.stderr).toContain("3 candidate design sources could not be read");
      expect(result.stderr).toContain("big.tokens.json (larger than 2097152 bytes)");
      expect(result.stderr).toContain("broken.css (unparseable CSS: Unclosed block at line 2)");
      expect(result.stderr).toContain("broken.tokens.json (invalid JSON)");
    } finally {
      tree.cleanup();
    }
  });

  it("never states an absence a refused source makes unsafe", async () => {
    const tree = conflictBehindAParseError(false);
    try {
      const result = await runCapture(["context", tree.root]);
      const lines = result.stdout.split("\n");

      // "(none)" is a conclusion. A run that could not parse a design source has
      // not earned it anywhere in the report.
      expect(lines).not.toContain("  (none)");
      expect(result.stdout).not.toContain("(none: no two sources declared the same token with different values)");

      // Each absence says what it is scoped to, and what it is NOT claiming.
      expect(result.stdout).toContain("none among the sources that could be read");
      expect(result.stdout).toContain("this is NOT\n   'no two sources disagree'");
      expect(result.stdout).toContain("none in the token files that could be read");
      expect(result.stdout).toContain("this is NOT\n   'every token file here resolves cleanly'");
    } finally {
      tree.cleanup();
    }
  });

  it("scopes 'none declared' to the sources it could read", async () => {
    // Sources read, none of them a declaration site, and a token file refused.
    // The complete-scan wording ends "Each source above states what it
    // contributed", which is a statement about the whole repository and is
    // false here: the file that would have declared the tokens is not above,
    // it is under `skipped files` and was never parsed.
    const tree = makeTree({
      "src/App.css": "body { color: red; }",
      "design.tokens.json": BRAND_DARK.slice(0, 30),
    });
    try {
      const result = await runCapture(["context", tree.root]);
      expect(result.stdout).toContain("resolved tokens (0)");
      expect(result.stdout).not.toContain("(none declared. ui-dna reads tokens a repository states outright");
      expect(result.stdout).toContain("none declared by the sources that could be read");
      expect(result.stdout).toContain("this is NOT\n   'this repository declares no tokens'");

      // The same tree with the file readable declares the token, so the zero
      // above really was a lower bound rather than a wording quibble.
      const whole = makeTree({ "src/App.css": "body { color: red; }", "design.tokens.json": BRAND_DARK });
      try {
        const complete = await runCapture(["context", whole.root]);
        expect(complete.stdout).toContain("resolved tokens (1)");
      } finally {
        whole.cleanup();
      }
    } finally {
      tree.cleanup();
    }
  });

  it("says it did not read everything before any count, not only in a footnote", async () => {
    const tree = conflictBehindAParseError(false);
    try {
      const result = await runCapture(["context", tree.root]);
      const lines = result.stdout.split("\n");

      const banner = lines.findIndex((line) => line.startsWith("scan incomplete -"));
      const firstCount = lines.findIndex((line) => line.startsWith("sources ("));
      expect(banner).toBeGreaterThanOrEqual(0);
      expect(banner).toBeLessThan(firstCount);

      // Every count derived from the walk carries the qualifier. Derived from
      // the output rather than a list, so a section added later without it
      // fails here. `skipped files` is the one count a refusal does not make a
      // lower bound: it IS the refusals, and the walk counted them exactly.
      const headings = countHeadings(result.stdout);
      expect(headings.length).toBeGreaterThanOrEqual(7);
      for (const heading of headings) {
        if (heading.startsWith("skipped files (")) {
          expect(heading, heading).not.toContain("[INCOMPLETE:");
          continue;
        }
        expect(heading, heading).toContain("[INCOMPLETE:");
      }
    } finally {
      tree.cleanup();
    }
  });

  it("stops telling the reader to check the path when a candidate was found and refused", async () => {
    // The worst line of the old report. With every candidate refused, the
    // sources table was empty, so it printed "none of them was a .css,
    // tokens.json/... Check the path" - a false statement about the walked
    // files that sent the reader to look for a problem that was not there,
    // while the real one sat twenty lines below under `skipped files`.
    const tree = makeTree({ "design-tokens.json": "{ color: " });
    try {
      const result = await runCapture(["context", tree.root]);
      expect(result.stdout).toContain("sources (0 of 1 files walked)");
      expect(result.stdout).not.toContain("and none of them was a");
      expect(result.stdout).not.toContain("Check the path");
      expect(result.stdout).toContain("every candidate design source among them");
      expect(result.stdout).toContain('this is NOT "this repository declares no design system"');
      expect(result.stdout).toContain("design-tokens.json (invalid JSON)");
    } finally {
      tree.cleanup();
    }
  });

  it("carries none of this when the scan read everything it found", async () => {
    // The mirror image. Printed unconditionally, the banner and the qualifier
    // would satisfy every test above while telling every reader of a complete
    // scan that their result cannot be trusted.
    const tree = conflictBehindAParseError(true);
    try {
      const result = await runCapture(["context", tree.root]);
      expect(result.stdout).not.toContain("scan incomplete");
      expect(result.stdout).not.toContain("[INCOMPLETE:");
      expect(result.stdout).not.toContain("skipped files (");
      expect(result.stdout).toContain("  (none)");

      const clean = makeTree({ "src/app.css": ":root { --color-ink: #101010; }" });
      try {
        const gate = await runCapture(["context", clean.root, "--strict"]);
        expect(gate.code).toBe(EXIT_OK);
        expect(gate.stderr).toBe("");
      } finally {
        clean.cleanup();
      }
    } finally {
      tree.cleanup();
    }
  });

  it("carries the refusals into --json, so a machine consumer sees them too", async () => {
    const tree = conflictBehindAParseError(false);
    try {
      const result = await runCapture(["context", tree.root, "--json", "--strict"]);
      expect(result.code).toBe(EXIT_STRICT);
      const report = JSON.parse(result.stdout) as {
        skipped: string[];
        truncated: boolean;
        conflicts: unknown[];
      };
      // Not truncated: the walk finished. It just could not read one of the
      // files it finished on, which is why `skipped` has to be consulted too.
      expect(report.truncated).toBe(false);
      expect(report.skipped).toEqual(["b.tokens.json (invalid JSON)"]);
      expect(report.conflicts).toHaveLength(0);
    } finally {
      tree.cleanup();
    }
  });
});
