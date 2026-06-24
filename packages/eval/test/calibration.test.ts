import { calibrationReport, formatReliabilityTable, type ConfidencePoint } from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("calibrationReport — ECE / Brier / reliability table (#28)", () => {
  it("is total on empty input", () => {
    expect(calibrationReport([])).toEqual({ count: 0, ece: 0, mce: 0, brier: 0, bins: [] });
  });

  it("a perfectly calibrated predictor has ~0 ECE", () => {
    // In the 0.8 bin: 8 of 10 correct -> observed accuracy 0.8 == confidence.
    const points: ConfidencePoint[] = [
      ...Array.from({ length: 8 }, () => ({ confidence: 0.85, correct: true })),
      ...Array.from({ length: 2 }, () => ({ confidence: 0.85, correct: false })),
    ];
    const report = calibrationReport(points);
    expect(report.count).toBe(10);
    expect(report.ece).toBeCloseTo(0.05, 2); // |0.85 - 0.8|
    expect(report.bins).toHaveLength(1);
    expect(report.bins[0]!.observedAccuracy).toBeCloseTo(0.8, 5);
  });

  it("an overconfident predictor has high ECE", () => {
    // Claims 0.95 but is only right half the time.
    const points: ConfidencePoint[] = [
      ...Array.from({ length: 5 }, () => ({ confidence: 0.95, correct: true })),
      ...Array.from({ length: 5 }, () => ({ confidence: 0.95, correct: false })),
    ];
    const report = calibrationReport(points);
    expect(report.ece).toBeCloseTo(0.45, 2); // |0.95 - 0.5|
    expect(report.mce).toBeCloseTo(0.45, 2);
  });

  it("computes Brier as mean squared error of confidence vs outcome", () => {
    const points: ConfidencePoint[] = [
      { confidence: 1, correct: true }, // (1-1)^2 = 0
      { confidence: 0, correct: false }, // (0-0)^2 = 0
      { confidence: 0.5, correct: true }, // (0.5-1)^2 = 0.25
    ];
    expect(calibrationReport(points).brier).toBeCloseTo(0.25 / 3, 6);
  });

  it("clamps out-of-range / non-finite confidences", () => {
    const report = calibrationReport([
      { confidence: 1.5, correct: true },
      { confidence: Number.NaN, correct: false },
    ]);
    // 1.5 -> 1 (top bin), NaN -> 0 (bottom bin); both perfectly correct -> ECE 0.
    expect(report.ece).toBe(0);
    expect(report.bins).toHaveLength(2);
  });

  it("is deterministic and renders a stable reliability table", () => {
    const points: ConfidencePoint[] = [
      { confidence: 0.2, correct: false },
      { confidence: 0.9, correct: true },
    ];
    const a = formatReliabilityTable(calibrationReport(points));
    const b = formatReliabilityTable(calibrationReport(points));
    expect(a).toBe(b);
    expect(a).toContain("ECE=");
  });
});
