/**
 * Design-source provenance enforcement (decision D2, PRD §4/§7).
 * The design↔code drift gate is only as authoritative
 * as the design export it grounds against. A drift finding says "the code uses
 * `#3B82F6` but the design system defines `color.brand.primary = #2563EB`". But
 * *says who?* If the export's origin is unverified (an arbitrary DTCG file, not
 * the team's actual design source of truth), the finding is arguable and must not
 * fail a PR. D2 makes that enforceable: the drift gate keeps BLOCKING authority
 * only when the design export's provenance meets a required verification bar.
 *
 * Mirrors the D1 citation-gate principle exactly: provenance can only ever
 * REMOVE gating authority from an under-verified review; it never ADDS a block.
 * Below the bar, the caller chooses `advisory` (keep the findings, cap the
 * verdict at `warn` so it surfaces but never fails the PR) or `refuse` (don't
 * gate at all, return `unverified_design_source`).
 *
 * Dependency-inverted: it takes the drift gate's OUTPUT (`DesignSourceGate`, from
 * `reviewDesignSourceDrift`) plus a provenance descriptor the CALLER establishes
 * (a connector/CI asserts the origin; this module does not verify signatures) and
 * enforces the policy over it. No parse, no I/O: pure and deterministic. A
 * malformed export (`invalid_design_source`) is passed through untouched: it was
 * never gated, so provenance is moot.
 */

import type {
  DesignSourceDriftDelta,
  DesignSourceDriftDeltaOutcome,
  DesignSourceDriftOutcome,
  DesignSourceGate,
  InvalidDesignSource,
} from "./design-source-drift.js";
import type { DriftGateVerdict } from "./drift.js";

/**
 * How the design export's origin was established, weakest → strongest:
 *   - `unverified`: origin unknown (an arbitrary document);
 *   - `declared`:   the caller declared a source id, but it is not verified;
 *   - `attested`:   a trusted connector/CI asserted the origin (e.g. the Figma
 *     app auth'd to the team's file, a signed CI step);
 *   - `signed`:     a cryptographic attestation binds the bytes to the source.
 */
export type ProvenanceVerification = "unverified" | "declared" | "attested" | "signed";

/** Descriptor of where a design export came from and how strongly that is known. */
export interface DesignSourceProvenance {
  /** Stable id of the design source of truth (e.g. a Figma file key, a repo path). */
  sourceId: string;
  /** How strongly the export's origin is established. */
  verification: ProvenanceVerification;
  /** Optional content digest binding the export bytes to the source. */
  contentDigest?: string;
}

const VERIFICATION_RANK: Record<ProvenanceVerification, number> = {
  unverified: 0,
  declared: 1,
  attested: 2,
  signed: 3,
};

export interface DesignSourceProvenancePolicy {
  /** Minimum verification level for the drift gate to KEEP blocking authority. */
  minVerification: Exclude<ProvenanceVerification, "unverified">;
  /**
   * What to do when provenance is below the bar:
   *   - `advisory`: keep the drift findings but cap the verdict at `warn` (never
   *     fail the PR on an under-verified design source);
   *   - `refuse`:   do not gate; return `unverified_design_source`.
   */
  belowBar: "advisory" | "refuse";
}

/** Require an attested origin, and merely soften (not drop) below the bar. */
export const DEFAULT_PROVENANCE_POLICY: DesignSourceProvenancePolicy = {
  minVerification: "attested",
  belowBar: "advisory",
};

/** Whether a provenance descriptor meets (or exceeds) the policy's verification bar. */
export function provenanceMeetsBar(
  provenance: DesignSourceProvenance,
  policy: DesignSourceProvenancePolicy = DEFAULT_PROVENANCE_POLICY,
): boolean {
  return VERIFICATION_RANK[provenance.verification] >= VERIFICATION_RANK[policy.minVerification];
}

/**
 * Soften a drift verdict for advisory mode: a `block` is capped to `warn` with
 * its would-be blockers surfaced as warnings (never dropped); `warn`/`pass`
 * stand. This is the single source of the "never fail the PR on an under-verified
 * source" rule, shared by the point-in-time and the fair-delta enforcement.
 */
function capVerdictToAdvisory(verdict: DriftGateVerdict): DriftGateVerdict {
  if (verdict.decision !== "block") return verdict;
  return { decision: "warn", blocking: [], warnings: [...verdict.warnings, ...verdict.blocking], ignored: verdict.ignored };
}

/** The design export was usable, but its provenance was below the required bar. */
export interface UnverifiedDesignSource {
  status: "unverified_design_source";
  provenance: DesignSourceProvenance;
  /** The verification level the policy required. */
  requiredVerification: ProvenanceVerification;
}

