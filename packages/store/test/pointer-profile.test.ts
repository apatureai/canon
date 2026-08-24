import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractTokensJson } from "@apatureai/canon-context";
import { emptyDraft, fact, type DnaSnapshot } from "@apatureai/canon-schema";
import { describe, expect, it } from "vitest";
import {
  approveSnapshot,
  commitSnapshot,
  computePointerLocalCheckProfileDigest,
  getPointerLocalCheckProfile,
  inMemorySnapshotStore,
  InvalidPointerProfileSourceError,
  requestReview,
  projectPointerLocalCheckProfile,
  type PointerLocalCheckProfile,
  UnapprovedPointerProfileError,
  UnsupportedPointerProfileVersionError,
} from "../src/index.js";

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/pointer-local-check-profile.v1.json", import.meta.url)), "utf8"),
) as PointerLocalCheckProfile;

function genome(): DnaSnapshot {
  const d = emptyDraft("apatureai", "canon", "extract-pointer-profile-1");
  d.tokens.color["--brand"] = fact("#ABC", 1, "human");
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
  d.tokens.color["--gradient"] = fact("linear-gradient(red, blue)", 1, "human");
  d.distributions = {
    spacingIntervals: [16, 4, 8, 8],
    typeScale: [24, 14, 16],
    colorProportions: {},
    radiusPatterns: [8, 4],
    density: null,
  };
  d.components = [{
    name: "Button",
    variants: ["primary"],
    props: [],
    usageExamples: [],
    confidence: 1,
    provenance: "human",
  }];
  return d;
}

async function approvedStore() {
  const store = inMemorySnapshotStore();
  const { commit } = await approveSnapshot(store, requestReview(genome()));
  return { store, dnaVersion: commit.dnaVersion };
}

describe("Pointer local-check read profile (#59)", () => {
  it("matches the producer golden and stamps a verifiable deterministic digest", async () => {
    const snapshot = genome();
    snapshot.metadata = { ...snapshot.metadata, approvalState: "approved", dnaVersion: "dna_golden_v1" };
    const profile = projectPointerLocalCheckProfile(snapshot, "apatureai/canon", "dna_golden_v1");
    expect(profile).toEqual(golden);
    const { contentDigest, ...unsigned } = profile;
    expect(contentDigest).toBe(computePointerLocalCheckProfileDigest(unsigned));
    expect(profile.compactIndexes.colorTokens).toContainEqual(expect.objectContaining({
      id: "tokens.color.semantic.brand",
      hex: "#aabbcc",
    }));
    expect(JSON.stringify(profile)).not.toContain("{primitive.brand}");
  });

  it("is byte-identical for the same approved snapshot and profile version", async () => {
    const { store } = await approvedStore();
    const a = await getPointerLocalCheckProfile(store, "apatureai/canon");
    const b = await getPointerLocalCheckProfile(store, "apatureai/canon", { profileVersion: "1" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("serves a pinned approved version and never projects a draft", async () => {
    const { store, dnaVersion } = await approvedStore();
    expect((await getPointerLocalCheckProfile(store, "apatureai/canon", { dnaVersion }))?.dnaVersion).toBe(dnaVersion);

    const drafts = inMemorySnapshotStore();
    await commitSnapshot(drafts, genome());
    expect(await getPointerLocalCheckProfile(drafts, "apatureai/canon")).toBeNull();
    expect(() => projectPointerLocalCheckProfile(genome(), "apatureai/canon", "draft"))
      .toThrow(UnapprovedPointerProfileError);
  });

  it("fails closed on an unsupported profile version", async () => {
    const { store } = await approvedStore();
    await expect(
      getPointerLocalCheckProfile(store, "apatureai/canon", { profileVersion: "2" }),
    ).rejects.toBeInstanceOf(UnsupportedPointerProfileVersionError);
  });

  it("rejects mismatched repository, DNA lineage, and schema stamps", () => {
    const snapshot = genome();
    snapshot.metadata = { ...snapshot.metadata, approvalState: "approved", dnaVersion: "dna_source_v1" };

    expect(() => projectPointerLocalCheckProfile(snapshot, "apatureai/some-other-repo", "dna_source_v1"))
      .toThrow(InvalidPointerProfileSourceError);
    expect(() => projectPointerLocalCheckProfile(snapshot, "apatureai/canon", "dna_other"))
      .toThrow(InvalidPointerProfileSourceError);

    snapshot.metadata.schemaVersion = "999";
    expect(() => projectPointerLocalCheckProfile(snapshot, "apatureai/canon", "dna_source_v1"))
      .toThrow(InvalidPointerProfileSourceError);
  });

  it("does not guess component signatures or treat policy defaults as team preferences", async () => {
    const { store } = await approvedStore();
    const profile = await getPointerLocalCheckProfile(store, "apatureai/canon");
    expect(profile?.compactIndexes.components).toEqual([]);
    expect(profile?.compactIndexes.targetSize.source.authority).toBe("policy_default");
    expect(profile?.compactIndexes.contrast.source.authority).toBe("policy_default");
    expect(profile?.compactIndexes.colorTokens[0]?.source.authority).toBe("approved_ui_dna");
    // Non-hex color facts are not silently recast into deterministic color rules.
    expect(profile?.compactIndexes.colorTokens).toHaveLength(2);
  });
});
