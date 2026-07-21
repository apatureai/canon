import { emptyDraft, validateSnapshot } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import { extractTokensJson, extractTokensJsonWithDiagnostics } from "../src/index.js";

function colorValue(hex: string, components: [number, number, number] = [0, 0, 0]) {
  return { colorSpace: "srgb", components, alpha: 1, hex };
}

describe("extractTokensJson", () => {
  it("classifies DTCG Format 2025.10 tokens by their declared $type", () => {
    const tokens = extractTokensJson({
      brand: { primary: { $value: colorValue("#ff0000", [1, 0, 0]), $type: "color" } },
      space: { sm: { $value: { value: 4, unit: "px" }, $type: "dimension" } },
      font: { body: { $value: "Inter", $type: "fontFamily" } },
      radius: { md: { $value: "8px", $type: "borderRadius" } },
      elevation: { card: { $value: { color: "#0001", blur: { value: 2, unit: "px" } }, $type: "shadow" } },
      anim: { fast: { $value: { value: 150, unit: "ms" }, $type: "duration" } },
    });
    expect(tokens.color["brand.primary"]?.value).toBe("#ff0000");
    expect(tokens.spacing["space.sm"]?.value).toBe("4px");
    expect(tokens.typography["font.body"]?.value).toBe("Inter");
    expect(tokens.radii["radius.md"]?.value).toBe("8px");
    expect(tokens.shadows["elevation.card"]?.value).toBe(
      '{"blur":{"unit":"px","value":2},"color":"#0001"}',
    );
    expect(tokens.motion["anim.fast"]?.value).toBe("150ms");
  });

  it("uses $type even when it disagrees with the token name", () => {
    // Name says "color" but $type says dimension -> dimension wins.
    const tokens = extractTokensJson({ color: { gap: { $value: { value: 8, unit: "px" }, $type: "dimension" } } });
    expect(tokens.spacing["color.gap"]?.value).toBe("8px");
    expect(tokens.color["color.gap"]).toBeUndefined();
  });

  it("disambiguates a DTCG `dimension` radius by its name (radii, not spacing)", () => {
    // DTCG 2025.10 has no `borderRadius` $type — a conformant radius token is
    // `$type: "dimension"`, the same as spacing. The name is the only signal, so
    // a `dimension` token that names itself a radius must land in `radii` (where
    // code-side extraction puts it), not silently in `spacing`.
    const tokens = extractTokensJson({
      radius: { lg: { $value: { value: 12, unit: "px" }, $type: "dimension" } },
      rounded: { xl: { $value: { value: 16, unit: "px" }, $type: "dimension" } },
      space: { md: { $value: { value: 8, unit: "px" }, $type: "dimension" } },
    });
    expect(tokens.radii["radius.lg"]?.value).toBe("12px");
    expect(tokens.radii["rounded.xl"]?.value).toBe("16px");
    expect(tokens.spacing["radius.lg"]).toBeUndefined(); // not misfiled as spacing
    // A plain spacing dimension is unaffected.
    expect(tokens.spacing["space.md"]?.value).toBe("8px");
    expect(tokens.radii["space.md"]).toBeUndefined();
  });

  it("falls back to name-prefix classification when $type is absent", () => {
    const tokens = extractTokensJson({
      color: { primary: { value: "#0a0a0a" } },
      spacing: { lg: { value: "24px" } },
    });
    expect(tokens.color["color.primary"]?.value).toBe("#0a0a0a");
    expect(tokens.spacing["spacing.lg"]?.value).toBe("24px");
  });

  it("stamps tokens as config-provenance facts with sub-1 confidence", () => {
    const tokens = extractTokensJson({ color: { primary: { $value: colorValue("#abc"), $type: "color" } } });
    const f = tokens.color["color.primary"];
    expect(f?.provenance).toBe("config");
    expect(f?.confidence).toBeGreaterThan(0);
    expect(f?.confidence).toBeLessThan(1);
  });

  it("drops tokens with neither a known $type nor a classifiable name", () => {
    const tokens = extractTokensJson({ zindex: { modal: { $value: "50", $type: "number" } } });
    for (const group of Object.values(tokens)) expect(Object.keys(group)).toHaveLength(0);
  });

  it("produces facts that pass schema validation when merged into a draft", () => {
    const draft = emptyDraft("apatureai", "ui-dna", "test");
    draft.tokens = extractTokensJson({ color: { bg: { $value: colorValue("#fff", [1, 1, 1]), $type: "color" } } });
    expect(validateSnapshot(draft)).toEqual({ ok: true });
  });

  it("is deterministic: same document in -> same tokens out", () => {
    const doc = { color: { a: { $value: colorValue("#1"), $type: "color" }, b: { $value: colorValue("#2"), $type: "color" } } };
    expect(extractTokensJson(doc)).toEqual(extractTokensJson(doc));
  });

  it("projects resolved aliases but retains diagnostics and drops invalid references", () => {
    const result = extractTokensJsonWithDiagnostics({
      primitive: { ink: { $type: "color", $value: colorValue("#111") } },
      semantic: { ink: { $value: "{primitive.ink}" } },
      broken: { $type: "color", $value: "{missing}" },
    });
    expect(result.tokens.color["semantic.ink"]?.value).toBe("#111");
    expect(result.tokens.color.broken).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "unresolved_reference",
      path: "broken",
    }));
  });

  it("projects exact composites deterministically only at the DNA string boundary", () => {
    const tokens = extractTokensJson({
      elevation: {
        card: {
          $type: "shadow",
          $value: { offsetY: { unit: "px", value: 1 }, color: "#0004" },
        },
      },
    });
    expect(tokens.shadows["elevation.card"]?.value).toBe(
      '{"color":"#0004","offsetY":{"unit":"px","value":1}}',
    );
  });
});
