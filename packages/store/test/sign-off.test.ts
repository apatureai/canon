import { emptyDraft, fact, isApproved } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import {
  applyReviewDecisions,
  approveSnapshot,
  canTransition,
  inMemorySnapshotStore,
  rejectReview,
  requestReview,
} from "../src/index.js";

function draft() {
  const d = emptyDraft("apatureai", "ui-dna", "extract-1");
  d.tokens.color["--brand"] = fact("#bada55", 0.7, "config");
  d.tokens.spacing["--gap"] = fact("8px", 0.6, "pixels");
  return d;
}

describe("approval state machine", () => {
  it("allows draft->in_review->approved and the rework bounce", () => {
    expect(canTransition("draft", "in_review")).toBe(true);
    expect(canTransition("in_review", "approved")).toBe(true);
    expect(canTransition("in_review", "draft")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransition("draft", "approved")).toBe(false); // must review first
    expect(canTransition("approved", "draft")).toBe(false); // approved is terminal
    expect(() => requestReview({ ...draft(), metadata: { ...draft().metadata, approvalState: "approved" } })).toThrow();
  });

  it("requestReview / rejectReview move the state without mutating the input", () => {
    const d = draft();
    const reviewing = requestReview(d);
    expect(reviewing.metadata.approvalState).toBe("in_review");
    expect(d.metadata.approvalState).toBe("draft"); // input untouched
    expect(rejectReview(reviewing).metadata.approvalState).toBe("draft");
  });
});

describe("applyReviewDecisions — confirmed facts -> 1.0 human", () => {
  it("lifts an accepted fact to confidence 1.0 with provenance human", () => {
    const reviewed = applyReviewDecisions(draft(), {
      decisions: [{ path: "tokens.color.--brand", action: "accept" }],
    });
    expect(reviewed.tokens.color["--brand"]).toEqual({ value: "#bada55", confidence: 1, provenance: "human" });
  });

  it("records a human EDIT as an overriding 1.0 human fact", () => {
    const reviewed = applyReviewDecisions(draft(), {
      decisions: [{ path: "tokens.color.--brand", action: "edit", value: "#000000" }],
    });
    expect(reviewed.tokens.color["--brand"]).toEqual({ value: "#000000", confidence: 1, provenance: "human" });
  });

  it("ignores unknown paths and does not mutate the input", () => {
    const d = draft();
    const reviewed = applyReviewDecisions(d, { decisions: [{ path: "tokens.color.--nope", action: "accept" }] });
    expect(reviewed.tokens.color["--brand"]?.confidence).toBe(0.7); // unchanged
    expect(d.tokens.color["--brand"]?.provenance).toBe("config"); // input pure
  });
});

describe("approveSnapshot", () => {
  it("approves from in_review, applies decisions, and commits a NEW immutable version", async () => {
    const store = inMemorySnapshotStore();
    const reviewing = requestReview(draft());
    const { snapshot, commit } = await approveSnapshot(store, reviewing, {
      decisions: [{ path: "tokens.color.--brand", action: "accept" }],
    });
    expect(isApproved(snapshot)).toBe(true);
    expect(snapshot.tokens.color["--brand"]?.confidence).toBe(1);
    expect(commit.created).toBe(true);
    expect(snapshot.metadata.dnaVersion).toBe(commit.dnaVersion);
    expect(Object.isFrozen(snapshot)).toBe(true); // stored immutably
  });

  it("throws when approving a snapshot that is not in_review", async () => {
    const store = inMemorySnapshotStore();
    await expect(approveSnapshot(store, draft())).rejects.toThrow(/illegal approval transition/);
  });

  it("is deterministic: same review of same snapshot -> same dnaVersion", async () => {
    const review = { decisions: [{ path: "tokens.color.--brand", action: "accept" as const }] };
    const a = await approveSnapshot(inMemorySnapshotStore(), requestReview(draft()), review);
    const b = await approveSnapshot(inMemorySnapshotStore(), requestReview(draft()), review);
    expect(a.commit.dnaVersion).toBe(b.commit.dnaVersion);
  });
});
