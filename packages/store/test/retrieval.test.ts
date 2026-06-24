import {
  approveSnapshot,
  commitSnapshot,
  inMemorySnapshotStore,
  requestReview,
  retrieveGenomeSlice,
  STORE_VERSION,
} from "../src/index.js";
import { emptyDraft, fact, SCHEMA_VERSION, type DnaSnapshot } from "@uidna/schema";
import { describe, expect, it } from "vitest";

/** An approved genome with tokens across groups, components, multi-route anchors, and an exception. */
function genome(): DnaSnapshot {
  const d = emptyDraft("apatureai", "ui-dna", "extract-1");
  d.identity.name = fact("Apature", 1, "human");
  d.identity.tone = fact("calm, precise", 1, "human");
  d.tokens.color["--brand"] = fact("#0a0a0a", 1, "human");
  d.tokens.color["--accent"] = fact("#2563eb", 0.8, "config");
  d.tokens.spacing["--gap"] = fact("8px", 0.75, "config");
  d.tokens.radii["--md"] = fact("6px", 0.7, "code");
  d.components = [
    { name: "Button", variants: ["default", "ghost"], props: ["size"], usageExamples: [], confidence: 0.9, provenance: "pixels" },
    { name: "Dialog", variants: ["modal"], props: [], usageExamples: [], confidence: 0.8, provenance: "pixels" },
    { name: "Tooltip", variants: [], props: [], usageExamples: [], confidence: 0.6, provenance: "code" },
  ];
  d.anchors = [
    { ref: "s3://anchors/home-1", route: "/", description: "home hero", provenance: "pixels" },
    { ref: "s3://anchors/home-2", route: "/", description: "home footer", provenance: "pixels" },
    { ref: "s3://anchors/settings-1", route: "/settings", description: "settings form", provenance: "pixels" },
    { ref: "s3://anchors/promo-1", route: "/promo", description: "promo banner", provenance: "pixels" },
  ];
  d.exceptions = [
    { route: "/promo", reason: "seasonal campaign, intentionally off-brand" },
    { route: "/legacy", reason: "pre-migration screen, not canonical" },
  ];
  return d;
}

async function approvedStore() {
  const store = inMemorySnapshotStore();
  const { commit } = await approveSnapshot(store, requestReview(genome()));
  return { store, dnaVersion: commit.dnaVersion };
}

describe("retrieveGenomeSlice — genome-grounding retrieval surface (#27)", () => {
  it("returns the bearing slice + the approved dnaVersion to stamp", async () => {
    const { store, dnaVersion } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/ui-dna", {
      routes: ["/"],
      components: ["Button"],
      tokenGroups: ["color"],
    });
    expect(slice).not.toBeNull();
    expect(slice?.dnaVersion).toBe(dnaVersion);
    expect(slice?.repo).toBe("apatureai/ui-dna");
    expect(slice?.contract).toEqual({ schemaVersion: SCHEMA_VERSION, storeVersion: STORE_VERSION });
  });

  it("narrows tokens to the requested groups (other groups empty)", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/ui-dna", { tokenGroups: ["color"] });
    expect(Object.keys(slice!.tokens.color).sort()).toEqual(["--accent", "--brand"]);
    expect(slice!.tokens.spacing).toEqual({});
    expect(slice!.tokens.radii).toEqual({});
  });

  it("returns ALL token groups when none are requested", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/ui-dna", { routes: ["/"] });
    expect(Object.keys(slice!.tokens.color)).toHaveLength(2);
    expect(Object.keys(slice!.tokens.spacing)).toEqual(["--gap"]);
    expect(Object.keys(slice!.tokens.radii)).toEqual(["--md"]);
  });

  it("selects only conventions whose name is in scope", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/ui-dna", { components: ["Dialog", "Button"] });
    expect(slice!.components.map((c) => c.name)).toEqual(["Button", "Dialog"]); // name-sorted
  });

  it("selects only anchors on the in-scope routes", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/ui-dna", { routes: ["/"] });
    expect(slice!.anchors.map((a) => a.ref)).toEqual(["s3://anchors/home-1", "s3://anchors/home-2"]);
  });

  it("annotates in-scope exceptions so critique doesn't flag intentional deviation", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/ui-dna", { routes: ["/promo", "/"] });
    expect(slice!.exceptions).toEqual([
      { route: "/promo", reason: "seasonal campaign, intentionally off-brand", inScope: true },
    ]);
  });

  it("carries product identity whole (always bears on judgment)", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/ui-dna", {});
    expect(slice!.identity.name?.value).toBe("Apature");
    expect(slice!.identity.tone?.value).toBe("calm, precise");
  });

  it("is deterministic: same query + snapshot -> byte-identical slice", async () => {
    const { store } = await approvedStore();
    const q = { routes: ["/", "/settings"], components: ["Button", "Dialog"], tokenGroups: ["color" as const] };
    const a = await retrieveGenomeSlice(store, "apatureai/ui-dna", q);
    const b = await retrieveGenomeSlice(store, "apatureai/ui-dna", q);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("bounds result size: maxAnchors / maxComponents cap the slice", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(
      store,
      "apatureai/ui-dna",
      { routes: ["/"], components: ["Button", "Dialog", "Tooltip"] },
      { maxAnchors: 1, maxComponents: 2 },
    );
    expect(slice!.anchors).toHaveLength(1);
    expect(slice!.anchors[0]!.ref).toBe("s3://anchors/home-1"); // deterministic truncation
    expect(slice!.components).toHaveLength(2);
  });

  it("reads a pinned approved version", async () => {
    const { store, dnaVersion } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/ui-dna", { routes: ["/"] }, { version: dnaVersion });
    expect(slice?.dnaVersion).toBe(dnaVersion);
  });

  it("NEVER retrieves a draft snapshot (reuses the isApproved gate)", async () => {
    const store = inMemorySnapshotStore();
    await commitSnapshot(store, genome()); // committed but still draft
    expect(await retrieveGenomeSlice(store, "apatureai/ui-dna", { routes: ["/"] })).toBeNull();
  });

  it("returns null for an unknown repo", async () => {
    const { store } = await approvedStore();
    expect(await retrieveGenomeSlice(store, "nobody/nothing", { routes: ["/"] })).toBeNull();
  });

  it("empty query retrieves identity + all tokens but no route/component-scoped slices", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/ui-dna", {});
    expect(slice!.components).toEqual([]);
    expect(slice!.anchors).toEqual([]);
    expect(slice!.exceptions).toEqual([]);
    expect(Object.keys(slice!.tokens.color)).toHaveLength(2);
  });
});
