/**
 * Drift gate node — the design-code drift axis as a conditional node in an
 * agentic-SDLC graph (PRD §4, catalyst #6). Like the rendered-review gate node
 * (pointer), a graph routes on the drift a change INTRODUCED: `pass/warn →
 * proceed`, `block → route-to-fix`, with the fix node's back-edge being the
 * cited drift remediation ("replace the hardcoded value with the design token"),
 * and the cycle back being a re-run of the drift gate after the fix.
 *
 * It composes the fair drift delta (`diffDrift`) with the remediation projection
 * (`buildDriftRemediation`) — routing and remediation are both computed on the
 * introduced drift, never the repo's pre-existing token debt. Eyes-not-hands:
 * the back-edge cites tokens, never edits. Pure and deterministic.
 */

import {
  DEFAULT_DRIFT_GATE_POLICY,
  driftFromEntries,
  type DesignCodeDrift,
  type DriftGatePolicy,
} from "./drift.js";
import { diffDrift, type DriftDeltaOptions } from "./drift-delta.js";
import { buildDriftRemediation, type DriftRemediationPlan } from "./drift-remediation.js";

export type DriftGateRoute = "proceed" | "fix";

export type DriftGateVerdictDecision = "block" | "warn" | "pass";

export interface DriftGateNodePolicy {
  gate?: DriftGatePolicy;
  delta?: DriftDeltaOptions;
  /** Verdicts that route to the fix node. Default: only `block`. */
  routeToFixOn?: readonly DriftGateVerdictDecision[];
}

export interface DriftGateNodeResult {
  /** The drift gate decision on the INTRODUCED drift. */
  verdict: DriftGateVerdictDecision;
  /** The conditional edge: `fix` (send to the fix node) or `proceed`. */
  route: DriftGateRoute;
  /** The fix node's input — cited, blockers-first drift remediation (never a code edit). */
  remediation: DriftRemediationPlan;
  introducedCount: number;
  resolvedCount: number;
  persistingCount: number;
}

/**
 * Evaluate the drift gate node for a change: diff base vs head drift, route on
 * the introduced drift, and produce the remediation back-edge for it.
 * Deterministic. A change that only inherits pre-existing drift proceeds.
 */
export function evaluateDriftGateNode(
  base: DesignCodeDrift,
  head: DesignCodeDrift,
  policy: DriftGateNodePolicy = {},
): DriftGateNodeResult {
  const gatePolicy = policy.gate ?? DEFAULT_DRIFT_GATE_POLICY;
  const delta = diffDrift(base, head, { ...policy.delta, gatePolicy });
  const verdict = delta.verdict.decision;
  const routeToFixOn = policy.routeToFixOn ?? (["block"] as const);
  const route: DriftGateRoute = routeToFixOn.includes(verdict) ? "fix" : "proceed";

  return {
    verdict,
    route,
    remediation: buildDriftRemediation(driftFromEntries(delta.introduced), gatePolicy),
    introducedCount: delta.introduced.length,
    resolvedCount: delta.resolved.length,
    persistingCount: delta.persisting.length,
  };
}
