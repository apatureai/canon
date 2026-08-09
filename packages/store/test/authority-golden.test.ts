/**
 * Authority-status golden vectors.
 *
 * `fixtures/authority-status.golden.json` pins the authority/revocation
 * contract: the admission matrix for the append-only hash-chained log, and the
 * read decision for every `(status, mode)` pair. This suite RECOMPUTES every
 * embedded hash from the live implementation, so a stale or hand-edited fixture
 * fails here even if its internal expectations stay self-consistent.
 *
 * Regenerate with `packages/store/scripts/generate-authority-golden.mjs` after
 * building `@uidna/store`; never hand-edit the fixture.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  appendAuthorityEvent,
  authorizeRead,
  AUTHORITY_CONTRACT_VERSION,
  hashAuthorityEvent,
  inMemoryAuthorityStore,
  type AuthorityEvent,
  type AuthorityRejectReason,
  type AuthorityStatus,
  type ReadMode,
} from "../src/index.js";

interface GoldenStep {
  event: AuthorityEvent;
  expected: { status: AuthorityStatus; sequence: number; headEventHash: string };
}
interface Golden {
  contractVersion: string;
  scenarios: Record<string, GoldenStep[]>;
  idempotentReplay: { base: AuthorityEvent[]; event: AuthorityEvent };
  rejections: Array<{ name: string; base: AuthorityEvent[]; event: AuthorityEvent; reason: AuthorityRejectReason }>;
  readDecisions: Array<{ status: AuthorityStatus; mode: ReadMode; expected: ReturnType<typeof authorizeRead> }>;
}

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/authority-status.golden.json", import.meta.url)), "utf8"),
) as Golden;

function replayBase(events: readonly AuthorityEvent[]): readonly AuthorityEvent[] {
  let log: readonly AuthorityEvent[] = [];
  for (const event of events) {
    const result = appendAuthorityEvent(log, event);
    if (!result.ok) throw new Error(`golden base rejected: ${result.reason}`);
    log = result.log;
  }
  return log;
}

describe("authority-status golden vectors (#72 — the cross-repo mirror source)", () => {
  it("pins the published contract version", () => {
    expect(golden.contractVersion).toBe(AUTHORITY_CONTRACT_VERSION);
  });

  it("every scenario replays to the recorded status, sequence, and RECOMPUTED head hash", () => {
    for (const [name, steps] of Object.entries(golden.scenarios)) {
      const store = inMemoryAuthorityStore();
      for (const step of steps) {
        const result = store.append(step.event);
        expect(result.ok, `${name}: append ${step.event.eventId}`).toBe(true);
        const status = store.status(step.event.key);
        expect(status.status, `${name}/${step.event.eventId} status`).toBe(step.expected.status);
        expect(status.sequence, `${name}/${step.event.eventId} sequence`).toBe(step.expected.sequence);
        // Recorded hash must match BOTH the store's head and a live recomputation
        // — a hand-edited or stale fixture fails even if self-consistent.
        expect(status.headEventHash, `${name}/${step.event.eventId} head`).toBe(step.expected.headEventHash);
        expect(hashAuthorityEvent(step.event), `${name}/${step.event.eventId} recompute`).toBe(
          step.expected.headEventHash,
        );
      }
    }
  });

  it("the withdrawal drill converges: A revoked fails both read modes; B serves independently", () => {
    const withdrawal = golden.scenarios["withdrawalDrill"]!;
    const finalA = withdrawal.at(-1)!.expected;
    expect(finalA.status).toBe("revoked");
    expect(authorizeRead(finalA.status, "latest")).toEqual({ serve: false, status: "revoked", reason: "revoked" });
    expect(authorizeRead(finalA.status, "pinned")).toEqual({ serve: false, status: "revoked", reason: "revoked" });

    const replacement = golden.scenarios["independentReplacement"]!.at(-1)!.expected;
    expect(replacement.status).toBe("effective");
    expect(authorizeRead(replacement.status, "latest").serve).toBe(true);
  });

  it("a byte-identical head replay is idempotent (duplicate revocation events converge)", () => {
    const log = replayBase(golden.idempotentReplay.base);
    const result = appendAuthorityEvent(log, golden.idempotentReplay.event);
    expect(result).toEqual({ ok: true, log, idempotentReplay: true });
  });

  it("every rejection vector rejects with exactly the recorded reason", () => {
    for (const rejection of golden.rejections) {
      const log = replayBase(rejection.base);
      const result = appendAuthorityEvent(log, rejection.event);
      expect(result, rejection.name).toEqual({ ok: false, reason: rejection.reason });
    }
  });

  it("the authorizeRead decision matrix matches on every (status, mode) pair", () => {
    expect(golden.readDecisions).toHaveLength(6); // 3 statuses × 2 modes — full matrix
    for (const entry of golden.readDecisions) {
      expect(authorizeRead(entry.status, entry.mode), `${entry.status}/${entry.mode}`).toEqual(entry.expected);
    }
  });
});
