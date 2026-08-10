import type { Conflict, DnaTokens, Fact } from "@uidna/schema";
import { reconcileTokens } from "@uidna/reconcile";
import { calibrationReport, type CalibrationReport, type ConfidencePoint } from "./calibration.js";
import type { FieldLabel, LabeledReconcileFixture } from "./labeled-fixture.js";

/**
 * Reconciliation accuracy + calibration eval (#28, PRD §9). Runs
 * `reconcileTokens` over LABELED fixtures and measures whether reconciliation
 * produces the CORRECT resolved facts and well-calibrated confidence, so the
 * genome can be trusted downstream:
 *
 * - resolved-fact PRECISION / RECALL vs the human-confirmed labels,
 * - conflict-detection RECALL (did we flag the conflicts the labels say exist),
 * - confidence CALIBRATION (ECE / Brier) over every labeled resolved fact.
 *
 * The output informs the precedence ladder (#18): the weights become measured.
 * Pure + deterministic + offline: no live capture or model, so it can gate CI.
 */

/** Every resolved token field flattened to `field -> Fact`, matching label keys. */
function flattenResolved(tokens: DnaTokens): Map<string, Fact<string>> {
  const out = new Map<string, Fact<string>>();
  for (const group of Object.keys(tokens) as (keyof DnaTokens)[]) {
    for (const [name, f] of Object.entries(tokens[group])) {
      out.set(`tokens.${group}.${name}`, f);
    }
  }
  return out;
}

export interface ReconcileAccuracy {
  /** Labeled fields that reconciliation actually produced (denominator for precision). */
  predicted: number;
  /** Labeled fields total (denominator for recall). */
  labeled: number;
  /** Predicted fields whose resolved value matched the label. */
  correct: number;
  /** correct / predicted: when we resolve a labeled field, how often is the value right. */
  precision: number;
  /** correct / labeled. Of all labeled fields, how many we resolved correctly. */
  recall: number;
  /** Labeled fields expecting a conflict (denominator for conflict recall). */
  conflictsExpected: number;
  /** Of those, how many reconciliation actually flagged. */
  conflictsCaught: number;
  /** conflictsCaught / conflictsExpected (1 when none expected). */
  conflictRecall: number;
}

export interface ReconcileEvalReport {
  accuracy: ReconcileAccuracy;
  calibration: CalibrationReport;
  /** Per-fixture accuracy, in fixture order, for drilling into a regression. */
  perFixture: { name: string; accuracy: ReconcileAccuracy }[];
}

function emptyAccuracy(): {
  predicted: number;
  labeled: number;
  correct: number;
  conflictsExpected: number;
  conflictsCaught: number;
} {
  return { predicted: 0, labeled: 0, correct: 0, conflictsExpected: 0, conflictsCaught: 0 };
}

function finalizeAccuracy(a: ReturnType<typeof emptyAccuracy>): ReconcileAccuracy {
  return {
    ...a,
    precision: a.predicted === 0 ? 0 : a.correct / a.predicted,
    recall: a.labeled === 0 ? 0 : a.correct / a.labeled,
    conflictRecall: a.conflictsExpected === 0 ? 1 : a.conflictsCaught / a.conflictsExpected,
  };
}

/** Score one fixture: returns its accuracy tally + the calibration points it contributes. */
function scoreFixture(
  fixture: LabeledReconcileFixture,
): { tally: ReturnType<typeof emptyAccuracy>; points: ConfidencePoint[] } {
  const { tokens, conflicts } = reconcileTokens(fixture.codeTokens, fixture.distributions);
  const resolved = flattenResolved(tokens);
  const conflictFields = new Set(conflicts.map((c: Conflict) => c.field));

  const tally = emptyAccuracy();
  const points: ConfidencePoint[] = [];

  for (const label of fixture.labels as FieldLabel[]) {
    tally.labeled++;
    if (label.expectConflict) tally.conflictsExpected++;
    if (label.expectConflict && conflictFields.has(label.field)) tally.conflictsCaught++;

    const fact = resolved.get(label.field);
    if (!fact) continue; // labeled field not resolved: missed (hurts recall, not precision)
    tally.predicted++;
    const isCorrect = fact.value === label.expectedValue;
    if (isCorrect) tally.correct++;
    // Every resolved labeled fact is a calibration point: its confidence claim
    // vs whether the resolved value was actually right.
    points.push({ confidence: fact.confidence, correct: isCorrect });
  }

  return { tally, points };
}

/**
 * Evaluate reconciliation over a labeled fixture set: aggregate accuracy +
 * conflict recall + a confidence calibration report, plus per-fixture accuracy.
 * Deterministic. `binCount` sets the reliability-table resolution.
 */
export function evaluateReconciliation(
  fixtures: LabeledReconcileFixture[],
  binCount?: number,
): ReconcileEvalReport {
  const total = emptyAccuracy();
  const allPoints: ConfidencePoint[] = [];
  const perFixture: { name: string; accuracy: ReconcileAccuracy }[] = [];

  for (const fixture of fixtures) {
    const { tally, points } = scoreFixture(fixture);
    perFixture.push({ name: fixture.name, accuracy: finalizeAccuracy(tally) });
    total.predicted += tally.predicted;
    total.labeled += tally.labeled;
    total.correct += tally.correct;
    total.conflictsExpected += tally.conflictsExpected;
    total.conflictsCaught += tally.conflictsCaught;
    allPoints.push(...points);
  }

  return {
    accuracy: finalizeAccuracy(total),
    calibration: calibrationReport(allPoints, binCount),
    perFixture,
  };
}

/** A CI gate floor: minimum precision/recall/conflict-recall and a max ECE. */
export interface ReconcileGate {
  minPrecision: number;
  minRecall: number;
  minConflictRecall: number;
  maxEce: number;
}

export type GateResult = { ok: true } | { ok: false; failures: string[] };

/**
 * Check an eval report against a gate floor (#28 acceptance: a CI floor on
 * reconciliation precision + calibration error over the FROZEN fixture set).
 * Returns the specific failures so CI can print exactly what regressed.
 */
export function checkReconcileGate(report: ReconcileEvalReport, gate: ReconcileGate): GateResult {
  const failures: string[] = [];
  const { precision, recall, conflictRecall } = report.accuracy;
  const { ece } = report.calibration;

  if (precision < gate.minPrecision) {
    failures.push(`precision ${precision.toFixed(4)} < floor ${gate.minPrecision}`);
  }
  if (recall < gate.minRecall) {
    failures.push(`recall ${recall.toFixed(4)} < floor ${gate.minRecall}`);
  }
  if (conflictRecall < gate.minConflictRecall) {
    failures.push(`conflictRecall ${conflictRecall.toFixed(4)} < floor ${gate.minConflictRecall}`);
  }
  if (ece > gate.maxEce) {
    failures.push(`ECE ${ece.toFixed(4)} > ceiling ${gate.maxEce}`);
  }

  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}
