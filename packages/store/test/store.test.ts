import { emptyDraft, fact } from "@apatureai/canon-schema";
import { describe, expect, it } from "vitest";
import { commitSnapshot, computeDnaVersion, inMemorySnapshotStore } from "../src/index.js";

function draft() {
  const d = emptyDraft("apatureai", "canon", "extract-1");
  d.tokens.color["--brand"] = fact("#bada55", 0.8, "config");
  return d;
}

describe("computeDnaVersion — content-addressed identity", () => {
  it("is a stable sha256 over identical content + causal stamps", () => {
    expect(computeDnaVersion(draft())).toMatch(/^[0-9a-f]{64}$/);
    expect(computeDnaVersion(draft())).toBe(computeDnaVersion(draft()));
  });

  it("ignores dnaVersion and wall-clock-style incidental metadata", () => {
    const a = draft();
    const b = draft();
    // dnaVersion is the output, not an identity input.
    a.metadata.dnaVersion = "anything";
    expect(computeDnaVersion(a)).toBe(computeDnaVersion(b));
  });

  it("distinguishes immutable lifecycle records with identical genome content", () => {
    const a = draft();
    const b = draft();
    b.metadata.approvalState = "in_review";
    const c = draft();
    c.metadata.approvalState = "approved";
    expect(computeDnaVersion(a)).not.toBe(computeDnaVersion(b));
    expect(computeDnaVersion(b)).not.toBe(computeDnaVersion(c));
    expect(computeDnaVersion(a)).not.toBe(computeDnaVersion(c));
  });

  it("changes when the genome content changes", () => {
    const a = draft();
    const b = draft();
    b.tokens.color["--brand"] = fact("#000000", 0.8, "config");
    expect(computeDnaVersion(a)).not.toBe(computeDnaVersion(b));
  });

  it("changes when a CAUSAL stamp changes (schema/extraction/model)", () => {
    const a = draft();
    const b = draft();
    b.metadata.extractionVersion = "extract-2";
    expect(computeDnaVersion(a)).not.toBe(computeDnaVersion(b));
  });
});

describe("commitSnapshot — append-only, content-addressed, idempotent", () => {
  it("stamps the snapshot with its content-addressed dnaVersion", async () => {
    const store = inMemorySnapshotStore();
    const { dnaVersion, created, stored } = await commitSnapshot(store, draft());
    expect(created).toBe(true);
    expect(stored.snapshot.metadata.dnaVersion).toBe(dnaVersion);
    expect(dnaVersion).toBe(computeDnaVersion(draft()));
  });

  it("is idempotent: re-committing identical content does not create a new version", async () => {
    const store = inMemorySnapshotStore();
    const first = await commitSnapshot(store, draft());
    const second = await commitSnapshot(store, draft());
    expect(second.created).toBe(false);
    expect(second.dnaVersion).toBe(first.dnaVersion);
    expect((await store.list("apatureai/canon")).length).toBe(1);
  });

  it("yields a new immutable version when the genome changes", async () => {
    const store = inMemorySnapshotStore();
    const v1 = await commitSnapshot(store, draft());
    const changed = draft();
    changed.tokens.color["--brand"] = fact("#000000", 0.8, "config");
    const v2 = await commitSnapshot(store, changed);
    expect(v2.dnaVersion).not.toBe(v1.dnaVersion);
    expect((await store.list("apatureai/canon")).length).toBe(2);
  });

  it("does not mutate the caller's snapshot and freezes the stored one", async () => {
    const store = inMemorySnapshotStore();
    const input = draft();
    const { stored } = await commitSnapshot(store, input);
    expect(input.metadata.dnaVersion).toBe("0"); // caller untouched (emptyDraft default)
    expect(Object.isFrozen(stored.snapshot)).toBe(true);
    expect(() => {
      (stored.snapshot.tokens.color["--brand"] as { value: string }).value = "mutated";
    }).toThrow();
  });
});
