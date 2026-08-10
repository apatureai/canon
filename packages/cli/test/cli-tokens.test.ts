import { describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_OK, EXIT_STRICT } from "../src/index.js";
import { makeTree, runCapture } from "./helpers.js";

/**
 * `ui-dna tokens` over the file the README tells a reader to run. If these
 * assertions drift from `examples/sample-tokens.json`, the documented transcript
 * is wrong, which is the failure mode this suite exists to catch.
 */
describe("ui-dna tokens", () => {
  it("resolves the shipped sample token file and reports its alias trail", async () => {
    const result = await runCapture(["tokens", "examples/sample-tokens.json"]);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("DTCG Format Module 2025.10");
    expect(result.stdout).toContain("resolved tokens (22)");
    // A chained curly alias keeps its derivation, in resolution order.
    expect(result.stdout).toContain("color.link-hover");
    expect(result.stdout).toMatch(/color\.link-hover\s+color\s+#2f6fed\s+<- color\.brand <- color\.link/);
    // A same-document RFC 6901 pointer resolves to the same colour.
    expect(result.stdout).toMatch(/color\.focus-ring\s+color\s+#2f6fed/);
    // Group $extends copies the group's members under the extending group.
    expect(result.stdout).toMatch(/component\.button-padding\s+dimension\s+16px/);
  });

  it("abstains on the broken tokens instead of promoting them", async () => {
    const result = await runCapture(["tokens", "examples/sample-tokens.json"]);
    expect(result.stdout).toContain("diagnostics (4)");
    expect(result.stdout).toContain("unresolved_reference");
    expect(result.stdout).toContain("circular_reference");
    expect(result.stdout).toContain("invalid_value");
    // The unresolvable tokens are absent from the resolved list, not present
    // with their reference syntax as a value.
    expect(result.stdout).not.toContain("{color.nowhere}\n");
    expect(result.stdout).not.toMatch(/^\s+color\.missing\s/m);
    expect(result.stdout).not.toMatch(/^\s+color\.loop-a\s/m);
  });

  it("--json prints the machine-readable resolution", async () => {
    const result = await runCapture(["tokens", "examples/sample-tokens.json", "--json"]);
    expect(result.code).toBe(EXIT_OK);
    const parsed = JSON.parse(result.stdout) as {
      profile: { formatModule: string; resolverSetsAndModifiers: boolean };
      tokens: { name: string; type: string | null; value: unknown }[];
      diagnostics: { code: string }[];
    };
    expect(parsed.profile.formatModule).toBe("2025.10");
    expect(parsed.profile.resolverSetsAndModifiers).toBe(false);
    expect(parsed.tokens).toHaveLength(22);
    expect(parsed.diagnostics).toHaveLength(4);
    // --json is the exact value; the report elides long composites.
    const shadow = parsed.tokens.find((token) => token.name === "shadow.card");
    expect(shadow?.value).toMatchObject({ blur: { value: 3, unit: "px" } });
  });

  it("--strict turns diagnostics into a non-zero exit", async () => {
    const dirty = await runCapture(["tokens", "examples/sample-tokens.json", "--strict"]);
    expect(dirty.code).toBe(EXIT_STRICT);

    const tree = makeTree({
      "clean.tokens.json": JSON.stringify({ color: { $type: "color", ink: { $value: { colorSpace: "srgb", components: [0, 0, 0] } } } }),
    });
    try {
      const clean = await runCapture(["tokens", "clean.tokens.json", "--strict"], tree.root);
      expect(clean.code).toBe(EXIT_OK);
      expect(clean.stdout).toContain("diagnostics (0)");
    } finally {
      tree.cleanup();
    }
  });

  it("fails with a readable message on a missing or malformed file", async () => {
    const missing = await runCapture(["tokens", "does-not-exist.json"]);
    expect(missing.code).toBe(EXIT_ERROR);
    expect(missing.stderr).toContain("cannot read does-not-exist.json");

    const tree = makeTree({ "broken.tokens.json": "{ not json" });
    try {
      const malformed = await runCapture(["tokens", "broken.tokens.json"], tree.root);
      expect(malformed.code).toBe(EXIT_ERROR);
      expect(malformed.stderr).toContain("is not valid JSON");
    } finally {
      tree.cleanup();
    }
  });

  it("refuses a Resolver Module document rather than partially resolving it", async () => {
    const tree = makeTree({
      "tokens.json": JSON.stringify({ sets: { base: { sources: [] } }, resolutionOrder: [] }),
    });
    try {
      const result = await runCapture(["tokens", "tokens.json"], tree.root);
      expect(result.stdout).toContain("unsupported_resolver_module");
      expect(result.stdout).toContain("resolved tokens (0)");
    } finally {
      tree.cleanup();
    }
  });
});

describe("ui-dna usage", () => {
  it("prints help and exits 0 for --help", async () => {
    const result = await runCapture(["--help"]);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("ui-dna tokens <file.json>");
    expect(result.stdout).toContain("ui-dna context <directory>");
  });

  it("exits 1 with usage when given no command or an unknown one", async () => {
    expect((await runCapture([])).code).toBe(EXIT_ERROR);
    const unknown = await runCapture(["genome", "."]);
    expect(unknown.code).toBe(EXIT_ERROR);
    expect(unknown.stderr).toContain('unknown command "genome"');
  });

  it("rejects an unknown option instead of ignoring it", async () => {
    const result = await runCapture(["tokens", "examples/sample-tokens.json", "--pretty"]);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain("unknown option --pretty");
  });
});
