import { describe, expect, it } from "vitest";
import { makeTree, runCapture } from "./helpers.js";

/**
 * The banner and `--strict` gate landed first (`cli-truncated-gate.test.ts`),
 * but only four of the seven count sections carried the `[INCOMPLETE: ...]`
 * qualifier. `identity facts`, `component libraries` and `drift hints` read as
 * finished numbers on a walk that stopped early, and `drift hints (0)` went
 * further and printed
 *
 *   drift hints (0)
 *     (none)
 *
 * which states a conclusion the walk did not earn: "none" there means "none in
 * the part I looked at". Same defect as the `--strict` exit-0 bug, one section
 * smaller.
 *
 * These tests do not enumerate the sections. They re-derive every count heading
 * from the report itself, so a section added later without the qualifier fails
 * here rather than shipping as a silent lower bound.
 */

const CONFLICTING_A = JSON.stringify({
  color: { brand: { $type: "color", $value: { colorSpace: "srgb", components: [0.1, 0.1, 0.1] } } },
  space: { md: { $type: "dimension", $value: { value: 8, unit: "px" } } },
});

const CONFLICTING_B = JSON.stringify({
  color: { brand: { $type: "color", $value: { colorSpace: "srgb", components: [0.9, 0.9, 0.9] } } },
  space: { md: { $type: "dimension", $value: { value: 16, unit: "px" } } },
});

/**
 * Two disagreeing token files under `zzz/`, a root `package.json` naming a
 * component library and a root `.designreview.yml` stating identity, all behind
 * `filler` files under `.aaa/`. The walk sorts every entry in a directory
 * together, files and directories alike, and `.aaa` sorts before both root
 * files, so a low enough `--max-files` provably reaches none of the four. Every
 * count in the report is then a lower bound, including the three that used to
 * hide it.
 */
function everythingBehindFiller(filler: number): { root: string; cleanup: () => void } {
  const files: Record<string, string> = {
    "zzz/a.tokens.json": CONFLICTING_A,
    "zzz/b.tokens.json": CONFLICTING_B,
    "package.json": JSON.stringify({ name: "x", dependencies: { "@radix-ui/react-dialog": "1.0.0" } }),
    ".designreview.yml": "brand:\n  tone: calm\n  audience: developers\n",
  };
  // Sorts first inside `.aaa/`, so every run reaches it and the report always
  // has a `skipped files` section for the heading rule below to cover.
  files[".aaa/00-broken.tokens.json"] = "{ not json";
  for (let i = 0; i < filler; i += 1) {
    files[`.aaa/f${String(i).padStart(5, "0")}.txt`] = "x";
  }
  return makeTree(files);
}

/**
 * Every top-level heading in the report that states a count, taken from the
 * output rather than from a list. The two `walk truncated` banners carry a file
 * count too, but they are the thing doing the warning, not a result.
 */
function countHeadings(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => /^\S/.test(line) && /\(\d+/.test(line) && !line.startsWith("walk truncated"));
}

