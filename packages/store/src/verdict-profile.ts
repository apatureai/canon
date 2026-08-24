import { createHash } from "node:crypto";
import { canonicalize } from "@uidna/context";
import { isApproved, validateSnapshot, type DnaSnapshot } from "@uidna/schema";
import { flattenTokens } from "./consumer-tokens.js";
import { getSnapshot } from "./read-api.js";
import type { SnapshotStore } from "./store.js";

/**
 * Verdict UI-DNA read profile (PRD §4/§7). Verdict grounds a rendered review on
 * the repo's approved design tokens: it reads a `snapshot` object carrying the
 * immutable `dna_version`, an `approval_state` it will only admit when
 * `approved` or `superseded`, and a flat list of `items` it loads as rules.
 *
 * Canon's internal `DnaSnapshot` is not that shape — it is grouped, camelCase,
 * and keyed by CSS var name. This is the pure PROJECTION from an approved
 * immutable snapshot into Verdict's wire contract, the sibling of
 * `projectPointerLocalCheckProfile`. UI-DNA owns the downstream contract; the
 * snake_case field names here are Verdict's, deliberately, so the boundary is
 * explicit rather than leaking canon's internal casing.
 */

/** Release-controlled Verdict read-profile version. Bump on incompatible changes. */
export const VERDICT_DNA_PROFILE_VERSION = "1";

/** Approval states Verdict will admit. Canon serves `approved`; `superseded` is pin-only. */
export type VerdictApprovalState = "approved" | "superseded";

/** One rule Verdict loads: a design-token fact addressed by its stable field id. */
export interface VerdictItem {
  field_id: string;
  kind: string;
  value: string;
  confidence: number;
  provenance: string;
}

/** The `snapshot` object Verdict reads: identity, admission state, and rules. */
export interface VerdictSnapshot {
  dna_version: string;
  approval_state: VerdictApprovalState;
  items: VerdictItem[];
}

export interface VerdictDnaProfile {
  schemaVersion: string;
  profileVersion: string;
  repo: string;
  /** SHA-256 over the canonical profile with this field omitted. */
  contentDigest: string;
  snapshot: VerdictSnapshot;
}

export interface GetVerdictProfileOptions {
  /** Pin an immutable approved DNA version. Latest approved is the default. */
  dnaVersion?: string;
  /** Fail-closed version negotiation. Only the current version is accepted. */
  profileVersion?: string;
}

export class UnsupportedVerdictProfileVersionError extends Error {
  constructor(version: string) {
    super(`unsupported Verdict UI-DNA profile version "${version}"`);
    this.name = "UnsupportedVerdictProfileVersionError";
  }
}

export class UnapprovedVerdictProfileError extends Error {
  constructor() {
    super("Verdict UI-DNA profiles may be projected only from approved UI DNA");
    this.name = "UnapprovedVerdictProfileError";
  }
}

export class InvalidVerdictProfileSourceError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`invalid Verdict UI-DNA profile source: ${errors.join("; ")}`);
    this.name = "InvalidVerdictProfileSourceError";
    this.errors = errors;
  }
}

function items(snapshot: DnaSnapshot): VerdictItem[] {
  return flattenTokens(snapshot).map((row) => ({
    field_id: row.fieldId,
    kind: row.category,
    value: row.value,
    confidence: row.confidence,
    provenance: row.provenance,
  }));
}

type UnsignedVerdictProfile = Omit<VerdictDnaProfile, "contentDigest">;

/** Canonical bytes Verdict verifies before loading any cited rule. */
export function serializeVerdictDnaProfile(profile: UnsignedVerdictProfile): string {
  return JSON.stringify(canonicalize(profile));
}

export function computeVerdictDnaProfileDigest(profile: UnsignedVerdictProfile): string {
  return `sha256:${createHash("sha256").update(serializeVerdictDnaProfile(profile)).digest("hex")}`;
}

/** Pure projection from one approved immutable snapshot into Verdict's contract. */
export function projectVerdictDnaProfile(
  snapshot: DnaSnapshot,
  repo: string,
  dnaVersion: string,
): VerdictDnaProfile {
  if (!isApproved(snapshot)) throw new UnapprovedVerdictProfileError();
  const errors: string[] = [];
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) errors.push(...validation.errors);
  const snapshotRepo = `${snapshot.repository.owner}/${snapshot.repository.name}`;
  if (repo !== snapshotRepo) errors.push(`repo "${repo}" does not match snapshot repository "${snapshotRepo}"`);
  if (dnaVersion !== snapshot.metadata.dnaVersion) {
    errors.push(`dnaVersion "${dnaVersion}" does not match snapshot version "${snapshot.metadata.dnaVersion}"`);
  }
  if (errors.length > 0) throw new InvalidVerdictProfileSourceError(errors);
  const unsigned: UnsignedVerdictProfile = {
    schemaVersion: snapshot.metadata.schemaVersion,
    profileVersion: VERDICT_DNA_PROFILE_VERSION,
    repo,
    snapshot: {
      dna_version: dnaVersion,
      approval_state: "approved",
      items: items(snapshot),
    },
  };
  return { ...unsigned, contentDigest: computeVerdictDnaProfileDigest(unsigned) };
}

/**
 * Publish the latest (or pinned) approved genome as Verdict's read profile.
 * Draft/in-review records never project because `getSnapshot` owns the approval
 * gate. Unsupported profile versions fail closed.
 */
export async function getVerdictDnaProfile(
  store: SnapshotStore,
  repo: string,
  opts: GetVerdictProfileOptions = {},
): Promise<VerdictDnaProfile | null> {
  const requested = opts.profileVersion ?? VERDICT_DNA_PROFILE_VERSION;
  if (requested !== VERDICT_DNA_PROFILE_VERSION) {
    throw new UnsupportedVerdictProfileVersionError(requested);
  }
  const response = await getSnapshot(store, repo, { version: opts.dnaVersion });
  if (!response) return null;
  return projectVerdictDnaProfile(response.snapshot, response.repo, response.dnaVersion);
}
