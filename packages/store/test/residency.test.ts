import {
  approveSnapshot,
  commitSnapshot,
  getResidentSnapshot,
  getSnapshot,
  inMemorySnapshotStore,
  isEntitled,
  requestReview,
  type AccessLogEvent,
  type ResidencyPolicy,
} from "../src/index.js";
import { emptyDraft, fact, type DnaSnapshot } from "@uidna/schema";
import { describe, expect, it } from "vitest";

/** An approved genome carrying a planted secret + PII and multi-route anchors. */
function genome(): DnaSnapshot {
  const d = emptyDraft("apatureai", "ui-dna", "extract-1");
  d.identity.name = fact("Apature", 1, "human");
  d.identity.audience = fact("reach us at founder@apature.dev", 1, "human"); // PII to scrub
  d.tokens.color["--brand"] = fact("#0a0a0a", 1, "human");
  // A token value carrying a leaked secret (e.g. extracted from a config string).
  d.tokens.color["--leaked"] = fact("token sk-ABCDEF0123456789XYZ embedded", 0.5, "config");
  d.anchors = [
    { ref: "s3://anchors/home", route: "/", description: "home hero", provenance: "pixels" },
    { ref: "s3://anchors/promo", route: "/promo", description: "promo banner", provenance: "pixels" },
  ];
  return d;
}

async function approvedStore() {
  const store = inMemorySnapshotStore();
  const { commit } = await approveSnapshot(store, requestReview(genome()));
  return { store, dnaVersion: commit.dnaVersion };
}

const REPO = "apatureai/ui-dna";

function policy(over: Partial<ResidencyPolicy> = {}): ResidencyPolicy {
  return { tenantId: "t1", entitledRepos: [REPO], retention: "retained", ...over };
}

describe("getResidentSnapshot — genome residency / security (#30)", () => {
  it("denies a tenant reading a repo it isn't entitled to (tenant-scoping)", async () => {
    const { store } = await approvedStore();
    const p = policy({ entitledRepos: ["someone/else"] });
    expect(isEntitled(p, REPO)).toBe(false);
    expect(await getResidentSnapshot(store, p, REPO)).toBeNull();
  });

  it("serves an entitled tenant the approved snapshot", async () => {
    const { store, dnaVersion } = await approvedStore();
    const res = await getResidentSnapshot(store, policy(), REPO);
    expect(res?.dnaVersion).toBe(dnaVersion);
    expect(res?.snapshot.tokens.color["--brand"]?.value).toBe("#0a0a0a");
  });

  it("scrubs secrets/PII from served fact values (no private content leaks)", async () => {
    const { store } = await approvedStore();
    const res = await getResidentSnapshot(store, policy(), REPO);
    expect(res?.snapshot.tokens.color["--leaked"]?.value).toBe("token [redacted] embedded");
    expect(res?.snapshot.identity.audience?.value).toBe("reach us at [redacted]");
  });

  it("retention 'none' (default/free tier) serves no anchor refs", async () => {
    const { store } = await approvedStore();
    const res = await getResidentSnapshot(store, policy({ retention: "none" }), REPO);
    expect(res?.snapshot.anchors).toEqual([]);
  });

  it("honors the customer anchor allow/deny route list end-to-end (#17)", async () => {
    const { store } = await approvedStore();
    const allowed = await getResidentSnapshot(store, policy({ allowRoutes: ["/"] }), REPO);
    expect(allowed?.snapshot.anchors.map((a) => a.route)).toEqual(["/"]);
    const denied = await getResidentSnapshot(store, policy({ denyRoutes: ["/promo"] }), REPO);
    expect(denied?.snapshot.anchors.map((a) => a.route)).toEqual(["/"]);
  });

  it("applies extra customer redaction patterns", async () => {
    const { store } = await approvedStore();
    const p = policy({ redactPatterns: [/Apature/g] });
    const res = await getResidentSnapshot(store, p, REPO);
    expect(res?.snapshot.identity.name?.value).toBe("[redacted]");
  });

  it("READ-ONLY: mutating the served snapshot does NOT touch the immutable store", async () => {
    const { store } = await approvedStore();
    const res = await getResidentSnapshot(store, policy(), REPO);
    // Mutate the served copy (it's a clone, and the store's copy is frozen).
    (res!.snapshot.tokens.color["--brand"] as { value: string }).value = "#ffffff";
    res!.snapshot.anchors.push({ ref: "x", route: "/x", description: "x", provenance: "pixels" });
    // Re-read straight from the read contract: unchanged.
    const fresh = await getSnapshot(store, REPO);
    expect(fresh?.snapshot.tokens.color["--brand"]?.value).toBe("#0a0a0a");
    expect(fresh?.snapshot.anchors).toHaveLength(2);
  });

  it("NEVER serves a draft snapshot (read contract's isApproved gate still applies)", async () => {
    const store = inMemorySnapshotStore();
    await commitSnapshot(store, genome()); // committed but draft
    expect(await getResidentSnapshot(store, policy(), REPO)).toBeNull();
  });

  it("logs redacted access metadata only — no fact values or source content", async () => {
    const { store, dnaVersion } = await approvedStore();
    const events: AccessLogEvent[] = [];
    await getResidentSnapshot(store, policy(), REPO, { log: (e) => events.push(e) });
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev).toMatchObject({ tenantId: "t1", repo: REPO, outcome: "served", dnaVersion });
    expect(ev.redactedCount).toBe(2); // the leaked token + the email
    expect(ev.anchorCount).toBe(2);
    // The log carries no fact values, selectors, or raw source.
    expect(JSON.stringify(ev)).not.toContain("sk-");
    expect(JSON.stringify(ev)).not.toContain("founder@");
    expect(JSON.stringify(ev)).not.toContain("#0a0a0a");
  });

  it("logs a denial reason without source content", async () => {
    const { store } = await approvedStore();
    const events: AccessLogEvent[] = [];
    await getResidentSnapshot(store, policy({ entitledRepos: [] }), REPO, { log: (e) => events.push(e) });
    expect(events[0]).toMatchObject({ outcome: "denied", reason: "not_entitled" });
  });

  it("is deterministic for the same policy + snapshot", async () => {
    const { store } = await approvedStore();
    const a = await getResidentSnapshot(store, policy(), REPO);
    const b = await getResidentSnapshot(store, policy(), REPO);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