describe("a truncated report tags every count it under-reports", () => {
  it("tags all of them, including the three that used to read as finished", async () => {
    const tree = everythingBehindFiller(40);
    try {
      const result = await runCapture(["context", tree.root, "--max-files", "20"]);
      const headings = countHeadings(result.stdout);

      // The report really does have the sections we think it has, so a heading
      // that disappears cannot make this test pass by vacuum.
      expect(headings.length).toBeGreaterThanOrEqual(7);
      for (const label of [
        "sources (",
        "resolved tokens (",
        "identity facts (",
        "component libraries (",
        "conflicts (",
        "drift hints (",
        "token diagnostics (",
        // Printed only when the walk refused a file, and a lower bound for the
        // same reason: files past the bound were never tried.
        "skipped files (",
      ]) {
        expect(headings.some((heading) => heading.startsWith(label)), label).toBe(true);
      }

      // And every one of them carries the qualifier.
      for (const heading of headings) {
        expect(heading, heading).toContain("[INCOMPLETE:");
      }
    } finally {
      tree.cleanup();
    }
  });

  it("carries the qualifier on no heading at all when the walk finished", async () => {
    // The mirror image: a qualifier printed unconditionally would satisfy the
    // test above while telling every reader of a complete scan that their
    // result is a lower bound. It is a claim about THIS run, not decoration.
    const tree = everythingBehindFiller(40);
    try {
      const result = await runCapture(["context", tree.root, "--max-files", "1000"]);
      expect(result.stdout).not.toContain("[INCOMPLETE:");
      expect(result.stdout).not.toContain("walk truncated");
      for (const heading of countHeadings(result.stdout)) {
        expect(heading, heading).not.toContain("[INCOMPLETE:");
      }
    } finally {
      tree.cleanup();
    }
  });

  it("never prints a bare (none) on a truncated walk", async () => {
    const tree = everythingBehindFiller(40);
    try {
      const truncated = await runCapture(["context", tree.root, "--max-files", "20"]);
      // "(none)" is a conclusion. A walk that stopped early is entitled to
      // "none found before I stopped", and nothing stronger.
      expect(truncated.stdout.split("\n")).not.toContain("  (none)");

      // On a finished walk the bare form is exactly right, so this is not a ban
      // on the string: it is a ban on saying it without having looked.
      const complete = await runCapture(["context", tree.root, "--max-files", "1000"]);
      expect(complete.stdout).toContain("  (none)");
    } finally {
      tree.cleanup();
    }
  });

  it("says drift hints (0) means 'none found yet', and proves it was a lower bound", async () => {
    const tree = everythingBehindFiller(40);
    try {
      const truncated = await runCapture(["context", tree.root, "--max-files", "20"]);
      expect(truncated.stdout).toContain("drift hints (0)");
      expect(truncated.stdout).toContain("none among the sources reached before the walk was truncated");
      expect(truncated.stdout).toContain("this is NOT 'this repository has no drift'");

      // The drift the truncated run reported as "(none)" was there the whole
      // time. Raising the bound finds it, which is what makes the old line a
      // false negative rather than a stylistic quibble.
      const complete = await runCapture(["context", tree.root, "--max-files", "1000"]);
      expect(complete.stdout).toContain("drift hints (2)");
      expect(complete.stdout).toContain("tokens.spacing.space.md: config says");
    } finally {
      tree.cleanup();
    }
  });

  it("qualifies the other absence claims a truncated walk cannot support", async () => {
    const tree = everythingBehindFiller(40);
    try {
      const result = await runCapture(["context", tree.root, "--max-files", "20"]);
      expect(result.stdout).toContain("token diagnostics (0)");
      expect(result.stdout).toContain("none in the token files read before the walk was truncated");
      expect(result.stdout).toContain("this is NOT 'every token file here resolves cleanly'");
    } finally {
      tree.cleanup();
    }
  });

  it("scopes 'none declared' to the files it opened when the walk was truncated", async () => {
    // Sources reached, none of them a declaration site, and the walk unfinished.
    // The complete-walk wording ("none declared.") is a statement about the
    // repository; here it has to be a statement about the files that were read.
    const files: Record<string, string> = { "aaa/a.css": ".btn { color: #101010; }" };
    for (let i = 0; i < 40; i += 1) files[`aaa/f${String(i).padStart(5, "0")}.txt`] = "x";
    // Sorts after `aaa/`, so a 20-file bound never opens it.
    files["zzz/late.tokens.json"] = CONFLICTING_A;
    const tree = makeTree(files);
    try {
      const truncated = await runCapture(["context", tree.root, "--max-files", "20"]);
      expect(truncated.stdout).toContain("none declared by the sources reached before the walk was truncated");
      expect(truncated.stdout).toContain("this is NOT 'this repository declares no tokens'");
      expect(truncated.stdout).not.toContain("(none declared. ui-dna reads tokens a repository states outright");

      // And the unqualified wording is still what a finished walk prints.
      const complete = await runCapture(["context", tree.root, "--max-files", "1000"]);
      expect(complete.stdout).not.toContain("none declared by the sources reached");
    } finally {
      tree.cleanup();
    }
  });

  it("says a genome written from a truncated walk is a partial extraction", async () => {
    // `--out` writes a DnaSnapshot that looks exactly like one from a finished
    // scan. The snapshot format has no field saying otherwise, so the CLI says
    // it where the writing happens instead of letting the file stand alone.
    const tree = everythingBehindFiller(40);
    const out = `${tree.root}/out/genome.json`;
    try {
      const truncated = await runCapture(["context", tree.root, "--max-files", "20", "--out", out]);
      expect(truncated.stdout).toContain(`wrote draft genome  ${out}`);
      expect(truncated.stdout).toContain("This genome was extracted by the truncated walk above");
      expect(truncated.stdout).toContain("the file itself does not record that");

      const complete = await runCapture(["context", tree.root, "--max-files", "1000", "--out", out]);
      expect(complete.stdout).toContain(`wrote draft genome  ${out}`);
      expect(complete.stdout).not.toContain("This genome was extracted by the truncated walk above");
    } finally {
      tree.cleanup();
    }
  });

  it("tags identity facts and component libraries, which a bound can miss at the root", async () => {
    // Both come from root files. The walk sorts files and directories together,
    // so an earlier-sorting directory can exhaust the budget before either is
    // opened: "identity facts (0)" is then "I never got to your config".
    const tree = everythingBehindFiller(40);
    try {
      const truncated = await runCapture(["context", tree.root, "--max-files", "20"]);
      const lines = truncated.stdout.split("\n");
      const identity = lines.find((line) => line.startsWith("identity facts ("));
      const libraries = lines.find((line) => line.startsWith("component libraries ("));
      expect(identity).toBe(
        "identity facts (0)  [INCOMPLETE: the walk was truncated, so this count is a lower bound]",
      );
      expect(libraries).toBe(
        "component libraries (0)  [INCOMPLETE: the walk was truncated, so this count is a lower bound]",
      );

      // Both zeros were lower bounds: the root files exist and hold real values.
      const complete = await runCapture(["context", tree.root, "--max-files", "1000"]);
      expect(complete.stdout).toContain("identity facts (2)");
      expect(complete.stdout).toContain("component libraries (1)  radix");
    } finally {
      tree.cleanup();
    }
  });
});
