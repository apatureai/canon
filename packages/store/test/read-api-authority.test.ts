import { extractTokensJson } from "@uidna/context";
import { emptyDraft, fact, type DnaSnapshot } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import {
  approveSnapshot,
  getSnapshot,
  inMemorySnapshotStore,
  requestReview,
  type AuthorityStatus,
  type AuthorityStatusResolver,
} from "../src/index.js";

/**
 * Read-path enforcement of approval authority (#64, acceptance item 3): the
 * ordinary downstream read contract must consult authority status so a `revoked`
 * version is never served as approved, a `superseded` version is pin-readable
 * only, and `latest` resolves to the newest still-`effective` version. Exercises
 * the withdrawal-propagation read behavior the completed genome lifecycle drill
 * did not cover.
 */

function baseSnapshot(): DnaSnapshot {
  const d = emptyDraft("apatureai", "canon", "extract-1");
  d.identity.tone = fact("calm, precise", 1, "human");
  d.tokens.color["--brand"] = fact("#0a0a0a", 1, "human");
  const resolved = extractTokensJson({
    primitive: {
      brand: { $type: "color", $value: { colorSpace: "srgb", components: [0.04, 0.04, 0.04], hex: "#0a0a0a" } },
    },
    semantic: { brand: { $value: "{primitive.brand}" } },
  });
  d.tokens.color["semantic.brand"] = resolved.color["semantic.brand"]!;
  d.tokens.spacing["--gap"] = fact("8px", 0.75, "config");
  return d;
}

/** Approve a distinct version by perturbing a field, returning its dnaVersion. */
async function approveVersion(store: ReturnType<typeof inMemorySnapshotStore>, gap: string): Promise<string> {
  const src = baseSnapshot();
  src.tokens.spacing["--gap"] = fact(gap, 0.75, "config");
  const { commit } = await approveSnapshot(store, requestReview(src));
  return commit.dnaVersion;
}

/** A resolver over an explicit version→status map (unlisted versions are `effective`). */
function resolverFrom(map: Record<string, AuthorityStatus>): AuthorityStatusResolver {
  return (dnaVersion) => map[dnaVersion] ?? "effective";
}

const REPO = "apatureai/canon";

describe("getSnapshot authority enforcement (#64) — pinned reads", () => {
  it("serves an effective pinned version", async () => {
    const store = inMemorySnapshotStore();
    const v = await approveVersion(store, "8px");
    const res = await getSnapshot(store, REPO, { version: v, resolveAuthority: resolverFrom({ [v]: "effective" }) });
    expect(res?.dnaVersion).toBe(v);
  });

  it("fails closed (null, non-enumerating) on a revoked pinned version", async () => {
    const store = inMemorySnapshotStore();
    const v = await approveVersion(store, "8px");
    const res = await getSnapshot(store, REPO, { version: v, resolveAuthority: resolverFrom({ [v]: "revoked" }) });
    // Indistinguishable from an unknown version: same null both ways.
    const unknown = await getSnapshot(store, REPO, { version: "does-not-exist", resolveAuthority: resolverFrom({}) });
    expect(res).toBeNull();
    expect(unknown).toBeNull();
  });

  it("still serves a superseded pinned version (reproducibility policy)", async () => {
    const store = inMemorySnapshotStore();
    const v = await approveVersion(store, "8px");
    const res = await getSnapshot(store, REPO, { version: v, resolveAuthority: resolverFrom({ [v]: "superseded" }) });
    expect(res?.dnaVersion).toBe(v);
  });
});

describe("getSnapshot authority enforcement (#64) — latest reads", () => {
  it("skips a revoked newest version and falls back to the prior effective one", async () => {
    const store = inMemorySnapshotStore();
    const v1 = await approveVersion(store, "8px");
    const v2 = await approveVersion(store, "12px");
    const res = await getSnapshot(store, REPO, { resolveAuthority: resolverFrom({ [v2]: "revoked" }) });
    expect(res?.dnaVersion).toBe(v1);
  });

  it("skips a superseded version for latest and returns the effective replacement", async () => {
    const store = inMemorySnapshotStore();
    const v1 = await approveVersion(store, "8px");
    const v2 = await approveVersion(store, "12px");
    const res = await getSnapshot(store, REPO, { resolveAuthority: resolverFrom({ [v1]: "superseded", [v2]: "effective" }) });
    expect(res?.dnaVersion).toBe(v2);
  });

  it("returns null for latest when the only approved version is revoked", async () => {
    const store = inMemorySnapshotStore();
    const v = await approveVersion(store, "8px");
    const res = await getSnapshot(store, REPO, { resolveAuthority: resolverFrom({ [v]: "revoked" }) });
    expect(res).toBeNull();
  });
});

describe("getSnapshot authority enforcement (#64) — backward compatibility", () => {
  it("without a resolver, preserves pre-authority behavior (serves any approved)", async () => {
    const store = inMemorySnapshotStore();
    const v = await approveVersion(store, "8px");
    // No resolveAuthority: authority status is not consulted at all.
    expect((await getSnapshot(store, REPO))?.dnaVersion).toBe(v);
    expect((await getSnapshot(store, REPO, { version: v }))?.dnaVersion).toBe(v);
  });
});

describe("getSnapshot authority enforcement (#64) — withdrawal-propagation drill", () => {
  it("approve A -> serve A -> revoke A -> latest & pinned fail -> approve B -> latest resolves B", async () => {
    const store = inMemorySnapshotStore();
    const status: Record<string, AuthorityStatus> = {};
    const resolve = resolverFrom(status);

    // approve A, serve it as latest and pinned
    const a = await approveVersion(store, "8px");
    status[a] = "effective";
    expect((await getSnapshot(store, REPO, { resolveAuthority: resolve }))?.dnaVersion).toBe(a);
    expect((await getSnapshot(store, REPO, { version: a, resolveAuthority: resolve }))?.dnaVersion).toBe(a);

    // revoke A: both latest and pinned ordinary reads now fail closed
    status[a] = "revoked";
    expect(await getSnapshot(store, REPO, { resolveAuthority: resolve })).toBeNull();
    expect(await getSnapshot(store, REPO, { version: a, resolveAuthority: resolve })).toBeNull();

    // approve B: latest resolves B; pinned A stays revoked (withdrawn) forever
    const b = await approveVersion(store, "12px");
    status[b] = "effective";
    expect((await getSnapshot(store, REPO, { resolveAuthority: resolve }))?.dnaVersion).toBe(b);
    expect(await getSnapshot(store, REPO, { version: a, resolveAuthority: resolve })).toBeNull();
    expect((await getSnapshot(store, REPO, { version: b, resolveAuthority: resolve }))?.dnaVersion).toBe(b);
  });
});
