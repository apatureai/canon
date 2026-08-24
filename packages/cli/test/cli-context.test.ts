import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSnapshot, type DnaSnapshot } from "@apatureai/canon-schema";
import { describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_OK, EXIT_STRICT } from "../src/index.js";
import { makeTree, REPO_ROOT, runCapture } from "./helpers.js";

/**
 * `ui-dna context` over `examples/sample-project`, which is the transcript the
 * README shows. The sample project deliberately contains one Tailwind v4
 * `@theme` block and one `:root` block that disagree, so the reconciliation
 * path, not just the extraction path, is exercised end to end.
 */
describe("ui-dna context", () => {
  it("reports every static source it found in the sample project", async () => {
    const result = await runCapture(["context", "examples/sample-project"]);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("sources (6 of 6 files walked)");
    expect(result.stdout).toMatch(/\.designreview\.yml\s+brand-identity/);
    expect(result.stdout).toMatch(/design\.tokens\.json\s+dtcg-tokens/);
    expect(result.stdout).toMatch(/package\.json\s+component-libraries\s+-\s+2 library: shadcn\/ui, radix/);
    expect(result.stdout).toMatch(/src\/styles\.css\s+css-custom-properties/);
    expect(result.stdout).toMatch(/src\/theme\.css\s+tailwind-v4-theme/);
    // A Tailwind config is executable code: reported, not run, unless asked.
    expect(result.stdout).toMatch(/tailwind\.config\.js\s+tailwind-v3-config\s+-\s+not evaluated/);
  });

  it("keeps the winning value and records the disagreement instead of dropping it", async () => {
    const result = await runCapture(["context", "examples/sample-project"]);
    expect(result.stdout).toContain("conflicts (2)");
    // @theme (0.70) outranks :root (0.60) on confidence; both are `code`.
    expect(result.stdout).toContain('tokens.color.--color-brand  resolved "#2f6fed" (code, confidence 0.49)');
    expect(result.stdout).toContain('"#0a58ca"  code 0.60  src/styles.css');
    expect(result.stdout).toContain('"#2f6fed"  code 0.70  src/theme.css');
    // Disagreement degrades confidence below either source's own.
    expect(result.stdout).toContain("confidence delta -0.21");
    expect(result.stdout).toContain(
      'tokens.color.--color-brand: code says "#2f6fed" but code shows "#0a58ca"',
    );
  });

  it("surfaces an unresolvable design-export reference as a diagnostic", async () => {
    const result = await runCapture(["context", "examples/sample-project"]);
    expect(result.stdout).toContain("token diagnostics (1)");
    expect(result.stdout).toContain("design.tokens.json  unresolved_reference  color.accent");
  });

  it("is content-addressed: two runs over the same tree agree on the hash", async () => {
    const first = await runCapture(["context", "examples/sample-project"]);
    const second = await runCapture(["context", "examples/sample-project", "--repo", "acme/console"]);
    const hash = (output: string): string => /contentHash\s+(sha256:[0-9a-f]{64})/.exec(output)?.[1] ?? "";
    expect(hash(first.stdout)).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Repository identity is part of the hashed content, so it must move it.
    expect(hash(second.stdout)).not.toBe(hash(first.stdout));

    const repeat = await runCapture(["context", "examples/sample-project"]);
    expect(hash(repeat.stdout)).toBe(hash(first.stdout));
  });

  it("--out writes a schema-valid draft genome", async () => {
    const tree = makeTree({ ".keep": "" });
    try {
      const outPath = join(tree.root, "nested", "genome.json");
      const result = await runCapture(["context", join(REPO_ROOT, "examples/sample-project"), "--out", outPath]);
      expect(result.code).toBe(EXIT_OK);
      expect(result.stdout).toContain("wrote draft genome");

      const snapshot = JSON.parse(readFileSync(outPath, "utf8")) as DnaSnapshot;
      expect(validateSnapshot(snapshot)).toEqual({ ok: true });
      // A directory walk is not a sign-off: the genome stays a draft.
      expect(snapshot.metadata.approvalState).toBe("draft");
      expect(snapshot.repository).toEqual({ owner: "local", name: "sample-project" });
      expect(snapshot.tokens.color["--color-brand"]?.value).toBe("#2f6fed");
      expect(snapshot.tokens.color["--color-brand"]?.provenance).toBe("code");
      expect(snapshot.tokens.color["--color-brand"]?.confidence).toBeCloseTo(0.49, 2);
      expect(snapshot.identity.tone?.value).toBe("precise, quiet, never playful");
      expect(snapshot.components.map((component) => component.name)).toEqual(["shadcn/ui", "radix"]);
    } finally {
      tree.cleanup();
    }
  });

  it("--strict fails on a conflicted or diagnostic-bearing tree, passes on a clean one", async () => {
    const dirty = await runCapture(["context", "examples/sample-project", "--strict"]);
    expect(dirty.code).toBe(EXIT_STRICT);

    const tree = makeTree({ "src/app.css": ":root { --color-ink: #101010; }" });
    try {
      const clean = await runCapture(["context", tree.root, "--strict"]);
      expect(clean.code).toBe(EXIT_OK);
      expect(clean.stdout).toContain("conflicts (0)");
    } finally {
      tree.cleanup();
    }
  });

  it("still reports a project that contains one malformed stylesheet", async () => {
    // One unclosed brace used to abort the command: PostCSS threw out of the
    // extractor, `runCli`'s outer catch printed `failed: <css input>:2:1:
    // Unclosed block`, and the exit code was 1 with no report and no filename.
    // A file the walk cannot parse is one skipped file, not a dead scan.
    const tree = makeTree({
      "broken.css": ":root { --color-brand: #ffffff;\n.card { color: red;\n",
      "good.css": ":root { --color-ink: #101010; }",
    });
    try {
      const result = await runCapture(["context", tree.root]);
      expect(result.code).toBe(EXIT_OK); // was EXIT_ERROR, with nothing on stdout
      expect(result.stderr).not.toContain("failed:");
      expect(result.stdout).toContain("sources (1 of 2 files walked)");
      expect(result.stdout).toContain("resolved tokens (1)");
      // Named, with the reason, so the reader knows which file to go and fix.
      expect(result.stdout).toContain("broken.css (unparseable CSS: Unclosed block at line 2)");
    } finally {
      tree.cleanup();
    }
  });

  it("reports an empty tree without inventing a design system", async () => {
    const tree = makeTree({ "README.md": "# nothing to see" });
    try {
      const result = await runCapture(["context", tree.root]);
      expect(result.code).toBe(EXIT_OK);
      expect(result.stdout).toContain("sources (0 of 1 files walked)");
      expect(result.stdout).toContain("resolved tokens (0)");
      expect(result.stdout).toContain("identity facts (0)");
    } finally {
      tree.cleanup();
    }
  });

  it("reports the utility-only sample project as read-but-empty, never as absent", async () => {
    // This is the README's "On a real repository" transcript. A project that
    // styles with utility classes declares no tokens, and the report has to say
    // which files it read and why each contributed nothing.
    const result = await runCapture(["context", "examples/utility-only-project"]);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("sources (3 of 3 files walked)");
    expect(result.stdout).toMatch(/package\.json\s+component-libraries\s+-\s+no recognised component library/);
    expect(result.stdout).toMatch(
      /src\/App\.css\s+css-custom-properties\s+-\s+no custom properties in :root\/html or a theme scope/,
    );
    // `@import "tailwindcss"` is not a declaration site: the theme lives in the
    // npm package, and the only "@theme" in the file is inside a comment.
    expect(result.stdout).toMatch(
      /src\/index\.css\s+css-custom-properties\s+-\s+no custom properties in :root\/html or a theme scope/,
    );
    expect(result.stdout).toContain("resolved tokens (0)");
    // A bare 0 reads like a broken scan. The report has to say, on the screen the
    // user is already looking at, that only DECLARED tokens count.
    expect(result.stdout).toContain("(none declared. ui-dna reads tokens a repository states outright");
    expect(result.stdout).toContain("not infer a scale from utility classes or from rendered output");
  });

  it("explains a zero only when files were read, never when the walk found nothing", async () => {
    // Sources found but nothing declared: explain what "declared" means.
    const declaredNothing = makeTree({ "src/index.css": ".btn { color: #101010; }" });
    try {
      const result = await runCapture(["context", declaredNothing.root]);
      expect(result.stdout).toContain("resolved tokens (0)");
      expect(result.stdout).toContain("(none declared.");
    } finally {
      declaredNothing.cleanup();
    }

    // No candidate file at all: the sources block already says so, and repeating
    // the declaration rule there would answer a question nobody asked.
    const nothingToRead = makeTree({ "README.md": "# nothing to see" });
    try {
      const result = await runCapture(["context", nothingToRead.root]);
      expect(result.stdout).toContain("sources (0 of 1 files walked)");
      expect(result.stdout).toContain("resolved tokens (0)");
      expect(result.stdout).not.toContain("(none declared.");
    } finally {
      nothingToRead.cleanup();
    }
  });

  it("distinguishes 'walked your files, they declared nothing' from 'found no files'", async () => {
    // A real project that styles with utility classes has stylesheets and a
    // package.json but declares no tokens. The report must show the files it
    // read rather than printing a claim about the filesystem it never checked.
    const tree = makeTree({
      "src/index.css": '@import "tailwindcss";\n.btn { color: #101010; }',
      "package.json": JSON.stringify({ dependencies: { react: "^19.1.0" } }),
    });
    try {
      const result = await runCapture(["context", tree.root]);
      expect(result.code).toBe(EXIT_OK);
      expect(result.stdout).toContain("sources (2 of 2 files walked)");
      expect(result.stdout).toMatch(
        /src\/index\.css\s+css-custom-properties\s+-\s+no custom properties in :root\/html or a theme scope/,
      );
      expect(result.stdout).toMatch(/package\.json\s+component-libraries\s+-\s+no recognised component library/);
      expect(result.stdout).toContain("resolved tokens (0)");
      // The old empty-state line asserted these files did not exist. They do.
      expect(result.stdout).not.toContain("(none: walked");
    } finally {
      tree.cleanup();
    }
  });

  it("rolls up a flood of declaration-free stylesheets instead of printing every row", async () => {
    const files: Record<string, string> = { "src/tokens.css": ":root { --color-ink: #101010; }" };
    for (let index = 0; index < 12; index += 1) files[`src/c${index}.module.css`] = `.c${index} { color: #101010; }`;
    const tree = makeTree(files);
    try {
      const result = await runCapture(["context", tree.root]);
      expect(result.stdout).toContain("sources (13 of 13 files walked)");
      expect(result.stdout).toContain("... and 4 more .css files read that declared no custom properties");
      // The contributing source is never rolled up.
      expect(result.stdout).toMatch(/src\/tokens\.css\s+css-custom-properties\s+1 tokens/);

      const json = await runCapture(["context", tree.root, "--json"]);
      const parsed = JSON.parse(json.stdout) as { sources: unknown[] };
      expect(parsed.sources).toHaveLength(13);
    } finally {
      tree.cleanup();
    }
  });

  it("--json exposes the walked-file count and every visited source", async () => {
    const tree = makeTree({ "src/index.css": ".btn { color: #101010; }", "src/main.tsx": "export const a = 1;" });
    try {
      const result = await runCapture(["context", tree.root, "--json"]);
      expect(result.code).toBe(EXIT_OK);
      const parsed = JSON.parse(result.stdout) as {
        filesWalked: number;
        sources: { path: string; kind: string; tokens: number; note: string }[];
      };
      expect(parsed.filesWalked).toBe(2);
      expect(parsed.sources).toEqual([
        {
          path: "src/index.css",
          kind: "css-custom-properties",
          tokens: 0,
          note: "no custom properties in :root/html or a theme scope",
        },
      ]);
    } finally {
      tree.cleanup();
    }
  });

  it("fails clearly when the target is missing or is a file", async () => {
    const missing = await runCapture(["context", "no-such-directory"]);
    expect(missing.code).toBe(EXIT_ERROR);
    expect(missing.stderr).toContain("cannot read directory no-such-directory");

    const asFile = await runCapture(["context", "examples/sample-tokens.json"]);
    expect(asFile.code).toBe(EXIT_ERROR);
    expect(asFile.stderr).toContain("is not a directory");
  });

  it("rejects a malformed --repo", async () => {
    const result = await runCapture(["context", "examples/sample-project", "--repo", "acme"]);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain("--repo expects owner/name");
  });
});
