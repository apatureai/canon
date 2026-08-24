import { emptyDraft, fact, validateSnapshot, type DnaTokens, type VisualDistributions } from "@apatureai/canon-schema";
import { describe, expect, it } from "vitest";
import { reconcileTokens } from "../src/index.js";

function emptyTokens(): DnaTokens {
  return { color: {}, typography: {}, spacing: {}, radii: {}, shadows: {}, breakpoints: {}, motion: {} };
}

function emptyDist(): VisualDistributions {
  return { spacingIntervals: [], typeScale: [], colorProportions: {}, radiusPatterns: [], density: null };
}

describe("reconcileTokens — confirm", () => {
  it("reinforces a declared token the rendered distribution confirms", () => {
    const tokens = emptyTokens();
    tokens.spacing["--space-4"] = fact("16px", 0.8, "config");
    const dist = { ...emptyDist(), spacingIntervals: [16] };

    const { tokens: resolved, conflicts } = reconcileTokens(tokens, dist);
    const r = resolved.spacing["--space-4"];
    expect(r?.value).toBe("16px");
    expect(r?.confidence).toBeGreaterThan(0.8); // reinforced by agreement
    expect(conflicts).toEqual([]);
  });

  it("matches color tokens case-insensitively against color proportions", () => {
    const tokens = emptyTokens();
    tokens.color["--brand"] = fact("#0A0A0A", 0.8, "config");
    const dist = { ...emptyDist(), colorProportions: { "#0a0a0a": 0.6 } };

    const { tokens: resolved, conflicts } = reconcileTokens(tokens, dist);
    expect(resolved.color["--brand"]?.confidence).toBeGreaterThan(0.8);
    expect(conflicts).toEqual([]);
  });
});

describe("reconcileTokens — contradict (dead declared token)", () => {
  it("keeps the value but degrades and records a conflict when pixels never exhibit it", () => {
    const tokens = emptyTokens();
    tokens.spacing["--space-5"] = fact("20px", 0.8, "config");
    const dist = { ...emptyDist(), spacingIntervals: [4, 8, 16] }; // 20 absent

    const { tokens: resolved, conflicts } = reconcileTokens(tokens, dist);
    const r = resolved.spacing["--space-5"];
    expect(r?.value).toBe("20px"); // value kept
    expect(r?.confidence).toBeLessThan(0.8); // degraded
    expect(conflicts.some((c) => c.field === "tokens.spacing.--space-5")).toBe(true);
  });
});

describe("reconcileTokens — pixels-only", () => {
  it("surfaces a strong rendered value with no declared token as a pixels candidate fact", () => {
    const tokens = emptyTokens(); // no declared spacing
    const dist = { ...emptyDist(), spacingIntervals: [8] };

    const { tokens: resolved } = reconcileTokens(tokens, dist);
    const candidate = resolved.spacing["pixels:8"];
    expect(candidate?.value).toBe("8");
    expect(candidate?.provenance).toBe("pixels");
    expect(candidate?.confidence).toBeGreaterThan(0);
  });

  it("never silently drops observed render values (candidates keyed by canonical color)", () => {
    const tokens = emptyTokens();
    const dist = { ...emptyDist(), colorProportions: { "#fff": 0.5, "#000": 0.5 } };
    const { tokens: resolved } = reconcileTokens(tokens, dist);
    // Keys are the canonical (shorthand-expanded) color so they match the
    // declared-token side; the observed raw form is preserved as the fact value.
    expect(Object.keys(resolved.color)).toEqual(["pixels:#000000ff", "pixels:#ffffffff"]);
    expect(resolved.color["pixels:#000000ff"]?.value).toBe("#000");
    expect(resolved.color["pixels:#ffffffff"]?.value).toBe("#fff");
  });
});

describe("reconcileTokens — passthrough + validity", () => {
  it("passes through groups the render cannot speak to (shadows/breakpoints/motion)", () => {
    const tokens = emptyTokens();
    tokens.shadows["--shadow-sm"] = fact("0 1px 2px #0001", 0.7, "code");
    const { tokens: resolved, conflicts } = reconcileTokens(tokens, emptyDist());
    expect(resolved.shadows["--shadow-sm"]).toEqual({ value: "0 1px 2px #0001", confidence: 0.7, provenance: "code" });
    expect(conflicts).toEqual([]);
  });

  it("produces tokens that validate against the schema when merged into a draft", () => {
    const tokens = emptyTokens();
    tokens.spacing["--space-4"] = fact("16px", 0.8, "config");
    const dist = { ...emptyDist(), spacingIntervals: [16], colorProportions: { "#abc": 0.9 } };
    const draft = emptyDraft("apatureai", "canon", "test");
    draft.tokens = reconcileTokens(tokens, dist).tokens;
    expect(validateSnapshot(draft)).toEqual({ ok: true });
  });

  it("is deterministic", () => {
    const tokens = emptyTokens();
    tokens.spacing["--s"] = fact("16px", 0.8, "config");
    const dist = { ...emptyDist(), spacingIntervals: [16, 8] };
    expect(reconcileTokens(tokens, dist)).toEqual(reconcileTokens(tokens, dist));
  });
});
