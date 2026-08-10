import type { DnaSnapshot } from "@uidna/schema";
import { computeDnaVersion } from "./version-identity.js";

/**
 * Immutable, content-addressed versioned snapshot store (#22, PRD §4/§7).
 * ui-dna owns immutable versions. A resolved `DnaSnapshot` is
 * frozen under its content-addressed `dnaVersion` and NEVER mutated in place; a
 * new genome or lifecycle transition produces a NEW version. `commitSnapshot`
 * is append-only and idempotent: re-committing identical content + causal
 * stamps + lifecycle state is a no-op returning the same version.
 *
 * Persistence is behind an injected `SnapshotStore` port. Tests use the
 * in-memory deterministic impl; production wires object storage as a thin
 * adapter (no live IO here).
 */

/** A committed, immutable snapshot record keyed by its content-addressed version. */
export interface StoredSnapshot {
  repo: string;
  dnaVersion: string;
  snapshot: DnaSnapshot;
}

/** Injected persistence port. Implementations MUST treat stored snapshots as immutable. */
export interface SnapshotStore {
  /** Persist a version if absent (append-only). Returns false if the version already existed. */
  put(record: StoredSnapshot): Promise<boolean>;
  /** Fetch one version, or null. */
  get(repo: string, dnaVersion: string): Promise<StoredSnapshot | null>;
  /** All versions for a repo, in commit order. */
  list(repo: string): Promise<StoredSnapshot[]>;
}

function repoKey(snapshot: DnaSnapshot): string {
  return `${snapshot.repository.owner}/${snapshot.repository.name}`;
}

/** Deep-freeze a value so a stored snapshot can never be mutated in place. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export interface CommitResult {
  dnaVersion: string;
  /** True when this commit created a new version; false when it was idempotent (already present). */
  created: boolean;
  stored: StoredSnapshot;
}

/**
 * Commit a resolved snapshot: stamp it with its content-addressed `dnaVersion`,
 * freeze it, and append it if new. Idempotent: committing the same resolved
 * content + causal stamps again returns the existing version without mutating
 * anything; any genome, causal stamp, or lifecycle-state change yields a new
 * immutable version.
 */
export async function commitSnapshot(
  store: SnapshotStore,
  snapshot: DnaSnapshot,
): Promise<CommitResult> {
  const dnaVersion = computeDnaVersion(snapshot);
  const repo = repoKey(snapshot);

  // Stamp the version into a frozen copy (never mutate the caller's snapshot).
  const stamped: DnaSnapshot = {
    ...snapshot,
    metadata: { ...snapshot.metadata, dnaVersion },
  };
  const stored: StoredSnapshot = deepFreeze({ repo, dnaVersion, snapshot: stamped });

  const created = await store.put(stored);
  if (created) return { dnaVersion, created, stored };

  // Idempotent: return the already-stored immutable version.
  const existing = await store.get(repo, dnaVersion);
  return { dnaVersion, created: false, stored: existing ?? stored };
}

/** A deterministic in-memory `SnapshotStore` for tests/dev: append-only and immutable. */
export function inMemorySnapshotStore(): SnapshotStore {
  const byRepo = new Map<string, Map<string, StoredSnapshot>>();
  const order = new Map<string, string[]>();

  return {
    put(record: StoredSnapshot): Promise<boolean> {
      const versions = byRepo.get(record.repo) ?? new Map<string, StoredSnapshot>();
      if (versions.has(record.dnaVersion)) return Promise.resolve(false); // append-only
      versions.set(record.dnaVersion, record);
      byRepo.set(record.repo, versions);
      order.set(record.repo, [...(order.get(record.repo) ?? []), record.dnaVersion]);
      return Promise.resolve(true);
    },
    get(repo: string, dnaVersion: string): Promise<StoredSnapshot | null> {
      return Promise.resolve(byRepo.get(repo)?.get(dnaVersion) ?? null);
    },
    list(repo: string): Promise<StoredSnapshot[]> {
      const versions = byRepo.get(repo);
      const ids = order.get(repo) ?? [];
      return Promise.resolve(ids.map((id) => versions?.get(id)).filter((r): r is StoredSnapshot => !!r));
    },
  };
}
