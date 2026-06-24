import { createHash } from "node:crypto";
import { canonicalize } from "@uidna/context";
import type { DnaSnapshot } from "@uidna/schema";

/**
 * Content-addressed `dnaVersion` identity (#22, PRD §7). The version of a
 * resolved snapshot is the SHA-256 of its canonical content folded together
 * with the CAUSAL version stamps that can legitimately change the genome —
 * schema, extraction, and model versions — and NOTHING incidental.
 *
 * Deliberately EXCLUDED from the hash: `dnaVersion` itself (it IS the output),
 * `approvalState` (a lifecycle transition, handled by #23 as a new version with
 * its own recompute), and any wall-clock / run-UUID / incidental metadata. So a
 * recommit of identical resolved content + identical causal stamps yields the
 * SAME dnaVersion (idempotent), and any genome OR causal-version change yields a
 * new one. Reuses #10's proven `canonicalize` (sorted keys + arrays, no
 * timestamps).
 */
export const STORE_VERSION = "1";

/** The causal version stamps folded into identity (everything that can change the genome). */
export interface CausalStamps {
  schemaVersion: string;
  extractionVersion: string;
  modelVersion: string | null;
}

function causalStampsOf(snapshot: DnaSnapshot): CausalStamps {
  return {
    schemaVersion: snapshot.metadata.schemaVersion,
    extractionVersion: snapshot.metadata.extractionVersion,
    modelVersion: snapshot.metadata.modelVersion,
  };
}

/**
 * Serialize the version-identity payload deterministically: the snapshot's
 * resolved CONTENT (no metadata) plus only the causal stamps. Byte-stable across
 * insertion order via the shared canonicalizer.
 */
export function serializeForVersion(snapshot: DnaSnapshot): string {
  const payload = {
    storeVersion: STORE_VERSION,
    repository: snapshot.repository,
    identity: snapshot.identity,
    tokens: snapshot.tokens,
    components: snapshot.components,
    distributions: snapshot.distributions,
    anchors: snapshot.anchors,
    exceptions: snapshot.exceptions,
    causal: causalStampsOf(snapshot),
  };
  return JSON.stringify(canonicalize(payload));
}

/** Compute the content-addressed `dnaVersion` for a resolved snapshot. */
export function computeDnaVersion(snapshot: DnaSnapshot): string {
  return createHash("sha256").update(serializeForVersion(snapshot)).digest("hex");
}
