import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractTokensJson } from "@uidna/context";
import { emptyDraft, fact, type DnaSnapshot } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import {
  approveSnapshot,
  computeVerdictDnaProfileDigest,
  getVerdictDnaProfile,
  inMemorySnapshotStore,
  InvalidVerdictProfileSourceError,
  projectVerdictDnaProfile,
  requestReview,
  UnapprovedVerdictProfileError,
  UnsupportedVerdictProfileVersionError,
  type VerdictDnaProfile,
} from "../src/index.js";

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/verdict-dna-profile.v1.json", import.meta.url)), "utf8"),
) as VerdictDnaProfile;

function genome(): DnaSnapshot {
  const d = emptyDraft("apatureai", "canon", "extract-verdict-profile-1");
  const resolved = extractTokensJson({
    primitive: {
      brand: {
        $type: "color",
        $value: { colorSpace: "srgb", components: [0.667, 0.733, 0.8], hex: "#aabbcc" },
      },
    },
    semantic: { brand: { $value: "{primitive.brand}" } },
  });
  d.tokens.color["semantic.brand"] = resolved.color["semantic.brand"]!;
  d.tokens.color["--brand"] = fact("#ABCDEF", 1, "human");
  d.tokens.spacing["--space-2"] = fact("8px", 0.7, "code");
  d.tokens.radii["--radius-sm"] = fact("4px", 0.6, "code");
  return d;
}

async function approvedStore() {
  const store = inMemorySnapshotStore();
  const { commit } = await approveSnapshot(store, requestReview(genome()));
  return { store, dnaVersion: commit.dnaVersion };
}

describe("Verdict UI-DNA read profile", () => {
  it("matches the producer golden and stamps a verifiable deterministic digest", () => {
    const snapshot = genome();
    snapshot.metadata = { ...snapshot.metadata, approvalState: "approved", dnaVersion: "dna_golden_v1" };
    const profile = projectVerdictDnaProfile(snapshot, "apatureai/canon", "dna_golden_v1");
    expect(profile).toEqual(golden);
    const { contentDigest, ...unsigned } = profile;
    expect(contentDigest).toBe(computeVerdictDnaProfileDigest(unsigned));
  });

  it("carries every token as an item Verdict can load as a rule", () => {
    const snapshot = genome();
    snapshot.metadata = { ...snapshot.metadata, approvalState: "approved", dnaVersion: "dna_golden_v1" };
    const profile = projectVerdictDnaProfile(snapshot, "apatureai/canon", "dna_golden_v1");
    expect(profile.snapshot.approval_state).toBe("approved");
    // Items are ordered by category then key, so the wire is stable.
    expect(profile.snapshot.items.map((i) => i.field_id)).toEqual([
      "tokens.color.--brand",
      "tokens.color.semantic.brand",
      "tokens.spacing.--space-2",
      "tokens.radii.--radius-sm",
    ]);
    expect(profile.snapshot.items[0]).toEqual({
      field_id: "tokens.color.--brand",
      kind: "color",
      value: "#ABCDEF",
      confidence: 1,
      provenance: "human",
    });
  });

  it("refuses a snapshot that is not approved", () => {
    expect(() => projectVerdictDnaProfile(genome(), "apatureai/canon", "0")).toThrow(UnapprovedVerdictProfileError);
  });

  it("refuses a repo or version that does not match the snapshot", () => {
    const snapshot = genome();
    snapshot.metadata = { ...snapshot.metadata, approvalState: "approved", dnaVersion: "v1" };
    expect(() => projectVerdictDnaProfile(snapshot, "other/repo", "v1")).toThrow(InvalidVerdictProfileSourceError);
    expect(() => projectVerdictDnaProfile(snapshot, "apatureai/canon", "wrong")).toThrow(
      InvalidVerdictProfileSourceError,
    );
  });

  it("serves the latest approved genome through the store, gated on approval", async () => {
    const { store, dnaVersion } = await approvedStore();
    const profile = await getVerdictDnaProfile(store, "apatureai/canon");
    expect(profile).not.toBeNull();
    expect(profile!.snapshot.dna_version).toBe(dnaVersion);

    // A draft-only repo never projects.
    const draftStore = inMemorySnapshotStore();
    await draftStore.put({ repo: "apatureai/canon", dnaVersion: "d1", snapshot: genome() });
    expect(await getVerdictDnaProfile(draftStore, "apatureai/canon")).toBeNull();
  });

  it("fails closed on an unsupported profile version", async () => {
    const { store } = await approvedStore();
    await expect(getVerdictDnaProfile(store, "apatureai/canon", { profileVersion: "999" })).rejects.toThrow(
      UnsupportedVerdictProfileVersionError,
    );
  });
});
