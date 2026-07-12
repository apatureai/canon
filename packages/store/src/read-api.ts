import { isApproved, SCHEMA_VERSION, type DnaSnapshot } from "@uidna/schema";
import { createHash } from "node:crypto";
import { STORE_VERSION } from "./version-identity.js";
import { serializeGenomeContent } from "./version-identity.js";
import type { SnapshotStore } from "./store.js";

/**
 * Versioned downstream READ contract (#25, PRD §4/§7; core #103 DECISION-3:
 * ui-dna owns the downstream snapshot contract). Serves the versioned, APPROVED
 * `DnaSnapshot` to consumers (Gate, MCP Review, Entropy Engine, Source of Truth,
 * DNA Consultant) as a stable, additive-only contract — the surface the engine's
 * genome-grounding retrieval reads through.
 *
 * Read semantics: latest APPROVED snapshot by default, or a pinned immutable
 * `dnaVersion` for reproducibility. Unapproved drafts/in_review snapshots are
 * NEVER served downstream (the `isApproved` gate). Read-only; served from the
 * `@uidna/store` immutable versions. The wire shape is pinned by a golden
 * fixture so downstream byte-compat is enforced.
 */

/** Version-negotiation header so consumers pin the contract they read. */
export interface ContractVersion {
  /** Additive-only within this `@uidna/schema` SCHEMA_VERSION. */
  schemaVersion: string;
  /** Store/read-contract format version. */
  storeVersion: string;
}

/** The downstream read response: the snapshot + version stamps. Additive-only. */
export interface SnapshotResponse {
  contract: ContractVersion;
  repo: string;
  dnaVersion: string;
  /** Canonical genome-content digest consumers verify before mirroring. */
  contentDigest: string;
  snapshot: DnaSnapshot;
}

export interface GetSnapshotOptions {
  /** Pin a specific immutable version; default is the latest approved. */
  version?: string;
}

function contractVersion(): ContractVersion {
  return { schemaVersion: SCHEMA_VERSION, storeVersion: STORE_VERSION };
}

export function computeSnapshotContentDigest(snapshot: DnaSnapshot): string {
  return `sha256:${createHash("sha256").update(serializeGenomeContent(snapshot)).digest("hex")}`;
}

function responseFor(repo: string, dnaVersion: string, snapshot: DnaSnapshot): SnapshotResponse {
  return {
    contract: contractVersion(),
    repo,
    dnaVersion,
    contentDigest: computeSnapshotContentDigest(snapshot),
    snapshot,
  };
}

/**
 * Read a repo's downstream snapshot: the pinned `version` if given (only when
 * approved), else the latest APPROVED version. Returns null when no approved
 * snapshot matches — a draft/in_review snapshot is NEVER served downstream.
 */
export async function getSnapshot(
  store: SnapshotStore,
  repo: string,
  opts: GetSnapshotOptions = {},
): Promise<SnapshotResponse | null> {
  if (opts.version !== undefined) {
    const record = await store.get(repo, opts.version);
    if (!record || !isApproved(record.snapshot)) return null; // pinned must exist + be approved
    return responseFor(repo, record.dnaVersion, record.snapshot);
  }

  // Latest approved: the last-committed approved version (list is in commit order).
  const approved = (await store.list(repo)).filter((r) => isApproved(r.snapshot));
  const latest = approved[approved.length - 1];
  if (!latest) return null;
  return responseFor(repo, latest.dnaVersion, latest.snapshot);
}
