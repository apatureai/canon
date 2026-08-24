import { canonicalize } from "@apatureai/canon-context";
import { isApproved, validateSnapshot, type DnaSnapshot } from "@apatureai/canon-schema";
import { flattenTokens } from "./consumer-tokens.js";
import { computeSnapshotContentDigest, getSnapshot } from "./read-api.js";
import type { SnapshotStore } from "./store.js";

/**
 * Lattice UI-DNA read profile (PRD §4/§7). Lattice builds a token-violations
 * view over a repo's approved design system: it reads a `projectionSchemaVersion`
 * it negotiates on, the `dnaContentDigest` it verifies before mirroring, an
 * admission `state`, and a `tokens` map keyed by field id whose entries carry
 * `{ value, category, confidence }`.
 *
 * Canon's internal `DnaSnapshot` keys tokens by CSS var name under seven typed
 * groups with per-fact provenance; Lattice's profile is one flat confidence-
 * weighted map. This is the pure PROJECTION from an approved immutable snapshot
 * into Lattice's contract, the sibling of `projectPointerLocalCheckProfile` and
 * `projectVerdictDnaProfile`. UI-DNA owns the downstream contract.
 */

/** Release-controlled Lattice read-profile version. Bump on incompatible changes. */
export const LATTICE_PROJECTION_SCHEMA_VERSION = "1";

/** Admission states Lattice will build a view from. Canon serves `approved`. */
export type LatticeState = "approved" | "superseded";

/** One token Lattice reads: its resolved value, category, and extractor confidence. */
export interface LatticeToken {
  value: string;
  category: string;
  confidence: number;
}

export interface LatticeDnaProfile {
  projectionSchemaVersion: string;
  repo: string;
  dnaVersion: string;
  /** Canonical genome-content digest Lattice verifies before mirroring. */
  dnaContentDigest: string;
  state: LatticeState;
  /** Field id (`tokens.color.--brand`) -> resolved token. */
  tokens: Record<string, LatticeToken>;
}

export interface GetLatticeProfileOptions {
  /** Pin an immutable approved DNA version. Latest approved is the default. */
  dnaVersion?: string;
  /** Fail-closed version negotiation. Only the current version is accepted. */
  projectionSchemaVersion?: string;
}

export class UnsupportedLatticeProfileVersionError extends Error {
  constructor(version: string) {
    super(`unsupported Lattice projection schema version "${version}"`);
    this.name = "UnsupportedLatticeProfileVersionError";
  }
}

export class UnapprovedLatticeProfileError extends Error {
  constructor() {
    super("Lattice UI-DNA profiles may be projected only from approved UI DNA");
    this.name = "UnapprovedLatticeProfileError";
  }
}

export class InvalidLatticeProfileSourceError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`invalid Lattice UI-DNA profile source: ${errors.join("; ")}`);
    this.name = "InvalidLatticeProfileSourceError";
    this.errors = errors;
  }
}

function tokens(snapshot: DnaSnapshot): Record<string, LatticeToken> {
  const out: Record<string, LatticeToken> = {};
  for (const row of flattenTokens(snapshot)) {
    out[row.fieldId] = { value: row.value, category: row.category, confidence: row.confidence };
  }
  return out;
}

/** Canonical bytes Lattice verifies before mirroring the profile. */
export function serializeLatticeDnaProfile(profile: LatticeDnaProfile): string {
  return JSON.stringify(canonicalize(profile));
}

/** Pure projection from one approved immutable snapshot into Lattice's contract. */
export function projectLatticeDnaProfile(
  snapshot: DnaSnapshot,
  repo: string,
  dnaVersion: string,
): LatticeDnaProfile {
  if (!isApproved(snapshot)) throw new UnapprovedLatticeProfileError();
  const errors: string[] = [];
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) errors.push(...validation.errors);
  const snapshotRepo = `${snapshot.repository.owner}/${snapshot.repository.name}`;
  if (repo !== snapshotRepo) errors.push(`repo "${repo}" does not match snapshot repository "${snapshotRepo}"`);
  if (dnaVersion !== snapshot.metadata.dnaVersion) {
    errors.push(`dnaVersion "${dnaVersion}" does not match snapshot version "${snapshot.metadata.dnaVersion}"`);
  }
  if (errors.length > 0) throw new InvalidLatticeProfileSourceError(errors);
  return {
    projectionSchemaVersion: LATTICE_PROJECTION_SCHEMA_VERSION,
    repo,
    dnaVersion,
    dnaContentDigest: computeSnapshotContentDigest(snapshot),
    state: "approved",
    tokens: tokens(snapshot),
  };
}

/**
 * Publish the latest (or pinned) approved genome as Lattice's read profile.
 * Draft/in-review records never project because `getSnapshot` owns the approval
 * gate. Unsupported projection schema versions fail closed.
 */
export async function getLatticeDnaProfile(
  store: SnapshotStore,
  repo: string,
  opts: GetLatticeProfileOptions = {},
): Promise<LatticeDnaProfile | null> {
  const requested = opts.projectionSchemaVersion ?? LATTICE_PROJECTION_SCHEMA_VERSION;
  if (requested !== LATTICE_PROJECTION_SCHEMA_VERSION) {
    throw new UnsupportedLatticeProfileVersionError(requested);
  }
  const response = await getSnapshot(store, repo, { version: opts.dnaVersion });
  if (!response) return null;
  return projectLatticeDnaProfile(response.snapshot, response.repo, response.dnaVersion);
}
