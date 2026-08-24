import type { Conflict, Provenance } from "@apatureai/canon-schema";

/**
 * Drift hints (#21, PRD §4/§10). Promote the `Conflict`s recorded during
 * token/component reconciliation into a customer-facing, ADVISORY drift report:
 * "the code/config declares X, but rendered reality shows Y". This is where the
 * decided "config wins the Fact, pixel disagreement becomes drift" lands.
 *
 * Drift is advisory ONLY; it never mutates the resolved snapshot or canonizes
 * the drifting value (PRD §4: this repo never writes customer code and never
 * declares a messy legacy pattern canonical without sign-off). Pure +
 * deterministic.
 */

/** A single advisory drift hint derived from a recorded conflict. */
export interface DriftHint {
  /** Logical field, e.g. "tokens.color.--brand" or "components.radix". */
  field: string;
  /** The value the resolved standard kept (the winner's value). */
  standardValue: string;
  /** Provenance of the standard (the winner). */
  standardProvenance: Provenance;
  /** The disagreeing observed value (strongest dissenter), if any. */
  driftingValue: string | null;
  /** Provenance of the disagreeing value, if any. */
  driftingProvenance: Provenance | null;
  /**
   * 0..1 strength of the drift signal: how much confidence the disagreement
   * cost the standard (the magnitude of the recorded confidenceDelta).
   */
  confidence: number;
  /** Human-readable summary, e.g. "config says #bada55 but pixels show #abcabc". */
  message: string;
  /**
   * Route this drift is scoped to, when a route-scoped reconciler produced it.
   * Lets the store suppress drift on intentionally-excepted routes (#24). Token/
   * component drifts are repo-wide and leave this undefined.
   */
  route?: string;
}

function describe(hint: Omit<DriftHint, "message">): string {
  if (hint.driftingValue === null) {
    return `${hint.field}: ${hint.standardProvenance} declares "${hint.standardValue}" but it is not observed in rendered reality (dead token)`;
  }
  return `${hint.field}: ${hint.standardProvenance} says "${hint.standardValue}" but ${hint.driftingProvenance} shows "${hint.driftingValue}"`;
}

/**
 * The candidate that actually won the value.
 *
 * `Conflict` records the winner's PROVENANCE, not its index, and two candidates
 * can legitimately share one. A Tailwind `@theme` block and a `:root` block are
 * both `code`. Taking the first match would then name the loser as the standard
 * and invert the entire hint, so this re-applies the tie-break `reconcileField`
 * used to pick the winner: within the winning provenance, highest confidence,
 * then lowest value string.
 */
function standardCandidate(conflict: Conflict): Conflict["candidates"][number] | undefined {
  return conflict.candidates
    .filter((c) => c.provenance === conflict.winner)
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
    })[0];
}

/** The strongest candidate whose value differs from the winner's value. */
function strongestDissenter(
  conflict: Conflict,
  standardValue: string,
): { value: string; provenance: Provenance } | null {
  const dissenters = conflict.candidates
    .filter((c) => c.value !== standardValue)
    .sort((a, b) => b.confidence - a.confidence);
  const top = dissenters[0];
  return top ? { value: top.value, provenance: top.provenance } : null;
}

/**
 * Derive a deterministic, advisory drift-hint list from recorded conflicts.
 * Sorted by descending drift confidence then field, so the report is stable and
 * the strongest drift surfaces first.
 */
export function computeDriftHints(conflicts: Conflict[]): DriftHint[] {
  const hints: DriftHint[] = [];

  for (const conflict of conflicts) {
    const standard = standardCandidate(conflict);
    const standardValue = standard?.value ?? "";
    const dissenter = strongestDissenter(conflict, standardValue);
    const partial: Omit<DriftHint, "message"> = {
      field: conflict.field,
      standardValue,
      standardProvenance: conflict.winner,
      driftingValue: dissenter?.value ?? null,
      driftingProvenance: dissenter?.provenance ?? null,
      confidence: Math.abs(conflict.confidenceDelta),
    };
    hints.push({ ...partial, message: describe(partial) });
  }

  return hints.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.field < b.field ? -1 : a.field > b.field ? 1 : 0;
  });
}
