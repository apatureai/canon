import { emptyDraft, validateSnapshot } from "@apatureai/canon-schema";
import { describe, expect, it } from "vitest";
import {
  CAPTURE_VERSION,
  computeVisualDistributions,
  sampleCaptureEvidence,
  type CaptureEvidence,
} from "../src/index.js";

const empty: CaptureEvidence = {
  captureVersion: CAPTURE_VERSION,
  engineCaptureVersion: "test-engine-0",
  provenance: "pixels",
  captures: [],
};

describe("computeVisualDistributions", () => {
  it("maps onto the canonical VisualDistributions fields", () => {
    const d = computeVisualDistributions(sampleCaptureEvidence());
    expect(d).toHaveProperty("spacingIntervals");
    expect(d).toHaveProperty("typeScale");
    expect(d).toHaveProperty("colorProportions");
    expect(d).toHaveProperty("radiusPatterns");
    expect(d).toHaveProperty("density");
  });

  it("bins type scale and radius into sorted, de-duped observed intervals", () => {
    const d = computeVisualDistributions(sampleCaptureEvidence());
    expect(d.typeScale).toEqual([14, 16]); // 16,14,16 -> sorted unique
    expect(d.radiusPatterns).toEqual([8, 12]);
  });

  it("emits color proportions that sum to ~1.0 and merge case-insensitively", () => {
    const d = computeVisualDistributions(sampleCaptureEvidence());
    // colors: #0a0a0a (x2, one upper-cased), #ffffff (x1) -> 2/3, 1/3
    expect(d.colorProportions["#0a0a0a"]).toBeCloseTo(0.667, 2);
    expect(d.colorProportions["#ffffff"]).toBeCloseTo(0.333, 2);
    const sum = Object.values(d.colorProportions).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 2);
  });

  it("computes density from elements-per-viewport, never NaN", () => {
    const d = computeVisualDistributions(sampleCaptureEvidence());
    expect(typeof d.density).toBe("number");
    expect(Number.isNaN(d.density)).toBe(false);
    expect(d.density).toBeGreaterThan(0);
  });

  it("returns null density and empty distributions for empty evidence (never invented)", () => {
    const d = computeVisualDistributions(empty);
    expect(d.density).toBeNull();
    expect(d.spacingIntervals).toEqual([]);
    expect(d.typeScale).toEqual([]);
    expect(d.radiusPatterns).toEqual([]);
    expect(d.colorProportions).toEqual({});
  });

  it("is deterministic: identical evidence -> byte-identical distributions", () => {
    const a = JSON.stringify(computeVisualDistributions(sampleCaptureEvidence()));
    const b = JSON.stringify(computeVisualDistributions(sampleCaptureEvidence()));
    expect(a).toBe(b);
  });

  it("produces a distribution that passes schema validation when merged into a draft", () => {
    const draft = emptyDraft("apatureai", "canon", "test");
    draft.distributions = computeVisualDistributions(sampleCaptureEvidence());
    expect(validateSnapshot(draft)).toEqual({ ok: true });
  });
});
