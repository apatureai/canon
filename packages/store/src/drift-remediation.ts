/**
 * Drift remediation: the agent-actionable output of the drift gate (PRD §4).
 * The drift gate says a token drifted; in the
 * AI-native loop a coding agent needs to be told precisely what to do about it.
 * This projects each gated drift entry into a cited, eyes-not-hands fix
 * instruction the agent applies ("replace the hardcoded `#3B82F6` with the
 * `color.brand.primary` token"), the design-axis analog of the rendered-review
 * fix spec.
 *
 * It stays inside the eyes-not-hands boundary by construction: a remediation
 * CITES the design token (group + name + authoritative value) and states the
 * intent; it never carries a file, selector, or code edit. The agent decides and
 * acts, then re-runs the gate.
 *
 * Partitions by the neutral gate: blocking drift (fix first) vs advisory
 * (warnings). Ignored drift is not remediated. Composes `evaluateDriftGate`
 * rather than re-deriving the classification. Pure and deterministic.
 */

import {
  evaluateDriftGate,
  DEFAULT_DRIFT_GATE_POLICY,
  type DesignCodeDrift,
  type DriftEntry,
  type DriftGatePolicy,
  type DriftKind,
  type TokenGroup,
} from "./drift.js";

/** What the agent should do about a drifted token. */
export type DriftAction = "replace_with_token" | "adopt_token" | "sanction_or_replace";

export interface DriftRemediation {
  group: TokenGroup;
  name: string;
  kind: DriftKind;
  action: DriftAction;
  /** The design's authoritative value, when known (value_mismatch / missing_in_code). */
  designValue: string | null;
  /** The code's current value, when known (value_mismatch / undocumented_in_design). */
  codeValue: string | null;
  /** Cited, agent-actionable instruction; names the token, never a code edit. */
  instruction: string;
}

export interface DriftRemediationPlan {
  /** Blocking drift, in stable group-then-name order. Remediate these first. */
  blocking: DriftRemediation[];
  /** Advisory drift (warnings), surfaced for a human / careful application. */
  advisory: DriftRemediation[];
}

const ACTION_BY_KIND: Record<DriftKind, DriftAction> = {
  value_mismatch: "replace_with_token",
  missing_in_code: "adopt_token",
  undocumented_in_design: "sanction_or_replace",
};

function instructionFor(entry: DriftEntry): string {
  const token = `${entry.group}.${entry.name}`;
  switch (entry.kind) {
    case "value_mismatch":
      return `Replace the off-token value "${entry.code}" with the ${token} design token ("${entry.design}").`;
    case "missing_in_code":
      return `Adopt the ${token} design token ("${entry.design}") — it is defined in the design system but unused in the code.`;
    case "undocumented_in_design":
      return `${token} ("${entry.code}") is not sanctioned by the design system — replace it with a design token, or add it to the design tokens if it is intentional.`;
  }
}

function toRemediation(entry: DriftEntry): DriftRemediation {
  return {
    group: entry.group,
    name: entry.name,
    kind: entry.kind,
    action: ACTION_BY_KIND[entry.kind],
    designValue: entry.design ?? null,
    codeValue: entry.code ?? null,
    instruction: instructionFor(entry),
  };
}

/**
 * Build the agent-actionable remediation plan for a drift report: the gate's
 * blocking entries as prioritized fix instructions, and the warnings as advisory.
 * Deterministic; preserves the drift report's stable group-then-name order.
 */
export function buildDriftRemediation(
  drift: DesignCodeDrift,
  policy: DriftGatePolicy = DEFAULT_DRIFT_GATE_POLICY,
): DriftRemediationPlan {
  const verdict = evaluateDriftGate(drift, policy);
  return {
    blocking: verdict.blocking.map(toRemediation),
    advisory: verdict.warnings.map(toRemediation),
  };
}

/**
 * The structural fix-item shape the cross-axis combined review aggregates.
 * Declared HERE rather than imported, so ui-dna carries no dependency on the
 * rendered-review axis; the combiner consumes any axis whose fix items match
 * this shape (structural typing / dependency inversion).
 */
export interface AxisFixItem {
  /** WHAT to fix: the cited design token `group.name` (the un-arguable anchor). */
  ref: string;
  /** The agent-actionable fix instruction. */
  instruction: string;
  /** Whether an agent can deterministically apply it (always true for drift, which is token-cited). */
  grounded: boolean;
  /** Whether it corresponds to a blocking (vs warning) drift entry. */
  blocking: boolean;
}

/**
 * Project a drift remediation plan into combined-review `AxisFixItem`s so the
 * drift axis can populate the unified cross-axis fix plan, the design-axis analog
 * of the rendered-review axis's own fix-item projection. Every drift remediation is `grounded`
 * (it cites a design token and carries a deterministic action, so an agent can
 * apply it); the gate's blocking/advisory split maps to `blocking`. The token
 * (`group.name`) is the `ref`. Blocking items first, then advisory; order otherwise
 * preserved. Pure and deterministic.
 */
export function driftRemediationToAxisFixItems(plan: DriftRemediationPlan): AxisFixItem[] {
  const toItem = (r: DriftRemediation, blocking: boolean): AxisFixItem => ({
    ref: `${r.group}.${r.name}`,
    instruction: r.instruction,
    grounded: true,
    blocking,
  });
  return [...plan.blocking.map((r) => toItem(r, true)), ...plan.advisory.map((r) => toItem(r, false))];
}
