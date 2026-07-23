import { fact } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import { reconcileField } from "../src/index.js";

describe("reconcileField — degenerate inputs (total, never throws)", () => {
  it("returns a zero-confidence placeholder for no candidates", () => {
    const { resolved, conflicts } = reconcileField<string>("tokens.color.x", []);
    expect(resolved.confidence).toBe(0);
    expect(conflicts).toEqual([]);
  });

  it("passes a single candidate through unchanged with no conflict", () => {
    const { resolved, conflicts } = reconcileField("tokens.color.x", [fact("#fff", 0.6, "code")]);
    expect(resolved).toEqual({ value: "#fff", confidence: 0.6, provenance: "code" });
    expect(conflicts).toEqual([]);
  });
});

describe("reconcileField — winning VALUE precedence (config > code > pixels)", () => {
  it("config wins the value over code and pixels, even at lower source confidence", () => {
    const { resolved } = reconcileField("tokens.color.brand", [
      fact("#bada55", 0.6, "code"),
      fact("#c0ffee", 0.8, "config"),
      fact("#abcabc", 0.9, "pixels"),
    ]);
    expect(resolved.value).toBe("#c0ffee");
    expect(resolved.provenance).toBe("config");
  });

  it("never lets pixels overwrite a declared config value", () => {
    const { resolved } = reconcileField("tokens.spacing.gutter", [
      fact("24px", 0.8, "config"),
      fact("23px", 0.95, "pixels"),
    ]);
    expect(resolved.value).toBe("24px");
    expect(resolved.provenance).toBe("config");
  });
});

describe("reconcileField — agreement reinforces", () => {
  it("raises resolved confidence above either source when they concur", () => {
    const { resolved, conflicts } = reconcileField("tokens.color.brand", [
      fact("#bada55", 0.8, "config"),
      fact("#bada55", 0.7, "pixels"),
    ]);
    expect(resolved.value).toBe("#bada55");
    expect(resolved.confidence).toBeGreaterThan(0.8); // above the stronger source
    expect(resolved.confidence).toBeLessThan(1); // sign-off ceiling reserved
    expect(conflicts).toEqual([]);
  });

  it("never LOWERS a winner already above the reinforce ceiling (agreement can't penalize)", () => {
    const { resolved } = reconcileField("tokens.color.brand", [
      fact("#bada55", 0.99, "config"), // already above MAX_REINFORCED_CONFIDENCE (0.98)
      fact("#bada55", 0.9, "code"),
    ]);
    expect(resolved.value).toBe("#bada55");
    // Before the fix, negative headroom dragged this down to 0.98.
    expect(resolved.confidence).toBeGreaterThanOrEqual(0.99);
  });
});

describe("reconcileField — disagreement keeps config value, degrades, records conflict", () => {
  it("keeps the config value, lowers confidence, and records a Conflict (drift signal)", () => {
    const { resolved, conflicts } = reconcileField("tokens.color.brand", [
      fact("#bada55", 0.8, "config"),
      fact("#abcabc", 0.9, "pixels"),
    ]);
    expect(resolved.value).toBe("#bada55"); // NEVER flipped to pixels
    expect(resolved.provenance).toBe("config");
    expect(resolved.confidence).toBeLessThan(0.8); // degraded by the margin
    expect(conflicts).toHaveLength(1);
    const c = conflicts[0];
    expect(c?.field).toBe("tokens.color.brand");
    expect(c?.winner).toBe("config");
    expect(c?.confidenceDelta).toBeLessThan(0);
    expect(c?.candidates.map((x) => x.provenance).sort()).toEqual(["config", "pixels"]);
  });

  it("never degrades below the floor", () => {
    const { resolved } = reconcileField("tokens.color.brand", [
      fact("#bada55", 0.2, "config"),
      fact("#abcabc", 1, "pixels"),
    ]);
    expect(resolved.confidence).toBeGreaterThanOrEqual(0.1);
  });
});

describe("reconcileField — human/feedback override", () => {
  it("a human fact wins the value at high resolved confidence", () => {
    const { resolved } = reconcileField("tokens.color.brand", [
      fact("#000000", 0.9, "human"),
      fact("#bada55", 0.8, "config"),
      fact("#abcabc", 0.95, "pixels"),
    ]);
    expect(resolved.value).toBe("#000000");
    expect(resolved.provenance).toBe("human");
    expect(resolved.confidence).toBeGreaterThan(0.9);
  });

  it("still records the conflict trail when sources disagreed under a human winner", () => {
    const { conflicts } = reconcileField("tokens.color.brand", [
      fact("#000000", 0.9, "human"),
      fact("#bada55", 0.8, "config"),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.winner).toBe("human");
  });
});

describe("reconcileField — deterministic", () => {
  it("same candidates in any order -> same resolution", () => {
    const a = reconcileField("f", [fact("x", 0.8, "config"), fact("y", 0.9, "pixels")]);
    const b = reconcileField("f", [fact("y", 0.9, "pixels"), fact("x", 0.8, "config")]);
    expect(a.resolved).toEqual(b.resolved);
  });
});
