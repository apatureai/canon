import type { ApprovalState, ComponentConvention, DnaSnapshot, Fact, ProductIdentity } from "@uidna/schema";
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
 * field id; `accept` confirms the resolved value as-is, `edit` overrides it with
 * a human value. Both promote the field to human-confirmed (a 1.0 `human` fact,
 * or for a component its `confidence`→1.0 / `provenance`→human). Supported paths:
 * - `tokens.<group>.<key>`              (e.g. "tokens.color.--brand")
 * - `identity.name|audience|tone`       (the singular identity facts)
 * - `identity.dos.<i>` / `identity.donts.<i>` (an array entry by index)
 * - `components.<name>`                 (a `ComponentConvention` by name)
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

/** The human value for a decision: the edit value, else the existing value. */
function decidedValue(decision: ReviewDecision, existing: string | undefined): string | undefined {
  return decision.action === "edit" ? decision.value ?? existing ?? "" : existing;
}

/** Apply a token decision (`tokens.<group>.<key>`). Returns true if it matched a field. */
function applyTokenDecision(snapshot: DnaSnapshot, decision: ReviewDecision): boolean {
  const parts = decision.path.split(".");
  if (parts[0] !== "tokens" || parts.length < 3) return false;
  const group = parts[1] as keyof DnaSnapshot["tokens"];
  const container = snapshot.tokens[group] as Record<string, Fact<string>> | undefined;
  if (!container) return false;
  const key = parts.slice(2).join(".");
  const value = decidedValue(decision, container[key]?.value);
  // accept on an absent token is a no-op; edit can introduce the human value.
  if (value === undefined) return true;
  container[key] = fact(value, 1, "human");
  return true;
}

/** Apply an identity decision (`identity.name|audience|tone` or `identity.dos|donts.<i>`). */
function applyIdentityDecision(snapshot: DnaSnapshot, decision: ReviewDecision): boolean {
  const parts = decision.path.split(".");
  if (parts[0] !== "identity") return false;
  const id = snapshot.identity;

  if (parts.length === 2 && (parts[1] === "name" || parts[1] === "audience" || parts[1] === "tone")) {
    const field = parts[1] as "name" | "audience" | "tone";
    const value = decidedValue(decision, id[field]?.value);
    if (value === undefined) return true; // accept on an empty identity field is a no-op
    id[field] = fact(value, 1, "human");
    return true;
  }

  if (parts.length === 3 && (parts[1] === "dos" || parts[1] === "donts")) {
    const list = id[parts[1] as "dos" | "donts"];
    const i = Number(parts[2]);
    if (!Number.isInteger(i) || i < 0 || i >= list.length) return true; // out-of-range path: matched, no-op
    const value = decidedValue(decision, list[i]?.value);
    if (value === undefined) return true;
    list[i] = fact(value, 1, "human");
    return true;
  }
  return false;
}

/** Apply a component decision (`components.<name>`): promote confidence→1.0, provenance→human. */
function applyComponentDecision(snapshot: DnaSnapshot, decision: ReviewDecision): boolean {
  const parts = decision.path.split(".");
  if (parts[0] !== "components" || parts.length < 2) return false;
  const name = parts.slice(1).join(".");
  const idx = snapshot.components.findIndex((c) => c.name === name);
  if (idx < 0) return true; // unknown component: matched the shape, no-op
  const conv = snapshot.components[idx] as ComponentConvention;
  // edit renames the convention; both accept and edit confirm it as human at 1.0.
  const newName = decision.action === "edit" ? decision.value ?? conv.name : conv.name;
  snapshot.components[idx] = { ...conv, name: newName, confidence: 1, provenance: "human" };
  return true;
}

/**
 * Apply human review decisions: accepted/edited facts become human-confirmed at
 * confidence 1.0 (the top reconcile rung sign-off reserves). Covers tokens,
 * identity (singular facts + dos/donts entries), and component conventions.
 * Returns a new snapshot (input untouched). Unknown paths are ignored
 * deterministically; decisions are applied in stable path order.
 */
export function applyReviewDecisions(
  snapshot: DnaSnapshot,
  review: ReviewDecisions,
): DnaSnapshot {
  // Clone the parts a decision may touch so the input snapshot stays pure.
  const next: DnaSnapshot = {
    ...snapshot,
    tokens: structuredCloneTokens(snapshot.tokens),
    identity: cloneIdentity(snapshot.identity),
    components: snapshot.components.map((c) => ({ ...c, variants: [...c.variants], props: [...c.props], usageExamples: [...c.usageExamples] })),
  };
  for (const decision of [...review.decisions].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    // First matching field-kind handles it; an unknown path matches none and is ignored.
    if (applyTokenDecision(next, decision)) continue;
    if (applyIdentityDecision(next, decision)) continue;
    applyComponentDecision(next, decision);
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

function cloneIdentity(id: ProductIdentity): ProductIdentity {
  return {
    name: id.name ? { ...id.name } : null,
    audience: id.audience ? { ...id.audience } : null,
    tone: id.tone ? { ...id.tone } : null,
    dos: id.dos.map((f) => ({ ...f })),
    donts: id.donts.map((f) => ({ ...f })),
  };
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
