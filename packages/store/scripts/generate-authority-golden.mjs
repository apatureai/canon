import console from "node:console";
import { writeFileSync } from "node:fs";
import { URL } from "node:url";
const { appendAuthorityEvent, authorizeRead, hashAuthorityEvent, AUTHORITY_CONTRACT_VERSION } = await import(new URL("../dist/index.js", import.meta.url).href);

const key = { tenant: "tenant_gold", repo: "apatureai/golden", dnaVersion: "dna_A" };
const keyB = { ...key, dnaVersion: "dna_B" };
const actor = { principalId: "approver_1", principalKind: "user" };

const ev = (eventId, sequence, k, status, effectiveAt, prior, extra = {}) => ({
  eventId, sequence, key: k, status, effectiveAt, actor,
  priorEventHash: prior ? hashAuthorityEvent(prior) : null, ...extra,
});

// Withdrawal drill: approve A → revoke A → approve B (independent key).
const a1 = ev("gold_a1", 1, key, "effective", "2026-07-01T00:00:00.000Z", null);
const a2 = ev("gold_a2", 2, key, "revoked", "2026-07-10T00:00:00.000Z", a1, { reason: "standard_withdrawn" });
const b1 = ev("gold_b1", 1, keyB, "effective", "2026-07-11T00:00:00.000Z", null);

// Supersession chain: effective → superseded (pin-only) → revoked (terminal).
const s1 = ev("gold_s1", 1, { ...key, dnaVersion: "dna_S" }, "effective", "2026-07-01T00:00:00.000Z", null);
const s2 = ev("gold_s2", 2, { ...key, dnaVersion: "dna_S" }, "superseded", "2026-07-05T00:00:00.000Z", s1, { replacementDnaVersion: "dna_B" });
const s3 = ev("gold_s3", 3, { ...key, dnaVersion: "dna_S" }, "revoked", "2026-07-12T00:00:00.000Z", s2, { reason: "bad_signoff" });

function replay(events) {
  let log = [];
  const steps = [];
  for (const event of events) {
    const result = appendAuthorityEvent(log, event);
    if (!result.ok) throw new Error(`golden replay rejected: ${result.reason}`);
    log = [...result.log];
    const head = log[log.length - 1];
    steps.push({
      event,
      expected: {
        status: head.status,
        sequence: head.sequence,
        headEventHash: hashAuthorityEvent(head),
      },
    });
  }
  return steps;
}

// Rejection vectors: [description, baseEvents, offendingEvent, expectedReason]
const rejections = [
  { name: "missing_revocation_reason", base: [a1], event: ev("gold_r1", 2, key, "revoked", "2026-07-10T00:00:00.000Z", a1), reason: "missing_revocation_reason" },
  { name: "sequence_gap", base: [a1], event: ev("gold_r2", 3, key, "revoked", "2026-07-10T00:00:00.000Z", a1, { reason: "other" }), reason: "sequence_gap" },
  { name: "prior_hash_mismatch", base: [a1], event: { ...ev("gold_r3", 2, key, "revoked", "2026-07-10T00:00:00.000Z", null, { reason: "other" }), priorEventHash: "sha256:" + "0".repeat(64) }, reason: "prior_hash_mismatch" },
  { name: "backdated_effective_time", base: [a1], event: ev("gold_r4", 2, key, "revoked", "2026-06-01T00:00:00.000Z", a1, { reason: "other" }), reason: "backdated_effective_time" },
  { name: "illegal_status_transition_after_revoked", base: [a1, a2], event: ev("gold_r5", 3, key, "superseded", "2026-07-13T00:00:00.000Z", a2, { replacementDnaVersion: "dna_B" }), reason: "illegal_status_transition" },
  { name: "wrong_tenant", base: [a1], event: ev("gold_r6", 2, { ...key, tenant: "tenant_other" }, "revoked", "2026-07-10T00:00:00.000Z", a1, { reason: "other" }), reason: "wrong_tenant" },
  { name: "first_event_not_effective", base: [], event: ev("gold_r7", 1, key, "revoked", "2026-07-01T00:00:00.000Z", null, { reason: "other" }), reason: "first_event_not_effective" },
  { name: "duplicate_out_of_order_event", base: [a1, a2], event: { ...a1 }, reason: "duplicate_out_of_order_event" },
];
// Sanity: every rejection actually rejects with the declared reason.
for (const r of rejections) {
  let log = [];
  for (const e of r.base) { const res = appendAuthorityEvent(log, e); if (!res.ok) throw new Error("bad base"); log = [...res.log]; }
  const res = appendAuthorityEvent(log, r.event);
  if (res.ok || res.reason !== r.reason) throw new Error(`rejection vector ${r.name} produced ${res.ok ? "ok" : res.reason}`);
}

// Idempotent replay vector: re-appending the exact head is a no-op.
const replayVector = { base: [a1, a2], event: a2 };

const readDecisions = [];
for (const status of ["effective", "superseded", "revoked"]) {
  for (const mode of ["latest", "pinned"]) {
    readDecisions.push({ status, mode, expected: authorizeRead(status, mode) });
  }
}

const golden = {
  description:
    "Shared authority-status golden vectors (ui-dna#72 / #64). UI-DNA is the sole authority; " +
    "Source of Truth, DNA Consultant, and Judgment Engine mirror this file BYTE-IDENTICALLY and " +
    "assert their (effective|revoked) handling against it, so all four consumers converge on one " +
    "mirror source. Regenerate only in ui-dna (packages/store/test/authority-golden.test.ts " +
    "documents how); never hand-edit a downstream copy.",
  contractVersion: AUTHORITY_CONTRACT_VERSION,
  scenarios: {
    withdrawalDrill: replay([a1, a2]),
    independentReplacement: replay([b1]),
    supersessionChain: replay([s1, s2, s3]),
  },
  idempotentReplay: replayVector,
  rejections,
  readDecisions,
};

writeFileSync(new URL("../test/fixtures/authority-status.golden.json", import.meta.url), JSON.stringify(golden, null, 2) + "\n");
console.log("golden written; withdrawal head:", golden.scenarios.withdrawalDrill.at(-1).expected.headEventHash);
