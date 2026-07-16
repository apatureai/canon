import { isApproved, SCHEMA_VERSION, type DnaSnapshot } from "@uidna/schema";
import { createHash } from "node:crypto";
import { STORE_VERSION } from "./version-identity.js";
import { serializeGenomeContent } from "./version-identity.js";
import type { SnapshotStore } from "./store.js";
import { authorizeRead, type AuthorityStatus } from "./authority.js";

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

/**
 * Resolves the current authority status of an approved version (#64). The read
 * contract is repo-scoped and tenant-agnostic, but authority is keyed by
 * `(tenant, repo, dnaVersion)`; the tenant-aware caller (composition root)
 * therefore binds the tenant and supplies this resolver so `getSnapshot` can
 * consult authority without threading tenant through the read surface. A version
 * with no authority event resolves to `effective` (the store default).
 */
export type AuthorityStatusResolver = (dnaVersion: string) => AuthorityStatus;

export interface GetSnapshotOptions {
  /** Pin a specific immutable version; default is the latest approved. */
  version?: string;
  /**
   * Consult approval-authority status before serving (#64). When supplied, a
   * `revoked` version is NEVER served (fail closed, non-enumerating — a revoked
   * read is indistinguishable from not-found); a `superseded` version is served
   * only on a pinned read (reproducibility), never as `latest`; and `latest`
   * resolves to the newest version that is still `effective`. When omitted, the
   * pre-authority behavior is preserved (serve any approved) so consumers adopt
   * enforcement incrementally.
   */
  resolveAuthority?: AuthorityStatusResolver;
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
 *
 * When `opts.resolveAuthority` is supplied, approval authority (#64) is enforced
 * on top of the content-level `approved` gate: a `revoked` version is never
 * served (fail closed on both latest and pinned), a `superseded` version is
 * pin-readable only, and `latest` skips any non-`effective` version. A withheld
 * read returns null non-enumerating — a revoked/withdrawn version is
 * indistinguishable from absent to an ordinary consumer.
 */
export async function getSnapshot(
  store: SnapshotStore,
  repo: string,
  opts: GetSnapshotOptions = {},
): Promise<SnapshotResponse | null> {
  if (opts.version !== undefined) {
    const record = await store.get(repo, opts.version);
    if (!record || !isApproved(record.snapshot)) return null; // pinned must exist + be approved
    if (opts.resolveAuthority && !authorizeRead(opts.resolveAuthority(record.dnaVersion), "pinned").serve) {
      return null; // revoked pinned read fails closed, non-enumerating
    }
    return responseFor(repo, record.dnaVersion, record.snapshot);
  }

  // Latest approved: the last-committed approved version (list is in commit order).
  let approved = (await store.list(repo)).filter((r) => isApproved(r.snapshot));
  if (opts.resolveAuthority) {
    const resolve = opts.resolveAuthority;
    // Latest must be a still-effective version — skip superseded and revoked.
    approved = approved.filter((r) => authorizeRead(resolve(r.dnaVersion), "latest").serve);
  }
  const latest = approved[approved.length - 1];
  if (!latest) return null;
  return responseFor(repo, latest.dnaVersion, latest.snapshot);
}
