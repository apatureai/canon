import { emptyDraft, validateSnapshot } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import { extractTokensJson } from "../src/index.js";

describe("extractTokensJson", () => {
  it("classifies W3C tokens by their declared $type", () => {
    const tokens = extractTokensJson({
      brand: { primary: { $value: "#ff0000", $type: "color" } },
      space: { sm: { $value: "4px", $type: "dimension" } },
      font: { body: { $value: "Inter", $type: "fontFamily" } },
      radius: { md: { $value: "8px", $type: "borderRadius" } },
      elevation: { card: { $value: "0 1px 2px #0001", $type: "shadow" } },
      anim: { fast: { $value: "150ms", $type: "duration" } },
    });
    expect(tokens.color["brand.primary"]?.value).toBe("#ff0000");
    expect(tokens.spacing["space.sm"]?.value).toBe("4px");
    expect(tokens.typography["font.body"]?.value).toBe("Inter");
    expect(tokens.radii["radius.md"]?.value).toBe("8px");
    expect(tokens.shadows["elevation.card"]?.value).toBe("0 1px 2px #0001");
    expect(tokens.motion["anim.fast"]?.value).toBe("150ms");
  });

  it("uses $type even when it disagrees with the token name", () => {
    // Name says "color" but $type says dimension -> dimension wins.
    const tokens = extractTokensJson({ color: { gap: { $value: "8px", $type: "dimension" } } });
    expect(tokens.spacing["color.gap"]?.value).toBe("8px");
    expect(tokens.color["color.gap"]).toBeUndefined();
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
    const tokens = extractTokensJson({ color: { primary: { $value: "#abc", $type: "color" } } });
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
    draft.tokens = extractTokensJson({ color: { bg: { $value: "#fff", $type: "color" } } });
    expect(validateSnapshot(draft)).toEqual({ ok: true });
  });

  it("is deterministic: same document in -> same tokens out", () => {
    const doc = { color: { a: { $value: "#1", $type: "color" }, b: { $value: "#2", $type: "color" } } };
    expect(extractTokensJson(doc)).toEqual(extractTokensJson(doc));
  });
});
