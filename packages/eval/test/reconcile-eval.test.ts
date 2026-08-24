import {
  checkReconcileGate,
  evaluateReconciliation,
  type LabeledReconcileFixture,
  type ReconcileGate,
} from "../src/index.js";
import { LABELED_FIXTURES } from "./fixtures/reconcile-labeled.js";
import { fact } from "@apatureai/canon-schema";
import { emptyDistributions, emptyTokens } from "../src/index.js";
import { describe, expect, it } from "vitest";

/**
 * The CI gate floor for the FROZEN fixture set. Precision/recall/conflict-recall
 * are at 1.0 on these synthetic cases (reconciliation picks the right value and
 * flags the right conflicts). ECE is deliberately a CEILING, not a tight floor:
 * on a tiny all-correct synthetic set the resolved confidences (degraded dead
 * tokens, reinforced agreements) read as underconfident, so ECE is high. The
 * production gate needs REAL customer labels with mixed correctness (PRD §9,
 * like #9) before ECE can be tightened to a meaningful real-world target.
 */
const GATE: ReconcileGate = {
  minPrecision: 1,
  minRecall: 1,
  minConflictRecall: 1,
  maxEce: 0.4,
};

describe("evaluateReconciliation — accuracy + calibration over labeled fixtures (#28)", () => {
  it("the frozen fixture set passes the CI gate floor", () => {
    const report = evaluateReconciliation(LABELED_FIXTURES);
    const result = checkReconcileGate(report, GATE);
    expect(result.ok, result.ok ? "" : (result as { failures: string[] }).failures.join("; ")).toBe(true);
  });

  it("resolves every labeled fact correctly on the frozen set (precision = recall = 1)", () => {
    const { accuracy } = evaluateReconciliation(LABELED_FIXTURES);
    expect(accuracy.precision).toBe(1);
    expect(accuracy.recall).toBe(1);
    expect(accuracy.labeled).toBe(7);
  });

  it("catches every expected conflict (dead tokens + human-vs-pixels disagreement)", () => {
    const { accuracy } = evaluateReconciliation(LABELED_FIXTURES);
    expect(accuracy.conflictsExpected).toBe(3);
    expect(accuracy.conflictRecall).toBe(1);
  });

  it("produces a non-empty reliability table (confidence is being measured)", () => {
    const { calibration } = evaluateReconciliation(LABELED_FIXTURES);
    expect(calibration.count).toBe(7);
    expect(calibration.bins.length).toBeGreaterThan(0);
  });

  it("reports per-fixture accuracy in fixture order (for regression drill-down)", () => {
    const { perFixture } = evaluateReconciliation(LABELED_FIXTURES);
    expect(perFixture.map((f) => f.name)).toEqual([
      "agreement-confirmed",
      "dead-declared-token",
      "pass-through-non-render-backed",
      "human-override",
    ]);
  });

  it("FAILS the gate on a wrong resolved value (precision drop is caught)", () => {
    // A fixture mislabeled so the resolved value won't match -> precision < 1.
    const wrong: LabeledReconcileFixture = {
      name: "wrong-value",
      codeTokens: (() => {
        const t = emptyTokens();
        t.color["--brand"] = fact("#0a0a0a", 0.8, "config");
        return t;
      })(),
      distributions: emptyDistributions(),
      labels: [{ field: "tokens.color.--brand", expectedValue: "#different", expectConflict: false }],
    };
    const report = evaluateReconciliation([wrong]);
    expect(report.accuracy.precision).toBe(0);
    const result = checkReconcileGate(report, GATE);
    expect(result.ok).toBe(false);
    expect((result as { failures: string[] }).failures.some((f) => f.includes("precision"))).toBe(true);
  });

  it("FAILS the gate when an expected conflict is missed (conflict recall drop)", () => {
    // Agreement case mislabeled as expecting a conflict -> none flagged -> recall < 1.
    const missed: LabeledReconcileFixture = {
      name: "missed-conflict",
      codeTokens: (() => {
        const t = emptyTokens();
        t.color["--brand"] = fact("#0a0a0a", 0.8, "config");
        return t;
      })(),
      distributions: (() => {
        const d = emptyDistributions();
        d.colorProportions = { "#0a0a0a": 0.7 };
        return d;
      })(),
      labels: [{ field: "tokens.color.--brand", expectedValue: "#0a0a0a", expectConflict: true }],
    };
    const report = evaluateReconciliation([missed]);
    expect(report.accuracy.conflictRecall).toBe(0);
    expect(checkReconcileGate(report, GATE).ok).toBe(false);
  });

  it("is deterministic over the frozen fixture set", () => {
    const a = evaluateReconciliation(LABELED_FIXTURES);
    const b = evaluateReconciliation(LABELED_FIXTURES);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
