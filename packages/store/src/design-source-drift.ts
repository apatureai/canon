/**
 * Design-source drift gate, the end-to-end capability (PRD §4/§7). Given a
 * raw design-tool token export (a DTCG
 * document from Figma / Tokens Studio / etc.) and the code's extracted genome,
 * decide the design↔code conformance gate: "the code uses `#3B82F6` but the
 * design system defines `color.brand.primary = #2563EB`. Off-token."
 *
 * It composes the pieces that already exist rather than re-deriving them:
 *   - `extractTokensJsonWithDiagnostics` (@apatureai/canon-context) parses the DTCG export
 *     into a `DnaTokens` design genome, with per-token diagnostics;
 *   - `computeDesignCodeDrift` computes asymmetric design-authoritative drift;
 *   - `evaluateDriftGate` applies the neutral block/warn/pass gate;
 *   - `diffDrift` takes the fair base-vs-head delta.
 *
 * The one thing a bare composition would miss, and the reason this is a function
 * and not a one-liner: it must REFUSE to gate on a fundamentally malformed export.
 * If the export isn't a usable token document, `extractTokensJson` yields an
 * empty genome, and gating an empty design against real code would flag EVERY
 * token as `undocumented_in_design`, a loud and misleading verdict. So a blocking
 * diagnostic (`invalid_document` / `invalid_structure`) returns a typed refusal
 * instead. Non-blocking, per-token diagnostics (an unresolved alias, a bad value)
 * abstain that token and are surfaced, never silently dropped.
 *
 * Pure and deterministic: a plain function of the export + genome + policy.
 */

import type { DnaTokens } from "@apatureai/canon-schema";
import {
  extractTokensJsonWithDiagnostics,
  type TokenDiagnostic,
  type TokenDiagnosticCode,
} from "@apatureai/canon-context";
import {
  computeDesignCodeDrift,
  evaluateDriftGate,
  DEFAULT_DRIFT_GATE_POLICY,
  type DesignCodeDrift,
  type DriftGatePolicy,
  type DriftGateVerdict,
} from "./drift.js";
import { diffDrift, type DriftDelta, type DriftDeltaOptions } from "./drift-delta.js";

/**
 * Diagnostics that mean the export is not a usable token document at all (as
 * opposed to a single token that failed to resolve). Gating on the empty genome
 * these produce would be misleading, so the gate refuses instead.
 */
export const BLOCKING_DESIGN_DIAGNOSTICS: ReadonlySet<TokenDiagnosticCode> = new Set<TokenDiagnosticCode>([
  "invalid_document",
  "invalid_structure",
]);

function isUsableExport(diagnostics: readonly TokenDiagnostic[]): boolean {
  return !diagnostics.some((d) => BLOCKING_DESIGN_DIAGNOSTICS.has(d.code));
}

/** The design export could not be used as a token source; no gate was run. */
export interface InvalidDesignSource {
  status: "invalid_design_source";
  diagnostics: TokenDiagnostic[];
}

export interface DesignSourceGate {
  status: "gated";
  drift: DesignCodeDrift;
  verdict: DriftGateVerdict;
  /** Non-blocking per-token diagnostics (abstained tokens), surfaced not hidden. */
  diagnostics: TokenDiagnostic[];
}

export type DesignSourceDriftOutcome = DesignSourceGate | InvalidDesignSource;

/**
 * Parse a design-tool DTCG export and gate the code genome's drift against it.
 * Returns `invalid_design_source` (with diagnostics) when the export is not a
 * usable token document; otherwise the drift report + neutral gate verdict.
 */
export function reviewDesignSourceDrift(
  designExport: unknown,
  code: DnaTokens,
  policy: DriftGatePolicy = DEFAULT_DRIFT_GATE_POLICY,
): DesignSourceDriftOutcome {
  const { tokens: design, diagnostics } = extractTokensJsonWithDiagnostics(designExport);
  if (!isUsableExport(diagnostics)) {
    return { status: "invalid_design_source", diagnostics };
  }
  const drift = computeDesignCodeDrift(design, code);
  return { status: "gated", drift, verdict: evaluateDriftGate(drift, policy), diagnostics };
}

export interface DesignSourceDriftDelta {
  status: "delta";
  delta: DriftDelta;
  diagnostics: TokenDiagnostic[];
}

export type DesignSourceDriftDeltaOutcome = DesignSourceDriftDelta | InvalidDesignSource;

/**
 * The FAIR variant: parse the (authoritative) design export once, compute drift
 * for the base and head code genomes against it, and diff them so the gate fires
 * only on drift the change INTRODUCED (never on pre-existing design-code debt).
 */
export function reviewDesignSourceDriftDelta(
  designExport: unknown,
  baseCode: DnaTokens,
  headCode: DnaTokens,
  options: DriftDeltaOptions = {},
): DesignSourceDriftDeltaOutcome {
  const { tokens: design, diagnostics } = extractTokensJsonWithDiagnostics(designExport);
  if (!isUsableExport(diagnostics)) {
    return { status: "invalid_design_source", diagnostics };
  }
  const base = computeDesignCodeDrift(design, baseCode);
  const head = computeDesignCodeDrift(design, headCode);
  return { status: "delta", delta: diffDrift(base, head, options), diagnostics };
}
