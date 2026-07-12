import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { emptyDraft, fact, SCHEMA_VERSION, type DnaSnapshot } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import {
  approveSnapshot,
  commitSnapshot,
  getSnapshot,
  inMemorySnapshotStore,
  requestReview,
  STORE_VERSION,
} from "../src/index.js";

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/golden-snapshot-response.json", import.meta.url)), "utf8"),
) as Record<string, unknown>;

/** The exact snapshot the golden fixture pins (approved, with one human + one config fact). */
function goldenSnapshot(): DnaSnapshot {
  const d = emptyDraft("apatureai", "ui-dna", "extract-1");
  d.identity.tone = fact("calm, precise", 1, "human");
  d.tokens.color["--brand"] = fact("#0a0a0a", 1, "human");
  d.tokens.spacing["--gap"] = fact("8px", 0.75, "config");
  d.distributions = {
    spacingIntervals: [8, 16],
    typeScale: [14, 16],
    colorProportions: { "#0a0a0a": 0.6 },
    radiusPatterns: [],
    density: 1.5,
  };
  d.exceptions = [{ route: "/promo", reason: "seasonal campaign, intentionally off-brand" }];
  return d;
}

async function storeWithApproved() {
  const store = inMemorySnapshotStore();
  const { commit } = await approveSnapshot(store, requestReview(goldenSnapshot()));
  return { store, dnaVersion: commit.dnaVersion };
}

describe("getSnapshot — downstream read contract", () => {
  it("matches the golden wire fixture byte-for-byte (downstream byte-compat)", async () => {
    const { store, dnaVersion } = await storeWithApproved();
    const response = await getSnapshot(store, "apatureai/ui-dna");
    expect(response).not.toBeNull();

    // Substitute the content-addressed dnaVersion into the golden placeholders.
    const expected = JSON.parse(
      JSON.stringify(golden).replace(/GOLDEN_DNA_VERSION/g, dnaVersion),
    );
    expect(JSON.parse(JSON.stringify(response))).toEqual(expected);
  });

  it("stamps the contract version (additive negotiation header)", async () => {
    const { store } = await storeWithApproved();
    const response = await getSnapshot(store, "apatureai/ui-dna");
    expect(response?.contract).toEqual({ schemaVersion: SCHEMA_VERSION, storeVersion: STORE_VERSION });
  });

  it("emits the approved-only envelope required by Source of Truth ingest", async () => {
    const { store, dnaVersion } = await storeWithApproved();
    const response = await getSnapshot(store, "apatureai/ui-dna", { version: dnaVersion });

    expect(response).not.toBeNull();
    expect(response?.contract).toEqual({ schemaVersion: SCHEMA_VERSION, storeVersion: "2" });
    expect(response?.repo).toBe("apatureai/ui-dna");
    expect(response?.dnaVersion).toBe(response?.snapshot.metadata.dnaVersion);
    expect(response?.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(response?.snapshot.metadata.approvalState).toBe("approved");
  });

  it("returns a pinned immutable version when requested", async () => {
    const { store, dnaVersion } = await storeWithApproved();
    const response = await getSnapshot(store, "apatureai/ui-dna", { version: dnaVersion });
    expect(response?.dnaVersion).toBe(dnaVersion);
  });

  it("NEVER serves a draft/in_review snapshot downstream", async () => {
    const store = inMemorySnapshotStore();
    await commitSnapshot(store, goldenSnapshot()); // committed but still draft
    expect(await getSnapshot(store, "apatureai/ui-dna")).toBeNull();
  });

  it("rejects a pinned version that is not approved", async () => {
    const store = inMemorySnapshotStore();
    const { dnaVersion } = await commitSnapshot(store, goldenSnapshot()); // draft
    expect(await getSnapshot(store, "apatureai/ui-dna", { version: dnaVersion })).toBeNull();
  });

  it("returns null for an unknown repo", async () => {
    const { store } = await storeWithApproved();
    expect(await getSnapshot(store, "nobody/nothing")).toBeNull();
  });

  it("returns the LATEST approved version by default", async () => {
    const { store } = await storeWithApproved();
    const v2src = goldenSnapshot();
    v2src.tokens.spacing["--gap"] = fact("12px", 0.75, "config");
    const { commit } = await approveSnapshot(store, requestReview(v2src));
    const response = await getSnapshot(store, "apatureai/ui-dna");
    expect(response?.dnaVersion).toBe(commit.dnaVersion);
    expect(response?.snapshot.tokens.spacing["--gap"]?.value).toBe("12px");
  });
});
