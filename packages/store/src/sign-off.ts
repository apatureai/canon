import type { ApprovalState, DnaSnapshot, Fact } from "@uidna/schema";
import { fact } from "@uidna/schema";
import { commitSnapshot, type CommitResult, type SnapshotStore } from "./store.js";

/**
 * Sign-off workflow (#23, PRD §4/§6): the human review that transitions a
 * snapshot draft → in_review → approved, and on approval lifts confirmed
 * `Fact`s to confidence 1.0 with provenance `human` — the top rung the reconcile
 * ladder (#18) reserves for sign-off. Structured review is headless (a plain
 * JSON `ReviewDecisions`), not UI-coupled; no customer code is written.
 *
 * Approval produces a NEW immutable version via `@uidna/store` — an approved
 * snapshot is never mutated in place.
 */

/** Legal forward transitions of the ApprovalState machine. */
const TRANSITIONS: Record<ApprovalState, ApprovalState[]> = {
  draft: ["in_review"],
  in_review: ["approved", "draft"], // can bounce back to draft for rework
  approved: [], // terminal: a new genome is a new version, not a re-edit
};

export function canTransition(from: ApprovalState, to: ApprovalState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Move a snapshot to a new approval state, or throw on an illegal transition. */
function transition(snapshot: DnaSnapshot, to: ApprovalState): DnaSnapshot {
  const from = snapshot.metadata.approvalState;
  if (!canTransition(from, to)) {
    throw new Error(`illegal approval transition: ${from} -> ${to}`);
  }
  return { ...snapshot, metadata: { ...snapshot.metadata, approvalState: to } };
}

/** draft -> in_review. Pure; throws if not currently a draft. */
export function requestReview(snapshot: DnaSnapshot): DnaSnapshot {
  return transition(snapshot, "in_review");
}

/** in_review -> draft (send back for rework). Pure. */
export function rejectReview(snapshot: DnaSnapshot): DnaSnapshot {
  return transition(snapshot, "draft");
}

/**
 * A per-field human decision over a reconciled snapshot. `path` is a dotted
 * field id (e.g. "tokens.color.--brand"); `accept` confirms the resolved value
 * as-is; `edit` overrides it with a human value. Both become 1.0 `human` facts.
 */
export interface ReviewDecision {
  path: string;
  action: "accept" | "edit";
  /** Required for "edit": the human-corrected value. */
  value?: string;
}

export interface ReviewDecisions {
  decisions: ReviewDecision[];
}

/** Navigate a dotted path to the `Fact` container + leaf key, or null if absent. */
function resolvePath(
  snapshot: DnaSnapshot,
  path: string,
): { container: Record<string, Fact<string>>; key: string } | null {
  const parts = path.split(".");
  if (parts[0] !== "tokens" || parts.length < 3) return null;
  const group = parts[1] as keyof DnaSnapshot["tokens"];
  const tokens = snapshot.tokens[group];
  if (!tokens) return null;
  const key = parts.slice(2).join(".");
  return { container: tokens as Record<string, Fact<string>>, key };
}

/**
 * Apply human review decisions: accepted/edited token facts become
 * `fact(value, 1.0, "human")` (the reconcile-winning human override). Returns a
 * new snapshot (input untouched). Unknown paths are ignored deterministically.
 */
export function applyReviewDecisions(
  snapshot: DnaSnapshot,
  review: ReviewDecisions,
): DnaSnapshot {
  // Deep-ish clone of the token groups we may touch (input stays pure).
  const next: DnaSnapshot = {
    ...snapshot,
    tokens: structuredCloneTokens(snapshot.tokens),
  };
  for (const decision of [...review.decisions].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const loc = resolvePath(next, decision.path);
    if (!loc) continue;
    const existing = loc.container[loc.key];
    const value = decision.action === "edit" ? decision.value ?? existing?.value ?? "" : existing?.value;
    if (value === undefined) continue;
    loc.container[loc.key] = fact(value, 1, "human");
  }
  return next;
}

function structuredCloneTokens(tokens: DnaSnapshot["tokens"]): DnaSnapshot["tokens"] {
  const out = {} as DnaSnapshot["tokens"];
  for (const group of Object.keys(tokens) as (keyof DnaSnapshot["tokens"])[]) {
    out[group] = Object.fromEntries(
      Object.entries(tokens[group]).map(([k, f]) => [k, { ...f }]),
    );
  }
  return out;
}

export interface ApproveResult {
  snapshot: DnaSnapshot;
  commit: CommitResult;
}

/**
 * Approve a snapshot: must be `in_review`, apply the human review decisions
 * (confirmed facts → 1.0 human), set state `approved`, and commit it as a NEW
 * immutable version via the store. Throws on an illegal transition.
 */
export async function approveSnapshot(
  store: SnapshotStore,
  snapshot: DnaSnapshot,
  review: ReviewDecisions = { decisions: [] },
): Promise<ApproveResult> {
  const reviewed = applyReviewDecisions(snapshot, review);
  const approved = transition(reviewed, "approved");
  const commit = await commitSnapshot(store, approved);
  return { snapshot: commit.stored.snapshot, commit };
}
