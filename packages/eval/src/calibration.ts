/**
 * Confidence calibration metrics (#28, PRD §9; mirrors verdict #107's
 * ECE/Brier calibration, but over GENOME facts, not critique findings). A
 * resolved `Fact`'s `confidence` is a probability claim: "I'm 0.8 sure this is
 * the right value." Calibration measures whether that claim holds: is a
 * 0.8-confidence fact correct ~80% of the time. Without it the precedence ladder
 * (the 0.5 to 0.9 weights in `@apatureai/canon-reconcile/thresholds`) is guessed constants.
 *
 * Pure + deterministic: same labeled predictions → same metrics. No IO, no model.
 */

/** One scored prediction: a confidence in [0,1] and whether it was actually correct. */
export interface ConfidencePoint {
  confidence: number;
  correct: boolean;
}

/** One reliability-table bin: predicted-vs-observed accuracy for a confidence band. */
export interface ReliabilityBin {
  /** Inclusive lower / exclusive upper edge (the top bin includes 1.0). */
  lower: number;
  upper: number;
  count: number;
  /** Mean predicted confidence of points in this bin. */
  meanConfidence: number;
  /** Observed fraction correct in this bin. */
  observedAccuracy: number;
}

export interface CalibrationReport {
  count: number;
  /** Expected Calibration Error: count-weighted mean |confidence − accuracy| across bins. */
  ece: number;
  /** Maximum Calibration Error: the worst single-bin gap. */
  mce: number;
  /** Brier score: mean squared error of confidence vs the 0/1 outcome (lower is better). */
  brier: number;
  /** The reliability table: non-empty bins, in ascending confidence order. */
  bins: ReliabilityBin[];
}

const DEFAULT_BINS = 10;

/** Clamp a confidence into [0,1]; non-finite → 0 (a missing claim is no claim). */
function clamp01(c: number): number {
  if (!Number.isFinite(c)) return 0;
  return Math.min(1, Math.max(0, c));
}

/** Bin index for a confidence over `binCount` equal-width bins; 1.0 lands in the top bin. */
function binIndex(confidence: number, binCount: number): number {
  const idx = Math.floor(confidence * binCount);
  return idx >= binCount ? binCount - 1 : idx;
}

/**
 * Compute ECE / MCE / Brier + the reliability table over labeled confidence
 * points. `binCount` equal-width bins (default 10). Empty input → all-zero
 * report (total on no data). Deterministic.
 */
export function calibrationReport(
  points: ConfidencePoint[],
  binCount: number = DEFAULT_BINS,
): CalibrationReport {
  if (points.length === 0) {
    return { count: 0, ece: 0, mce: 0, brier: 0, bins: [] };
  }

  const buckets: { confSum: number; correct: number; count: number }[] = Array.from(
    { length: binCount },
    () => ({ confSum: 0, correct: 0, count: 0 }),
  );

  let brierSum = 0;
  for (const p of points) {
    const c = clamp01(p.confidence);
    const outcome = p.correct ? 1 : 0;
    brierSum += (c - outcome) ** 2;
    const b = buckets[binIndex(c, binCount)]!;
    b.confSum += c;
    b.correct += outcome;
    b.count += 1;
  }

  const n = points.length;
  const bins: ReliabilityBin[] = [];
  let ece = 0;
  let mce = 0;
  for (let i = 0; i < binCount; i++) {
    const b = buckets[i]!;
    if (b.count === 0) continue;
    const meanConfidence = b.confSum / b.count;
    const observedAccuracy = b.correct / b.count;
    const gap = Math.abs(meanConfidence - observedAccuracy);
    ece += (b.count / n) * gap;
    mce = Math.max(mce, gap);
    bins.push({
      lower: i / binCount,
      upper: (i + 1) / binCount,
      count: b.count,
      meanConfidence,
      observedAccuracy,
    });
  }

  return { count: n, ece, mce, brier: brierSum / n, bins };
}

/** Render the reliability table as fixed-width text rows (for eval logs / snapshots). */
export function formatReliabilityTable(report: CalibrationReport): string {
  const header = "range        n   conf    acc    gap";
  const rows = report.bins.map((b) => {
    const range = `${b.lower.toFixed(1)}-${b.upper.toFixed(1)}`.padEnd(11);
    const n = String(b.count).padStart(4);
    const conf = b.meanConfidence.toFixed(3).padStart(7);
    const acc = b.observedAccuracy.toFixed(3).padStart(7);
    const gap = Math.abs(b.meanConfidence - b.observedAccuracy).toFixed(3).padStart(7);
    return `${range}${n}${conf}${acc}${gap}`;
  });
  const summary = `ECE=${report.ece.toFixed(4)} MCE=${report.mce.toFixed(4)} Brier=${report.brier.toFixed(4)} n=${report.count}`;
  return [header, ...rows, summary].join("\n");
}
