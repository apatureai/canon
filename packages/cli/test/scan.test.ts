import type { ConfigLoader } from "@apatureai/canon-context";
import { describe, expect, it } from "vitest";
import { scanProject } from "../src/index.js";
import { makeTree } from "./helpers.js";

/**
 * The directory walk. Everything here is about what the scanner REFUSES to do:
 * read a dependency tree, run a config it was not asked to run, follow a repo
 * to an unbounded depth, or promote a file it could not parse.
 */
describe("scanProject", () => {
  it("reads design sources and ignores build output and dependencies", async () => {
    const tree = makeTree({
      "src/app.css": ":root { --color-ink: #101010; --space-gutter: 16px; }",
      "node_modules/pkg/theme.css": ":root { --color-ink: #ff0000; }",
      "dist/bundle.css": ":root { --color-ink: #00ff00; }",
      ".next/static.css": ":root { --color-ink: #0000ff; }",
    });
    try {
      const scan = await scanProject(tree.root);
      expect(scan.sources.map((source) => source.path)).toEqual(["src/app.css"]);
      expect(scan.contributions.map((contribution) => contribution.name)).toEqual([
        "--color-ink",
        "--space-gutter",
      ]);
    } finally {
      tree.cleanup();
    }
  });

  it("separates a Tailwind v4 @theme block from ordinary :root custom properties", async () => {
    const tree = makeTree({
      "theme.css": "@theme { --color-brand: #2f6fed; }\n:root { --color-ink: #101010; }",
    });
    try {
      const scan = await scanProject(tree.root);
      expect(scan.sources.map((source) => source.kind)).toEqual([
        "css-custom-properties",
        "tailwind-v4-theme",
      ]);
      const brand = scan.contributions.find((contribution) => contribution.name === "--color-brand");
      const ink = scan.contributions.find((contribution) => contribution.name === "--color-ink");
      // An author-declared @theme token outranks an ad-hoc :root custom property.
      expect(brand?.fact.confidence).toBe(0.7);
      expect(ink?.fact.confidence).toBe(0.6);
    } finally {
      tree.cleanup();
    }
  });

  it("records a candidate file that declared nothing instead of dropping it", async () => {
    // The failure this guards against: a stylesheet that styles with utility
    // classes was read, parsed, found to declare no custom properties, and then
    // vanished - leaving a report that looked identical to "your files were
    // never found". A visited-but-empty source must stay visible.
    const tree = makeTree({
      "src/app.css": ".btn { color: #101010; padding: 8px; }",
      "src/component.css": ".data-grid__cell { --cell-padding: 6px; }",
      "package.json": JSON.stringify({ dependencies: { react: "^19.1.0" } }),
      "src/main.tsx": "export const main = 1;",
    });
    try {
      const scan = await scanProject(tree.root);
      expect(scan.sources).toEqual([
        {
          path: "package.json",
          kind: "component-libraries",
          tokens: 0,
          note: "no recognised component library (shadcn/ui, radix, mui, chakra, mantine)",
        },
        {
          path: "src/app.css",
          kind: "css-custom-properties",
          tokens: 0,
          note: "no custom properties in :root/html or a theme scope",
        },
        {
          // Component-scoped custom properties are not design tokens, so this
          // file legitimately contributes nothing - and says which reason.
          path: "src/component.css",
          kind: "css-custom-properties",
          tokens: 0,
          note: "no custom properties in :root/html or a theme scope",
        },
      ]);
      expect(scan.contributions).toEqual([]);
      // Every file the walk visited is counted, candidate or not.
      expect(scan.filesWalked).toBe(4);
    } finally {
      tree.cleanup();
    }
  });

  it("does not claim an @theme block because a comment mentions one", async () => {
    const tree = makeTree({
      "src/index.css": '/* no literal @theme block here */\n@import "tailwindcss";\n.btn { color: red; }',
    });
    try {
      const scan = await scanProject(tree.root);
      expect(scan.sources).toEqual([
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

  it("does not double-report a @theme stylesheet that has no :root block", async () => {
    const tree = makeTree({ "theme.css": "@theme { --color-brand: #2f6fed; }" });
    try {
      const scan = await scanProject(tree.root);
      expect(scan.sources).toEqual([
        { path: "theme.css", kind: "tailwind-v4-theme", tokens: 1, note: "@theme block" },
      ]);
    } finally {
      tree.cleanup();
    }
  });

  it("counts every walked file, including files no extractor claims", async () => {
    const tree = makeTree({
      "src/app.css": ":root { --color-ink: #101010; }",
      "src/app.tsx": "export const app = 1;",
      "README.md": "# readme",
      "node_modules/pkg/index.js": "module.exports = {};",
    });
    try {
      const scan = await scanProject(tree.root);
      // node_modules is never entered, so it is not walked and not counted.
      expect(scan.filesWalked).toBe(3);
      expect(scan.sources.map((source) => source.path)).toEqual(["src/app.css"]);
    } finally {
      tree.cleanup();
    }
  });

  it("does not evaluate a Tailwind config unless asked, and says so", async () => {
    const tree = makeTree({
      "tailwind.config.js": "throw new Error('this config must never run');",
    });
    try {
      const scan = await scanProject(tree.root);
      expect(scan.sources).toEqual([
        {
          path: "tailwind.config.js",
          kind: "tailwind-v3-config",
          tokens: 0,
          note: "not evaluated (pass --exec-tailwind-config)",
        },
      ]);
      expect(scan.contributions).toEqual([]);
    } finally {
      tree.cleanup();
    }
  });

  it("resolves a Tailwind config through the injected loader when enabled", async () => {
    const tree = makeTree({ "tailwind.config.js": "module.exports = {};" });
    const loaded: string[] = [];
    // The `ConfigLoader` port is what keeps this testable: no config is executed.
    const loader: ConfigLoader = {
      load(path) {
        loaded.push(path);
        return Promise.resolve({ theme: { extend: { colors: { brand: "#2f6fed" } } } });
      },
    };
    try {
      const scan = await scanProject(tree.root, { execTailwindConfig: true, configLoader: loader });
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toContain("tailwind.config.js");
      const brand = scan.contributions.find((contribution) => contribution.name === "colors.brand");
      expect(brand?.fact).toEqual({ value: "#2f6fed", confidence: 0.8, provenance: "config" });
      expect(scan.sources[0]?.note).toBe("evaluated in worker");
    } finally {
      tree.cleanup();
    }
  });

  it("records unparseable and oversized files as skipped rather than failing the scan", async () => {
    const tree = makeTree({
      "tokens.json": "{ definitely not json",
      "big.tokens.json": JSON.stringify({ color: { $type: "color", ink: { $value: "#101010" } } }),
      "src/app.css": ":root { --color-ink: #101010; }",
    });
    try {
      const scan = await scanProject(tree.root, { maxFileBytes: 40 });
      expect(scan.skipped).toContain("big.tokens.json (larger than 40 bytes)");
      expect(scan.skipped).toContain("tokens.json (invalid JSON)");
      expect(scan.sources.map((source) => source.path)).toEqual(["src/app.css"]);
    } finally {
      tree.cleanup();
    }
  });

  it("skips a stylesheet PostCSS cannot parse instead of aborting the whole scan", async () => {
    // The README promises that "unparseable files are listed as skipped, never
    // guessed at". That held for JSON and not for CSS: the extractors are pure
    // PostCSS parses that THROW, nothing caught them, and one unclosed brace
    // anywhere in a tree took the entire command down with
    // `failed: <css input>:2:1: Unclosed block` - no report, and not even the
    // name of the file to go and fix.
    const tree = makeTree({
      "broken.css": ":root { --color-brand: #ffffff;\n.card { color: red;\n",
      "theme-broken.css": "@theme { --color-brand: #ffffff;\n",
      "good.css": ":root { --color-ink: #101010; }",
    });
    try {
      const scan = await scanProject(tree.root);

      // The rest of the tree still resolves: one bad file costs one bad file.
      expect(scan.sources.map((source) => source.path)).toEqual(["good.css"]);
      expect(scan.contributions.map((contribution) => contribution.name)).toEqual(["--color-ink"]);

      // And the reader is told which files, and why, in the same vocabulary the
      // walk already uses for an unparseable JSON document.
      expect(scan.skipped).toEqual([
        "broken.css (unparseable CSS: Unclosed block at line 2)",
        "theme-broken.css (unparseable CSS: Unclosed block at line 1)",
      ]);
    } finally {
      tree.cleanup();
    }
  });

  it("bounds the walk and reports that it truncated", async () => {
    const tree = makeTree({
      "a/b/c/deep.css": ":root { --color-deep: #101010; }",
      "shallow.css": ":root { --color-ink: #101010; }",
    });
    try {
      const scan = await scanProject(tree.root, { maxDepth: 1 });
      expect(scan.truncated).toBe(true);
      expect(scan.sources.map((source) => source.path)).toEqual(["shallow.css"]);
    } finally {
      tree.cleanup();
    }
  });

  it("only reads package.json and .designreview.yml at the scan root", async () => {
    const tree = makeTree({
      "package.json": JSON.stringify({ dependencies: { "@mui/material": "^6.0.0" } }),
      "packages/inner/package.json": JSON.stringify({ dependencies: { "@chakra-ui/react": "^2.0.0" } }),
      ".designreview.yml": "brand:\n  tone: quiet\n",
      "packages/inner/.designreview.yml": "brand:\n  tone: loud\n",
    });
    try {
      const scan = await scanProject(tree.root);
      expect(scan.components.map((component) => component.name)).toEqual(["mui"]);
      expect(scan.identity.tone?.value).toBe("quiet");
    } finally {
      tree.cleanup();
    }
  });

  it("is deterministic: the same tree yields the same ordered result", async () => {
    const tree = makeTree({
      "b.css": ":root { --color-b: #020202; }",
      "a.css": ":root { --color-a: #010101; }",
      "design.tokens.json": JSON.stringify({ color: { $type: "color", ink: { $value: "#101010" } } }),
    });
    try {
      const first = await scanProject(tree.root);
      const second = await scanProject(tree.root);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(first.sources.map((source) => source.path)).toEqual(["a.css", "b.css", "design.tokens.json"]);
    } finally {
      tree.cleanup();
    }
  });
});
