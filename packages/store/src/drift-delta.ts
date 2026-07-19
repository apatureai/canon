/**
 * Drift delta — the base-vs-head comparison that makes the drift gate FAIR
 * (PRD §4/§7, ARCHITECTURE §3). `evaluateDriftGate` blocks on every drift entry,
 * which would fail every PR on pre-existing design-code debt. A real gate blocks
 * on the drift a change **introduces**. This partitions two drift reports (the
 * base commit's design↔code drift and the head commit's) into introduced /
 * resolved / persisting, and gates on the introduced set only.
 *
 * Unlike a rendered-UI finding, a drift entry has a NATURAL stable identity —
 * its `group` + `name` + `kind` — so matching across commits needs no
 * fingerprint heuristic. The key is still an input (dependency inversion) so a
 * team can key more strictly (e.g. include the code value, so re-drifting an
 * already-drifting token to a new wrong value counts as introduced).
 *
 * Pure and deterministic: a plain function of the two drift reports + policy.
 */

import {
  DESIGN_CODE_DRIFT_VERSION,
  DEFAULT_DRIFT_GATE_POLICY,
  evaluateDriftGate,
  type DesignCodeDrift,
  type DriftEntry,
  type DriftKind,
  type DriftGatePolicy,
  type DriftGateVerdict,
} from "./drift.js";

/** A stable-across-commits identity for a drift entry. */
export type DriftKey = (entry: DriftEntry) => string;

/** Keys on the drift LOCATION and kind — a token that was already drifting the
 * same way is pre-existing debt, even if its exact off-token value changed. */
export const defaultDriftKey: DriftKey = (e) => `${e.group}|${e.name}|${e.kind}`;

export interface DriftDeltaOptions {
  keyOf?: DriftKey;
  gatePolicy?: DriftGatePolicy;
}

export interface DriftDelta {
  /** Drift present at head but not base — what THIS change introduced. */
  introduced: DriftEntry[];
  /** Drift present at base but not head — what it fixed. */
  resolved: DriftEntry[];
  /** Drift present in both — pre-existing debt, not this change's fault. */
  persisting: DriftEntry[];
  /**
   * The gate verdict computed on the INTRODUCED entries only — the fair CI
   * outcome. A change that only inherits pre-existing drift does not block.
   */
  verdict: DriftGateVerdict;
}

/** Wrap a bare entry list as a DesignCodeDrift so the existing gate can score it. */
function driftFromEntries(entries: DriftEntry[]): DesignCodeDrift {
  const count = (k: DriftKind): number => entries.reduce((n, e) => (e.kind === k ? n + 1 : n), 0);
  return {
    driftModelVersion: DESIGN_CODE_DRIFT_VERSION,
    entries,
    summary: {
      aligned: 0,
      valueMismatch: count("value_mismatch"),
      missingInCode: count("missing_in_code"),
      undocumentedInDesign: count("undocumented_in_design"),
    },
    conformant: entries.length === 0,
  };
}

/**
 * Diff two drift reports (base commit vs head commit) and gate on the introduced
 * set. Deterministic: partitions preserve head/base entry order; multiset
 * matching cancels each base entry against at most one head entry of the same
 * key, so a change that touches an already-drifting token is not double-blamed.
 */
export function diffDrift(
  base: DesignCodeDrift,
  head: DesignCodeDrift,
  options: DriftDeltaOptions = {},
): DriftDelta {
  const key = options.keyOf ?? defaultDriftKey;

  const baseRemaining = new Map<string, number>();
  for (const e of base.entries) baseRemaining.set(key(e), (baseRemaining.get(key(e)) ?? 0) + 1);

  const introduced: DriftEntry[] = [];
  const persisting: DriftEntry[] = [];
  for (const e of head.entries) {
    const k = key(e);
    const n = baseRemaining.get(k) ?? 0;
    if (n > 0) {
      baseRemaining.set(k, n - 1);
      persisting.push(e);
    } else {
      introduced.push(e);
    }
  }

  const consumed = new Map<string, number>();
  for (const e of persisting) consumed.set(key(e), (consumed.get(key(e)) ?? 0) + 1);
  const resolved: DriftEntry[] = [];
  for (const e of base.entries) {
    const k = key(e);
    const c = consumed.get(k) ?? 0;
    if (c > 0) consumed.set(k, c - 1);
    else resolved.push(e);
  }

  return {
    introduced,
    resolved,
    persisting,
    verdict: evaluateDriftGate(driftFromEntries(introduced), options.gatePolicy ?? DEFAULT_DRIFT_GATE_POLICY),
  };
}
