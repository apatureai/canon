import { createHash } from "node:crypto";
import { canonicalize } from "@apatureai/canon-context";
import type { ApprovalState, DnaSnapshot } from "@apatureai/canon-schema";

/**
 * Content-addressed `dnaVersion` identity (#22, PRD §7). The version of a
 * resolved snapshot is the SHA-256 of its canonical content folded together
 * with the CAUSAL version stamps that can legitimately change the genome
 * (schema, extraction, and model versions), plus the immutable lifecycle state
 * of the stored record, and NOTHING incidental.
 *
 * Deliberately EXCLUDED from the hash: `dnaVersion` itself (it IS the output)
 * and any wall-clock / run-UUID / incidental metadata. Lifecycle state is
 * included because draft, in-review, and approved snapshots are distinct
 * immutable records even when their resolved genome content is byte-identical.
 * A recommit of identical resolved content + causal stamps + lifecycle state
 * yields the SAME dnaVersion (idempotent), while a genome, causal-version, or
 * lifecycle transition yields a new one. Reuses #10's proven `canonicalize`
 * (sorted keys + arrays, no timestamps).
 */
export const STORE_VERSION = "2";

/** The causal version stamps folded into identity (everything that can change the genome). */
export interface CausalStamps {
  schemaVersion: string;
  extractionVersion: string;
  modelVersion: string | null;
}

/** Lifecycle identity of one immutable stored record. */
export interface LifecycleStamp {
  approvalState: ApprovalState;
}

function causalStampsOf(snapshot: DnaSnapshot): CausalStamps {
  return {
    schemaVersion: snapshot.metadata.schemaVersion,
    extractionVersion: snapshot.metadata.extractionVersion,
    modelVersion: snapshot.metadata.modelVersion,
  };
}

function lifecycleStampOf(snapshot: DnaSnapshot): LifecycleStamp {
  return { approvalState: snapshot.metadata.approvalState };
}

function genomeContentOf(snapshot: DnaSnapshot) {
  return {
    repository: snapshot.repository,
    identity: snapshot.identity,
    tokens: snapshot.tokens,
    components: snapshot.components,
    distributions: snapshot.distributions,
    anchors: snapshot.anchors,
    exceptions: snapshot.exceptions,
  };
}

/** Serialize only resolved genome content, excluding every metadata stamp. */
export function serializeGenomeContent(snapshot: DnaSnapshot): string {
  return JSON.stringify(canonicalize(genomeContentOf(snapshot)));
}

/**
 * Serialize the version-identity payload deterministically: the snapshot's
 * resolved CONTENT (no metadata) plus only the causal stamps. Byte-stable across
 * insertion order via the shared canonicalizer.
 */
export function serializeForVersion(snapshot: DnaSnapshot): string {
  const payload = {
    storeVersion: STORE_VERSION,
    ...genomeContentOf(snapshot),
    causal: causalStampsOf(snapshot),
    lifecycle: lifecycleStampOf(snapshot),
  };
  return JSON.stringify(canonicalize(payload));
}

/** Compute the content-addressed `dnaVersion` for a resolved snapshot. */
export function computeDnaVersion(snapshot: DnaSnapshot): string {
  return createHash("sha256").update(serializeForVersion(snapshot)).digest("hex");
}
