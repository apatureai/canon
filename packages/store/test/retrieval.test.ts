import {
  approveSnapshot,
  commitSnapshot,
  inMemorySnapshotStore,
  requestReview,
  retrieveGenomeSlice,
  retrieveRawGenomeSlice,
  STORE_VERSION,
} from "../src/index.js";
import { emptyDraft, fact, SCHEMA_VERSION, type DnaSnapshot } from "@apatureai/canon-schema";
import { describe, expect, it } from "vitest";

/** An approved genome with tokens across groups, components, multi-route anchors, and an exception. */
function genome(): DnaSnapshot {
  const d = emptyDraft("apatureai", "canon", "extract-1");
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

/** A genome carrying a secret in a token value + key, used to assert the trust boundary. */
function genomeWithSecret(): DnaSnapshot {
  const d = emptyDraft("apatureai", "canon", "extract-1");
  d.tokens.color["--brand"] = fact("#0a0a0a", 1, "human");
  d.tokens.color["--leaked"] = fact("token sk-ABCDEF0123456789XYZ embedded", 0.5, "config");
  d.tokens.color["--key-sk-ABCDEF0123456789XYZ"] = fact("#fff", 0.5, "config");
  return d;
}

async function approvedStoreWithSecret() {
  const store = inMemorySnapshotStore();
  await approveSnapshot(store, requestReview(genomeWithSecret()));
  return store;
}

describe("retrieveGenomeSlice — genome-grounding retrieval surface (#27)", () => {
  it("returns the bearing slice + the approved dnaVersion to stamp", async () => {
    const { store, dnaVersion } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/canon", {
      routes: ["/"],
      components: ["Button"],
      tokenGroups: ["color"],
    });
    expect(slice).not.toBeNull();
    expect(slice?.dnaVersion).toBe(dnaVersion);
    expect(slice?.repo).toBe("apatureai/canon");
    expect(slice?.contract).toEqual({ schemaVersion: SCHEMA_VERSION, storeVersion: STORE_VERSION });
  });

  it("narrows tokens to the requested groups (other groups empty)", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/canon", { tokenGroups: ["color"] });
    expect(Object.keys(slice!.tokens.color).sort()).toEqual(["--accent", "--brand"]);
    expect(slice!.tokens.spacing).toEqual({});
    expect(slice!.tokens.radii).toEqual({});
  });

  it("returns ALL token groups when none are requested", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/canon", { routes: ["/"] });
    expect(Object.keys(slice!.tokens.color)).toHaveLength(2);
    expect(Object.keys(slice!.tokens.spacing)).toEqual(["--gap"]);
    expect(Object.keys(slice!.tokens.radii)).toEqual(["--md"]);
  });

  it("selects only conventions whose name is in scope", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/canon", { components: ["Dialog", "Button"] });
    expect(slice!.components.map((c) => c.name)).toEqual(["Button", "Dialog"]); // name-sorted
  });

  it("selects only anchors on the in-scope routes", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/canon", { routes: ["/"] });
    expect(slice!.anchors.map((a) => a.ref)).toEqual(["s3://anchors/home-1", "s3://anchors/home-2"]);
  });

  it("annotates in-scope exceptions so critique doesn't flag intentional deviation", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/canon", { routes: ["/promo", "/"] });
    expect(slice!.exceptions).toEqual([
      { route: "/promo", reason: "seasonal campaign, intentionally off-brand", inScope: true },
    ]);
  });

  it("carries product identity whole (always bears on judgment)", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/canon", {});
    expect(slice!.identity.name?.value).toBe("Apature");
    expect(slice!.identity.tone?.value).toBe("calm, precise");
  });

  it("is deterministic: same query + snapshot -> byte-identical slice", async () => {
    const { store } = await approvedStore();
    const q = { routes: ["/", "/settings"], components: ["Button", "Dialog"], tokenGroups: ["color" as const] };
    const a = await retrieveGenomeSlice(store, "apatureai/canon", q);
    const b = await retrieveGenomeSlice(store, "apatureai/canon", q);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("bounds result size: maxAnchors / maxComponents cap the slice", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(
      store,
      "apatureai/canon",
      { routes: ["/"], components: ["Button", "Dialog", "Tooltip"] },
      { maxAnchors: 1, maxComponents: 2 },
    );
    expect(slice!.anchors).toHaveLength(1);
    expect(slice!.anchors[0]!.ref).toBe("s3://anchors/home-1"); // deterministic truncation
    expect(slice!.components).toHaveLength(2);
  });

  it("reads a pinned approved version", async () => {
    const { store, dnaVersion } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/canon", { routes: ["/"] }, { version: dnaVersion });
    expect(slice?.dnaVersion).toBe(dnaVersion);
  });

  it("NEVER retrieves a draft snapshot (reuses the isApproved gate)", async () => {
    const store = inMemorySnapshotStore();
    await commitSnapshot(store, genome()); // committed but still draft
    expect(await retrieveGenomeSlice(store, "apatureai/canon", { routes: ["/"] })).toBeNull();
  });

  it("returns null for an unknown repo", async () => {
    const { store } = await approvedStore();
    expect(await retrieveGenomeSlice(store, "nobody/nothing", { routes: ["/"] })).toBeNull();
  });

  it("empty query retrieves identity + all tokens but no route/component-scoped slices", async () => {
    const { store } = await approvedStore();
    const slice = await retrieveGenomeSlice(store, "apatureai/canon", {});
    expect(slice!.components).toEqual([]);
    expect(slice!.anchors).toEqual([]);
    expect(slice!.exceptions).toEqual([]);
    expect(Object.keys(slice!.tokens.color)).toHaveLength(2);
  });

  it("SCRUBS by default: a secret-pattern value does NOT reach the engine-facing slice", async () => {
    const store = await approvedStoreWithSecret();
    const slice = await retrieveGenomeSlice(store, "apatureai/canon", { tokenGroups: ["color"] });
    // Secret in a value is redacted before the engine ever sees it.
    expect(slice!.tokens.color["--leaked"]?.value).toBe("token [redacted] embedded");
    // Secret in a token KEY is redacted too.
    expect(Object.keys(slice!.tokens.color)).toContain("--key-[redacted]");
    // ZERO egress: the secret pattern appears nowhere in the served slice.
    expect(JSON.stringify(slice)).not.toContain("sk-ABCDEF");
  });

  it("retrieveRawGenomeSlice is the explicit trust-internal raw path (unscrubbed)", async () => {
    const store = await approvedStoreWithSecret();
    const raw = await retrieveRawGenomeSlice(store, "apatureai/canon", { tokenGroups: ["color"] });
    // The raw path intentionally preserves the original value (use inside the boundary only).
    expect(raw!.tokens.color["--leaked"]?.value).toBe("token sk-ABCDEF0123456789XYZ embedded");
  });

  it("raw and scrubbed paths share the approved-only gate (no draft via either)", async () => {
    const store = inMemorySnapshotStore();
    await commitSnapshot(store, genomeWithSecret()); // draft
    expect(await retrieveGenomeSlice(store, "apatureai/canon", {})).toBeNull();
    expect(await retrieveRawGenomeSlice(store, "apatureai/canon", {})).toBeNull();
  });
});
