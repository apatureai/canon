import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractTokensJson } from "@uidna/context";
import { emptyDraft, fact, type DnaSnapshot } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import {
  approveSnapshot,
  computeSnapshotContentDigest,
  getLatticeDnaProfile,
  inMemorySnapshotStore,
  InvalidLatticeProfileSourceError,
  projectLatticeDnaProfile,
  requestReview,
  UnapprovedLatticeProfileError,
  UnsupportedLatticeProfileVersionError,
  type LatticeDnaProfile,
} from "../src/index.js";

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/lattice-dna-profile.v1.json", import.meta.url)), "utf8"),
) as LatticeDnaProfile;

function genome(): DnaSnapshot {
  const d = emptyDraft("apatureai", "canon", "extract-lattice-profile-1");
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

describe("Lattice UI-DNA read profile", () => {
  it("matches the producer golden", () => {
    const snapshot = genome();
    snapshot.metadata = { ...snapshot.metadata, approvalState: "approved", dnaVersion: "dna_golden_v1" };
    const profile = projectLatticeDnaProfile(snapshot, "apatureai/canon", "dna_golden_v1");
    expect(profile).toEqual(golden);
    // The digest Lattice verifies before mirroring is over the genome content, not the profile.
    expect(profile.dnaContentDigest).toBe(computeSnapshotContentDigest(snapshot));
  });

  it("keys every token by field id with value, category, and confidence", () => {
    const snapshot = genome();
    snapshot.metadata = { ...snapshot.metadata, approvalState: "approved", dnaVersion: "v1" };
    const profile = projectLatticeDnaProfile(snapshot, "apatureai/canon", "v1");
    expect(profile.state).toBe("approved");
    expect(profile.tokens["tokens.color.--brand"]).toEqual({ value: "#ABCDEF", category: "color", confidence: 1 });
    expect(profile.tokens["tokens.spacing.--space-2"]).toEqual({ value: "8px", category: "spacing", confidence: 0.7 });
    expect(profile.tokens["tokens.radii.--radius-sm"]).toEqual({ value: "4px", category: "radius", confidence: 0.6 });
  });

  it("refuses a snapshot that is not approved", () => {
    expect(() => projectLatticeDnaProfile(genome(), "apatureai/canon", "0")).toThrow(UnapprovedLatticeProfileError);
  });

  it("refuses a repo or version that does not match the snapshot", () => {
    const snapshot = genome();
    snapshot.metadata = { ...snapshot.metadata, approvalState: "approved", dnaVersion: "v1" };
    expect(() => projectLatticeDnaProfile(snapshot, "other/repo", "v1")).toThrow(InvalidLatticeProfileSourceError);
    expect(() => projectLatticeDnaProfile(snapshot, "apatureai/canon", "wrong")).toThrow(
      InvalidLatticeProfileSourceError,
    );
  });

  it("serves the latest approved genome through the store, gated on approval", async () => {
    const { store, dnaVersion } = await approvedStore();
    const profile = await getLatticeDnaProfile(store, "apatureai/canon");
    expect(profile).not.toBeNull();
    expect(profile!.dnaVersion).toBe(dnaVersion);

    const draftStore = inMemorySnapshotStore();
    await draftStore.put({ repo: "apatureai/canon", dnaVersion: "d1", snapshot: genome() });
    expect(await getLatticeDnaProfile(draftStore, "apatureai/canon")).toBeNull();
  });

  it("fails closed on an unsupported projection schema version", async () => {
    const { store } = await approvedStore();
    await expect(
      getLatticeDnaProfile(store, "apatureai/canon", { projectionSchemaVersion: "999" }),
    ).rejects.toThrow(UnsupportedLatticeProfileVersionError);
  });
});
