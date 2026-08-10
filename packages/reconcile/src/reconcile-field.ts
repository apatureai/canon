import type { Conflict, Fact, Provenance } from "@uidna/schema";
import {
  AGREEMENT_REINFORCE,
  clampConfidence,
  clampDelta,
  DISAGREEMENT_DEGRADE,
  HUMAN_RESOLVED_CONFIDENCE,
  MAX_REINFORCED_CONFIDENCE,
  MIN_DEGRADED_CONFIDENCE,
  VALUE_PRECEDENCE,
} from "./thresholds.js";

/**
 * Reconcile multiple evidence candidates for ONE logical field into a single
 * resolved `Fact<T>` plus a recorded conflict trail (PRD §5/§7; the decided
 * reconciliation conflict model).
 *
 * The DECIDED rule (a value/confidence SPLIT, not flat "config wins"):
 * - A human/feedback fact always wins the VALUE (sign-off tops the ladder).
 * - Otherwise the winning VALUE is the highest `VALUE_PRECEDENCE` candidate
 *   (config > code > pixels); pixels NEVER silently overwrite a declared token.
 * - AGREEMENT (another source concurs on the winner's value) REINFORCES: the
 *   resolved confidence rises above any single source.
 * - DISAGREEMENT keeps the winner's VALUE but DEGRADES the resolved confidence
 *   by the disagreement margin, and records a `Conflict` (the drift signal #21
 *   turns into a hint). The winner is NEVER flipped to the dissenter.
 *
 * Pure, deterministic, total: ties break by stable provenance precedence then
 * value; never throws on an empty or single-candidate input.
 */
export interface ReconcileResult<T> {
  resolved: Fact<T>;
  conflicts: Conflict[];
}

function precedence(p: Provenance): number {
  return VALUE_PRECEDENCE[p];
}

/** Stable winner pick: highest value-precedence, then highest confidence, then value string. */
function pickWinner<T>(candidates: Fact<T>[]): Fact<T> {
  return [...candidates].sort((a, b) => {
    if (precedence(b.provenance) !== precedence(a.provenance)) {
      return precedence(b.provenance) - precedence(a.provenance);
    }
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return String(a.value) < String(b.value) ? -1 : String(a.value) > String(b.value) ? 1 : 0;
  })[0] as Fact<T>;
}

function sameValue<T>(a: T, b: T): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function toCandidateRecord<T>(f: Fact<T>): Conflict["candidates"][number] {
  return { value: String(f.value), provenance: f.provenance, confidence: f.confidence };
}

export function reconcileField<T>(field: string, candidates: Fact<T>[]): ReconcileResult<T> {
  // Total on degenerate inputs.
  if (candidates.length === 0) {
    return { resolved: { value: undefined as T, confidence: 0, provenance: "code" }, conflicts: [] };
  }
  if (candidates.length === 1) {
    return { resolved: { ...(candidates[0] as Fact<T>) }, conflicts: [] };
  }

  const winner = pickWinner(candidates);

  // A human/feedback fact wins outright at a fixed resolved confidence; any
  // other source that disagrees is still recorded so the trail is complete.
  const humanWins = winner.provenance === "human" || winner.provenance === "feedback";

  const agreers = candidates.filter((c) => c !== winner && sameValue(c.value, winner.value));
  const dissenters = candidates.filter((c) => c !== winner && !sameValue(c.value, winner.value));

  let confidence: number;
  if (humanWins) {
    confidence = HUMAN_RESOLVED_CONFIDENCE;
  } else if (dissenters.length > 0) {
    // Degrade by the margin to the strongest dissenter (kept value, lowered trust).
    const topDissent = Math.max(...dissenters.map((d) => d.confidence));
    const margin = clampConfidence(topDissent); // 0..1 strength of the disagreement
    confidence = Math.max(
      MIN_DEGRADED_CONFIDENCE,
      winner.confidence * (1 - DISAGREEMENT_DEGRADE * margin),
    );
  } else if (agreers.length > 0) {
    // Reinforce above the winner toward (but never reaching) the sign-off ceiling.
    // Never LOWER it: when the winner is already above the reinforce ceiling the
    // headroom is negative, so floor at the winner's own confidence. Agreement
    // must never penalize a high-confidence value.
    const headroom = MAX_REINFORCED_CONFIDENCE - winner.confidence;
    confidence = Math.max(
      winner.confidence,
      Math.min(MAX_REINFORCED_CONFIDENCE, winner.confidence + headroom * AGREEMENT_REINFORCE),
    );
  } else {
    confidence = winner.confidence;
  }
  confidence = clampConfidence(confidence);

  const resolved: Fact<T> = { value: winner.value, confidence, provenance: winner.provenance };

  const conflicts: Conflict[] =
    dissenters.length > 0
      ? [
          {
            field,
            candidates: candidates.map(toCandidateRecord),
            winner: winner.provenance,
            confidenceDelta: clampDelta(clampConfidence(confidence) - winner.confidence),
          },
        ]
      : [];

  return { resolved, conflicts };
}
