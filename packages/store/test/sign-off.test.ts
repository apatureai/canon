import { emptyDraft, fact, isApproved } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import {
  applyReviewDecisions,
  approveSnapshot,
  canTransition,
  commitSnapshot,
  getSnapshot,
  inMemorySnapshotStore,
  rejectReview,
  requestReview,
} from "../src/index.js";

function draft() {
  const d = emptyDraft("apatureai", "ui-dna", "extract-1");
  d.tokens.color["--brand"] = fact("#bada55", 0.7, "config");
  d.tokens.spacing["--gap"] = fact("8px", 0.6, "pixels");
  d.identity.name = fact("Apature", 0.6, "code");
  d.identity.tone = fact("playful", 0.5, "pixels");
  d.identity.dos = [fact("use generous spacing", 0.6, "code")];
  d.components = [
    { name: "Button", variants: ["ghost"], props: ["size"], usageExamples: [], confidence: 0.5, provenance: "code" },
  ];
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

describe("applyReviewDecisions — identity + component coverage (#40)", () => {
  it("promotes an accepted singular identity fact to 1.0 human", () => {
    const reviewed = applyReviewDecisions(draft(), { decisions: [{ path: "identity.tone", action: "accept" }] });
    expect(reviewed.identity.tone).toEqual({ value: "playful", confidence: 1, provenance: "human" });
  });

  it("records an identity EDIT as an overriding 1.0 human fact", () => {
    const reviewed = applyReviewDecisions(draft(), {
      decisions: [{ path: "identity.name", action: "edit", value: "Apature Systems" }],
    });
    expect(reviewed.identity.name).toEqual({ value: "Apature Systems", confidence: 1, provenance: "human" });
  });

  it("promotes a dos/donts entry by index", () => {
    const reviewed = applyReviewDecisions(draft(), { decisions: [{ path: "identity.dos.0", action: "accept" }] });
    expect(reviewed.identity.dos[0]).toEqual({ value: "use generous spacing", confidence: 1, provenance: "human" });
  });

  it("promotes a component convention to confidence 1.0 / provenance human on accept", () => {
    const reviewed = applyReviewDecisions(draft(), { decisions: [{ path: "components.Button", action: "accept" }] });
    const btn = reviewed.components.find((c) => c.name === "Button");
    expect(btn?.confidence).toBe(1);
    expect(btn?.provenance).toBe("human");
    expect(btn?.variants).toEqual(["ghost"]); // convention body preserved
  });

  it("a component EDIT renames the convention and confirms it as human", () => {
    const reviewed = applyReviewDecisions(draft(), {
      decisions: [{ path: "components.Button", action: "edit", value: "PrimaryButton" }],
    });
    expect(reviewed.components.map((c) => c.name)).toContain("PrimaryButton");
    expect(reviewed.components.find((c) => c.name === "PrimaryButton")?.provenance).toBe("human");
  });

  it("ignores out-of-range identity indices and unknown component names without mutating input", () => {
    const d = draft();
    const reviewed = applyReviewDecisions(d, {
      decisions: [
        { path: "identity.dos.9", action: "accept" },
        { path: "components.Nope", action: "accept" },
      ],
    });
    expect(reviewed.identity.dos[0]?.provenance).toBe("code"); // unchanged
    expect(reviewed.components.find((c) => c.name === "Button")?.confidence).toBe(0.5); // unchanged
    expect(d.identity.tone?.provenance).toBe("pixels"); // input pure
    expect(d.components[0]?.provenance).toBe("code"); // input pure
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

  it("persists draft -> in_review -> approved as distinct immutable records with zero decisions", async () => {
    const store = inMemorySnapshotStore();
    const original = draft();
    const draftCommit = await commitSnapshot(store, original);
    const reviewing = requestReview(original);
    const reviewCommit = await commitSnapshot(store, reviewing);

    const approved = await approveSnapshot(store, reviewing, { decisions: [] });
    const records = await store.list("apatureai/ui-dna");

    expect(new Set([draftCommit.dnaVersion, reviewCommit.dnaVersion, approved.commit.dnaVersion]).size).toBe(3);
    expect(records.map((record) => record.snapshot.metadata.approvalState)).toEqual([
      "draft",
      "in_review",
      "approved",
    ]);
    expect(approved.commit.created).toBe(true);
    expect(isApproved(approved.snapshot)).toBe(true);

    const served = await getSnapshot(store, "apatureai/ui-dna", {
      version: approved.commit.dnaVersion,
    });
    expect(served?.dnaVersion).toBe(approved.commit.dnaVersion);
    expect(served?.snapshot.metadata.approvalState).toBe("approved");
  });

  it("cannot alias a persisted pre-approval record when every decision is a no-op", async () => {
    const store = inMemorySnapshotStore();
    const reviewing = requestReview(draft());
    const preApproval = await commitSnapshot(store, reviewing);

    const approved = await approveSnapshot(store, reviewing, {
      decisions: [
        { path: "tokens.color.--unknown", action: "accept" },
        { path: "components.Unknown", action: "accept" },
      ],
    });

    expect(approved.commit.dnaVersion).not.toBe(preApproval.dnaVersion);
    expect(approved.snapshot.metadata.approvalState).toBe("approved");
  });

  it("recommits an approved record idempotently and keeps approval terminal", async () => {
    const store = inMemorySnapshotStore();
    const approved = await approveSnapshot(store, requestReview(draft()));
    const repeated = await commitSnapshot(store, approved.snapshot);

    expect(repeated.created).toBe(false);
    expect(repeated.dnaVersion).toBe(approved.commit.dnaVersion);
    await expect(approveSnapshot(store, approved.snapshot)).rejects.toThrow(/illegal approval transition/);
  });
});