/** A gate whose verdict was capped to advisory because provenance was below the bar. */
export interface AdvisoryDesignSourceGate extends Omit<DesignSourceGate, "status"> {
  status: "gated_advisory";
  provenance: DesignSourceProvenance;
  /** Always false here; it is the reason the verdict was capped. */
  provenanceSufficient: false;
  /** The verdict the drift would have produced with full authority (e.g. `block`). */
  ungatedVerdict: DriftGateVerdict;
}

/** A gate that kept full authority because provenance met the bar. */
export interface VerifiedDesignSourceGate extends DesignSourceGate {
  provenance: DesignSourceProvenance;
  /** Always true here. */
  provenanceSufficient: true;
}

export type ProvenancedDriftOutcome =
  | VerifiedDesignSourceGate
  | AdvisoryDesignSourceGate
  | UnverifiedDesignSource
  | InvalidDesignSource;

/**
 * Enforce design-source provenance over a drift gate outcome. When the export
 * met the verification bar, the gate keeps full authority. When it did not, the
 * verdict is either softened to advisory (verdict capped at `warn`, findings kept)
 * or the gate is refused, per policy. A block is NEVER added; provenance can only
 * remove authority. `invalid_design_source` passes through unchanged. Deterministic.
 */
export function enforceDesignSourceProvenance(
  outcome: DesignSourceDriftOutcome,
  provenance: DesignSourceProvenance,
  policy: DesignSourceProvenancePolicy = DEFAULT_PROVENANCE_POLICY,
): ProvenancedDriftOutcome {
  // A malformed export was never gated, so provenance is moot; pass it through.
  if (outcome.status === "invalid_design_source") return outcome;

  if (provenanceMeetsBar(provenance, policy)) {
    return { ...outcome, provenance, provenanceSufficient: true };
  }

  if (policy.belowBar === "refuse") {
    return {
      status: "unverified_design_source",
      provenance,
      requiredVerification: policy.minVerification,
    };
  }

  // advisory: keep the findings, but never let an under-verified source fail the PR.
  return {
    ...outcome,
    status: "gated_advisory",
    verdict: capVerdictToAdvisory(outcome.verdict),
    ungatedVerdict: outcome.verdict,
    provenance,
    provenanceSufficient: false,
  };
}

/** The fair-delta gate kept full authority because provenance met the bar. */
export interface VerifiedDesignSourceDelta extends DesignSourceDriftDelta {
  provenance: DesignSourceProvenance;
  /** Always true here. */
  provenanceSufficient: true;
}

/** A fair-delta gate whose verdict was capped to advisory (provenance below the bar). */
export interface AdvisoryDesignSourceDelta extends Omit<DesignSourceDriftDelta, "status"> {
  status: "delta_advisory";
  provenance: DesignSourceProvenance;
  /** Always false here; it is the reason the delta verdict was capped. */
  provenanceSufficient: false;
  /** The verdict the introduced-drift delta would have produced with full authority. */
  ungatedVerdict: DriftGateVerdict;
}

export type ProvenancedDriftDeltaOutcome =
  | VerifiedDesignSourceDelta
  | AdvisoryDesignSourceDelta
  | UnverifiedDesignSource
  | InvalidDesignSource;

/**
 * Enforce design-source provenance over the FAIR (base-vs-head) drift delta, the
 * surface a PR gate actually uses (it fires only on drift the change introduced).
 * The delta's fair verdict is computed on the introduced set; provenance then
 * gates whether that verdict carries authority, exactly as for the point-in-time
 * gate: meets-bar keeps it, below-bar softens the delta verdict to advisory
 * (`delta_advisory`, block→warn) or refuses (`unverified_design_source`). Never
 * adds a block; `invalid_design_source` passes through. Deterministic.
 */
export function enforceDesignSourceProvenanceDelta(
  outcome: DesignSourceDriftDeltaOutcome,
  provenance: DesignSourceProvenance,
  policy: DesignSourceProvenancePolicy = DEFAULT_PROVENANCE_POLICY,
): ProvenancedDriftDeltaOutcome {
  if (outcome.status === "invalid_design_source") return outcome;

  if (provenanceMeetsBar(provenance, policy)) {
    return { ...outcome, provenance, provenanceSufficient: true };
  }

  if (policy.belowBar === "refuse") {
    return {
      status: "unverified_design_source",
      provenance,
      requiredVerification: policy.minVerification,
    };
  }

  return {
    ...outcome,
    status: "delta_advisory",
    delta: { ...outcome.delta, verdict: capVerdictToAdvisory(outcome.delta.verdict) },
    ungatedVerdict: outcome.delta.verdict,
    provenance,
    provenanceSufficient: false,
  };
}
