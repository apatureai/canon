import type { Provenance } from "@uidna/schema";

/**
 * Reconciliation thresholds — ALL tunables in one place so #28 can calibrate
 * them from labeled fixtures without touching the resolution logic. Keep this
 * the single source of truth for every magic number `reconcileField` uses.
 */

/**
 * Winning-VALUE precedence for declared-standard token kinds (higher wins).
 * This is the DECIDED ladder: human/feedback (sign-off) > config (declared) >
 * code (extracted) > pixels (observed). Pixels never silently overwrite a
 * coherent declared token; its *confidence* is computed separately (it does not
 * earn value-precedence here).
 */
export const VALUE_PRECEDENCE: Record<Provenance, number> = {
  human: 5,
  feedback: 5,
  config: 3,
  code: 2,
  pixels: 1,
};

/** Confidence a human/feedback fact resolves to when present (pre-sign-off; UD5 lifts to 1.0). */
export const HUMAN_RESOLVED_CONFIDENCE = 0.95;

/**
 * Agreement reinforcement: when two non-human sources concur on a value, the
 * resolved confidence rises above either alone by this fraction of the
 * remaining headroom toward 1.0. Bounded so it never reaches the 1.0 reserved
 * for sign-off.
 */
export const AGREEMENT_REINFORCE = 0.5;
export const MAX_REINFORCED_CONFIDENCE = 0.98;

/**
 * Disagreement degradation: when the winner and a dissenting source disagree,
 * the resolved confidence is the winner's, scaled down by the disagreement
 * margin times this weight (the winner's VALUE is kept regardless — never
 * flipped to the dissenter).
 */
export const DISAGREEMENT_DEGRADE = 0.5;
/** A resolved confidence never degrades below this floor (a kept declared value still means something). */
export const MIN_DEGRADED_CONFIDENCE = 0.1;

/** Clamp a confidence into the open band (0, 1] used everywhere here. */
export function clampConfidence(c: number): number {
  if (!Number.isFinite(c)) return 0;
  return Math.min(1, Math.max(0, c));
}
