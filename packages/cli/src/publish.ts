import {
  approveSnapshot,
  inMemorySnapshotStore,
  projectLatticeDnaProfile,
  projectPointerLocalCheckProfile,
  projectVerdictDnaProfile,
  requestReview,
} from "@apatureai/canon-store";
import { validateSnapshot, type DnaSnapshot } from "@apatureai/canon-schema";

/**
 * The publish layer: promote a draft genome to an approved immutable version,
 * then PROJECT that approved version into a downstream consumer's read contract.
 *
 * This is the filesystem entry point for the two workflows the libraries own
 * but the CLI never exposed: the sign-off/promotion path (`@apatureai/canon-store`'s
 * draft -> in_review -> approved lifecycle) and the consumer projections
 * (Verdict, Lattice, Pointer). Both stay pure here; `cli.ts` owns the disk.
 */

/** Downstream consumers UI-DNA can project an approved genome into. */
export const EXPORT_TARGETS = ["verdict", "lattice", "pointer"] as const;
export type ExportTarget = (typeof EXPORT_TARGETS)[number];

export function isExportTarget(value: string): value is ExportTarget {
  return (EXPORT_TARGETS as readonly string[]).includes(value);
}

/**
 * Promote a draft/in-review genome to an approved immutable version. Runs the
 * sign-off transition (draft -> in_review -> approved) and commits it through an
 * in-memory store so the returned snapshot is stamped with its content-addressed
 * `dnaVersion` and `approvalState: "approved"`. Sign-off with no per-field
 * decisions confirms the resolved genome as-is; an already-approved input is
 * rejected (a new genome is a new version, not a re-approval).
 */
export async function approveGenome(snapshot: DnaSnapshot): Promise<DnaSnapshot> {
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) {
    throw new Error(`cannot approve an invalid genome: ${validation.errors.join("; ")}`);
  }
  const state = snapshot.metadata.approvalState;
  if (state === "approved") {
    throw new Error("genome is already approved; a new genome is a new version, not a re-approval");
  }
  // draft -> in_review, then approveSnapshot does in_review -> approved + commit.
  const inReview = state === "in_review" ? snapshot : requestReview(snapshot);
  const store = inMemorySnapshotStore();
  const { snapshot: approved } = await approveSnapshot(store, inReview);
  return approved;
}

/** Project an approved snapshot into the named consumer's read contract. */
export function projectForTarget(snapshot: DnaSnapshot, target: ExportTarget): unknown {
  const repo = `${snapshot.repository.owner}/${snapshot.repository.name}`;
  const dnaVersion = snapshot.metadata.dnaVersion;
  switch (target) {
    case "verdict":
      return projectVerdictDnaProfile(snapshot, repo, dnaVersion);
    case "lattice":
      return projectLatticeDnaProfile(snapshot, repo, dnaVersion);
    case "pointer":
      return projectPointerLocalCheckProfile(snapshot, repo, dnaVersion);
  }
}
