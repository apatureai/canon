import { fact, type DnaTokens, type VisualDistributions } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import { canonicalTokenValue, clampDelta, reconcileTokens } from "../src/index.js";

function emptyTokens(): DnaTokens {
  return { color: {}, typography: {}, spacing: {}, radii: {}, shadows: {}, breakpoints: {}, motion: {} };
}

function emptyDist(): VisualDistributions {
  return { spacingIntervals: [], typeScale: [], colorProportions: {}, radiusPatterns: [], density: null };
}

describe("canonicalTokenValue — hex shorthand (#37)", () => {
  it("expands 3-digit hex shorthand so #FFF == #ffffff", () => {
    expect(canonicalTokenValue("color", "#FFF")).toBe("#ffffff");
    expect(canonicalTokenValue("color", "#ffffff")).toBe("#ffffff");
    expect(canonicalTokenValue("color", "#FFF")).toBe(canonicalTokenValue("color", "#ffffff"));
  });

  it("expands 4-digit (with alpha) shorthand #abcd -> #aabbccdd", () => {
    expect(canonicalTokenValue("color", "#abcd")).toBe("#aabbccdd");
  });

  it("leaves full-length hex and non-hex untouched (lowercased/trimmed)", () => {
    expect(canonicalTokenValue("color", "  #0A0A0A ")).toBe("#0a0a0a");
    expect(canonicalTokenValue("color", "rebeccapurple")).toBe("rebeccapurple");
  });
});

describe("canonicalTokenValue — unit normalization (#37)", () => {
  it("normalizes rem/em to px so 1rem == 16 == 16px", () => {
    expect(canonicalTokenValue("spacing", "1rem")).toBe("16");
    expect(canonicalTokenValue("spacing", "16px")).toBe("16");
    expect(canonicalTokenValue("spacing", "16")).toBe("16");
    expect(canonicalTokenValue("spacing", "1em")).toBe("16");
  });

  it("normalizes the number form so 16 == 16.0", () => {
    expect(canonicalTokenValue("spacing", "16.0px")).toBe("16");
  });

  it("keeps a bare number for an unrecognized unit (errs toward conflict, not a false match)", () => {
    expect(canonicalTokenValue("spacing", "10vh")).toBe("10");
  });
});

describe("reconcileTokens — shorthand/units don't read as false disagreements (#37)", () => {
  it("a #FFF declared token is CONFIRMED by an #ffffff rendered color (no conflict)", () => {
    const tokens = emptyTokens();
    tokens.color["--bg"] = fact("#FFF", 0.8, "config");
    const dist = { ...emptyDist(), colorProportions: { "#ffffff": 0.6 } };

    const { tokens: resolved, conflicts } = reconcileTokens(tokens, dist);
    expect(resolved.color["--bg"]?.value).toBe("#FFF"); // declared form kept
    expect(resolved.color["--bg"]?.confidence).toBeGreaterThan(0.8); // reinforced
    expect(conflicts).toEqual([]);
  });

  it("a 1rem declared spacing token is CONFIRMED by a 16px rendered interval (no conflict)", () => {
    const tokens = emptyTokens();
    tokens.spacing["--gap"] = fact("1rem", 0.8, "config");
    const dist = { ...emptyDist(), spacingIntervals: [16] };

    const { tokens: resolved, conflicts } = reconcileTokens(tokens, dist);
    expect(resolved.spacing["--gap"]?.value).toBe("1rem");
    expect(resolved.spacing["--gap"]?.confidence).toBeGreaterThan(0.8);
    expect(conflicts).toEqual([]);
  });

  // The reverse of the #37 case: the shorthand is on the RENDERED side. This
  // direction was silently broken — the pixels-fact key was only lowercased, not
  // shorthand-expanded like the declared side — so a rendered #fff never matched
  // a declared longhand token and was mis-reported as a dead token.
  it("a #ffffff declared token is CONFIRMED by a rendered shorthand #fff (no conflict)", () => {
    const tokens = emptyTokens();
    tokens.color["--bg"] = fact("#ffffff", 0.8, "config");
    const dist = { ...emptyDist(), colorProportions: { "#fff": 0.6 } };

    const { tokens: resolved, conflicts } = reconcileTokens(tokens, dist);
    expect(resolved.color["--bg"]?.value).toBe("#ffffff"); // declared form kept
    expect(resolved.color["--bg"]?.confidence).toBeGreaterThan(0.8); // reinforced
    expect(conflicts).toEqual([]);
  });

  it("a #fff declared token is CONFIRMED by an identical rendered shorthand #FFF (no false dead token)", () => {
    const tokens = emptyTokens();
    tokens.color["--bg"] = fact("#fff", 0.8, "config");
    const dist = { ...emptyDist(), colorProportions: { "#FFF": 0.6 } };

    const { tokens: resolved, conflicts } = reconcileTokens(tokens, dist);
    expect(resolved.color["--bg"]?.confidence).toBeGreaterThan(0.8);
    expect(conflicts).toEqual([]);
  });

  it("aggregates a shorthand and its longhand rendered form into one pixels candidate", () => {
    const tokens = emptyTokens(); // no declared color
    const dist = { ...emptyDist(), colorProportions: { "#fff": 0.3, "#ffffff": 0.3 } };

    const { tokens: resolved } = reconcileTokens(tokens, dist);
    // Both forms collapse to one canonical candidate; shares sum (0.3 + 0.3).
    expect(Object.keys(resolved.color)).toEqual(["pixels:#ffffff"]);
    const combined = reconcileTokens(
      emptyTokens(),
      { ...emptyDist(), colorProportions: { "#ffffff": 0.6 } },
    ).tokens.color["pixels:#ffffff"];
    expect(resolved.color["pixels:#ffffff"]?.confidence).toBe(combined?.confidence);
  });
});

describe("clampDelta — defensive Conflict.confidenceDelta clamp (#37)", () => {
  it("collapses a non-finite delta to 0 and clamps into [-1, 1]", () => {
    expect(clampDelta(Number.NaN)).toBe(0);
    expect(clampDelta(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampDelta(2)).toBe(1);
    expect(clampDelta(-2)).toBe(-1);
    expect(clampDelta(-0.3)).toBeCloseTo(-0.3, 10);
  });

  it("recorded conflict deltas stay within [-1, 0] for a degraded dead token", () => {
    const tokens = emptyTokens();
    tokens.spacing["--dead"] = fact("13px", 0.8, "config");
    const dist = { ...emptyDist(), spacingIntervals: [8, 16] }; // 13 absent
    const { conflicts } = reconcileTokens(tokens, dist);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.confidenceDelta).toBeGreaterThanOrEqual(-1);
    expect(conflicts[0]!.confidenceDelta).toBeLessThanOrEqual(0);
  });
});
