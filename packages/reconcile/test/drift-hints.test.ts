import { fact, type Conflict, type DnaTokens, type VisualDistributions } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import { computeDriftHints, reconcileTokens } from "../src/index.js";

function emptyTokens(): DnaTokens {
  return { color: {}, typography: {}, spacing: {}, radii: {}, shadows: {}, breakpoints: {}, motion: {} };
}
function emptyDist(): VisualDistributions {
  return { spacingIntervals: [], typeScale: [], colorProportions: {}, radiusPatterns: [], density: null };
}

describe("computeDriftHints", () => {
  it("derives a hint from a value-disagreement conflict (config vs pixels)", () => {
    const conflicts: Conflict[] = [
      {
        field: "tokens.color.--brand",
        candidates: [
          { value: "#bada55", provenance: "config", confidence: 0.8 },
          { value: "#abcabc", provenance: "pixels", confidence: 0.9 },
        ],
        winner: "config",
        confidenceDelta: -0.3,
      },
    ];
    const [hint] = computeDriftHints(conflicts);
    expect(hint?.field).toBe("tokens.color.--brand");
    expect(hint?.standardValue).toBe("#bada55");
    expect(hint?.standardProvenance).toBe("config");
    expect(hint?.driftingValue).toBe("#abcabc");
    expect(hint?.driftingProvenance).toBe("pixels");
    expect(hint?.confidence).toBeCloseTo(0.3, 5);
    expect(hint?.message).toContain("config");
    expect(hint?.message).toContain("pixels");
  });

  it("describes a dead token (declared standard with no observed dissenter)", () => {
    const conflicts: Conflict[] = [
      {
        field: "tokens.spacing.--space-5",
        candidates: [{ value: "20px", provenance: "config", confidence: 0.8 }],
        winner: "config",
        confidenceDelta: -0.4,
      },
    ];
    const [hint] = computeDriftHints(conflicts);
    expect(hint?.driftingValue).toBeNull();
    expect(hint?.message).toContain("dead token");
  });

  it("orders hints by descending drift confidence then field (deterministic)", () => {
    const conflicts: Conflict[] = [
      { field: "b", candidates: [{ value: "x", provenance: "config", confidence: 0.8 }], winner: "config", confidenceDelta: -0.1 },
      { field: "a", candidates: [{ value: "y", provenance: "config", confidence: 0.8 }], winner: "config", confidenceDelta: -0.5 },
    ];
    expect(computeDriftHints(conflicts).map((h) => h.field)).toEqual(["a", "b"]);
  });

  it("is advisory: derives drift from reconcileTokens output without mutating it", () => {
    const tokens = emptyTokens();
    tokens.spacing["--space-5"] = fact("20px", 0.8, "config");
    const dist = { ...emptyDist(), spacingIntervals: [4, 8, 16] }; // 20 absent -> dead token
    const result = reconcileTokens(tokens, dist);
    const snapshotBefore = JSON.stringify(result.tokens);

    const hints = computeDriftHints(result.conflicts);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]?.field).toBe("tokens.spacing.--space-5");
    // The resolved snapshot is untouched by drift derivation (advisory only).
    expect(JSON.stringify(result.tokens)).toBe(snapshotBefore);
  });

  it("names the winning candidate when two candidates share the winning provenance", () => {
    // Two static files disagreeing about one token are BOTH `code` (a Tailwind
    // v4 @theme block at 0.7, a :root block at 0.6). The winner is decided by
    // confidence, so the hint must not simply take the first `code` candidate.
    const conflicts: Conflict[] = [
      {
        field: "tokens.color.--color-brand",
        candidates: [
          { value: "#0a58ca", provenance: "code", confidence: 0.6 },
          { value: "#2f6fed", provenance: "code", confidence: 0.7 },
        ],
        winner: "code",
        confidenceDelta: -0.21,
      },
    ];
    const [hint] = computeDriftHints(conflicts);
    expect(hint?.standardValue).toBe("#2f6fed"); // the higher-confidence code fact won
    expect(hint?.driftingValue).toBe("#0a58ca");
    expect(hint?.message).toBe(
      'tokens.color.--color-brand: code says "#2f6fed" but code shows "#0a58ca"',
    );
  });

  it("breaks a same-provenance, same-confidence tie the way reconcileField does", () => {
    const conflicts: Conflict[] = [
      {
        field: "tokens.spacing.--gap",
        candidates: [
          { value: "8px", provenance: "code", confidence: 0.6 },
          { value: "16px", provenance: "code", confidence: 0.6 },
        ],
        winner: "code",
        confidenceDelta: -0.18,
      },
    ];
    // pickWinner's final tie-break is the lowest value string: "16px" < "8px".
    expect(computeDriftHints(conflicts)[0]?.standardValue).toBe("16px");
  });

  it("returns an empty list when there are no conflicts (agreement case)", () => {
    const tokens = emptyTokens();
    tokens.spacing["--space-4"] = fact("16px", 0.8, "config");
    const dist = { ...emptyDist(), spacingIntervals: [16] }; // confirmed -> no conflict
    expect(computeDriftHints(reconcileTokens(tokens, dist).conflicts)).toEqual([]);
  });
});
