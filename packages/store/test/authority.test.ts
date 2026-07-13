import { describe, expect, it } from "vitest";
import {
  appendAuthorityEvent,
  authorizeRead,
  AUTHORITY_CONTRACT_VERSION,
  hashAuthorityEvent,
  inMemoryAuthorityStore,
  resolveAuthorityStatus,
  type AuthorityEvent,
  type AuthorityKey,
} from "../src/index.js";

const key: AuthorityKey = { tenant: "t1", repo: "apatureai/demo", dnaVersion: "dna_1" };
const actor = { principalId: "u1", principalKind: "user" as const };

function ev(seq: number, status: AuthorityEvent["status"], prior: AuthorityEvent | null, over: Partial<AuthorityEvent> = {}): AuthorityEvent {
  return {
    eventId: `e${seq}`,
    sequence: seq,
    key,
    status,
    effectiveAt: `2026-07-1${seq}T00:00:00.000Z`,
    actor,
    priorEventHash: prior ? hashAuthorityEvent(prior) : null,
    ...over,
  };
}

describe("append-only authority log — valid transitions (#64)", () => {
  it("effective → revoked converges and a revoked version is never served as approved", () => {
    const e1 = ev(1, "effective", null);
    const r1 = appendAuthorityEvent([], e1);
    expect(r1.ok).toBe(true);
    const e2 = ev(2, "revoked", e1, { reason: "compromised_account" });
    const r2 = r1.ok ? appendAuthorityEvent(r1.log, e2) : r1;
    expect(r2.ok && resolveAuthorityStatus(r2.log)).toBe("revoked");
    expect(authorizeRead("revoked", "latest")).toEqual({ serve: false, status: "revoked", reason: "revoked" });
    expect(authorizeRead("revoked", "pinned")).toEqual({ serve: false, status: "revoked", reason: "revoked" });
  });

  it("superseded stays pin-readable only (reproducibility), effective serves normally", () => {
    expect(authorizeRead("superseded", "pinned").serve).toBe(true);
    expect(authorizeRead("superseded", "latest")).toEqual({ serve: false, status: "superseded", reason: "superseded_not_pinned" });
    expect(authorizeRead("effective", "latest").serve).toBe(true);
  });

  it("an empty log reads as effective", () => {
    expect(resolveAuthorityStatus([])).toBe("effective");
  });
});

describe("authority log fails closed on unsafe events (#64)", () => {
  const e1 = ev(1, "effective", null);
  const base = appendAuthorityEvent([], e1);
  const log = base.ok ? base.log : [];

  it("rejects a revocation with no reason", () => {
    expect(appendAuthorityEvent(log, ev(2, "revoked", e1))).toEqual({ ok: false, reason: "missing_revocation_reason" });
  });
  it("rejects a sequence gap", () => {
    expect(appendAuthorityEvent(log, ev(3, "superseded", e1)).ok).toBe(false);
  });
  it("rejects a broken hash chain", () => {
    const forged = ev(2, "revoked", null, { reason: "other", priorEventHash: "sha256:" + "0".repeat(64) });
    expect(appendAuthorityEvent(log, forged)).toEqual({ ok: false, reason: "prior_hash_mismatch" });
  });
  it("rejects a backdated effective time", () => {
    const backdated = ev(2, "revoked", e1, { reason: "other", effectiveAt: "2026-07-01T00:00:00.000Z" });
    expect(appendAuthorityEvent(log, backdated)).toEqual({ ok: false, reason: "backdated_effective_time" });
  });
  it("rejects an illegal transition (a terminal revoked cannot move)", () => {
    const e2 = ev(2, "revoked", e1, { reason: "other" });
    const revoked = appendAuthorityEvent(log, e2);
    const next = revoked.ok ? appendAuthorityEvent(revoked.log, ev(3, "superseded", e2)) : revoked;
    expect(next).toEqual({ ok: false, reason: "illegal_status_transition" });
  });
  it("rejects a first event that is not effective", () => {
    expect(appendAuthorityEvent([], ev(1, "superseded", null))).toEqual({ ok: false, reason: "first_event_not_effective" });
  });
  it("is idempotent on an exact event-id replay (no duplicate)", () => {
    const replay = appendAuthorityEvent(log, e1);
    expect(replay).toEqual({ ok: true, log, idempotentReplay: true });
  });
  it("rejects a reused event id that is out of order", () => {
    const e2 = ev(2, "superseded", e1, { eventId: "e1", replacementDnaVersion: "dna_2" });
    expect(appendAuthorityEvent(log, e2)).toEqual({ ok: false, reason: "duplicate_out_of_order_event" });
  });
});

describe("in-memory authority store lifecycle drill (#64)", () => {
  it("approve A → serve A → revoke A → reads fail → (B effective) latest resolves B", () => {
    const store = inMemoryAuthorityStore();
    const a1 = ev(1, "effective", null);
    expect(store.append(a1).ok).toBe(true);
    // serve A while effective
    expect(authorizeRead(store.status(key).status, "latest").serve).toBe(true);
    // revoke A
    const a2 = ev(2, "revoked", a1, { reason: "sensitive_anchor" });
    expect(store.append(a2).ok).toBe(true);
    const statusA = store.status(key);
    expect(statusA.status).toBe("revoked");
    expect(statusA.contractVersion).toBe(AUTHORITY_CONTRACT_VERSION);
    expect(statusA.headEventHash).toBe(hashAuthorityEvent(a2));
    expect(authorizeRead(statusA.status, "latest").serve).toBe(false);
    // a separate version B is independently effective
    const keyB: AuthorityKey = { ...key, dnaVersion: "dna_2" };
    const b1: AuthorityEvent = { ...ev(1, "effective", null), eventId: "b1", key: keyB };
    expect(store.append(b1).ok).toBe(true);
    expect(authorizeRead(store.status(keyB).status, "latest").serve).toBe(true);
    // A stays revoked, isolated from B
    expect(store.status(key).status).toBe("revoked");
  });
});
