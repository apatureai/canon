import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import {
  AGENT_CARD_VERSION,
  assertReadOnlyCard,
  buildUiDnaAgentCard,
  computeAgentCardDigest,
  serializeAgentCard,
  STORE_VERSION,
  UnsafeAgentCardError,
  type ApatureAgentCardV1,
} from "../src/index.js";

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/golden-agent-card.json", import.meta.url)), "utf8"),
) as Record<string, unknown>;

describe("ui-dna ApatureAgentCardV1", () => {
  it("matches the pinned descriptor shape (golden; additive only)", () => {
    expect(buildUiDnaAgentCard()).toEqual(golden);
  });

  it("stamps the SAME contract versions the read/grounding contracts speak", () => {
    const card = buildUiDnaAgentCard();
    expect(card.schemaVersion).toBe(AGENT_CARD_VERSION);
    expect(card.contractVersions).toEqual({ schema: SCHEMA_VERSION, store: STORE_VERSION });
  });

  it("advertises the EXISTING read + grounding contracts — no new genome wire path", () => {
    const outputs = buildUiDnaAgentCard().capabilities.map((c) => c.output);
    // Both outputs are existing @uidna/store contract types, not new ones.
    expect(outputs).toEqual(["SnapshotResponse", "GenomeSlice"]);
  });

  it("is build-later/gated: draft, unregistered, unsigned until core approves it", () => {
    const card = buildUiDnaAgentCard();
    expect(card.status).toBe("draft-unapproved");
    expect(card.registered).toBe(false);
    expect(card.signature).toBeUndefined();
  });

  it("carries the forbidden claims (no model calls / write)", () => {
    expect(buildUiDnaAgentCard().forbidden).toContain("model calls");
    expect(buildUiDnaAgentCard().forbidden).toContain("eval promotion");
  });
});

describe("card canonicalization + digest (static registry)", () => {
  it("canonical serialization is deterministic and digest is sha256-prefixed", () => {
    const card = buildUiDnaAgentCard();
    expect(serializeAgentCard(card)).toBe(serializeAgentCard(buildUiDnaAgentCard()));
    expect(computeAgentCardDigest(card)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("canonical form sorts keys (byte-stable regardless of input key order)", () => {
    const card = buildUiDnaAgentCard();
    const reordered = { forbidden: card.forbidden, ...card } as ApatureAgentCardV1;
    expect(serializeAgentCard(reordered)).toBe(serializeAgentCard(card));
  });
});

describe("read-only safety guard", () => {
  it("the canonical card passes assertReadOnlyCard", () => {
    expect(() => assertReadOnlyCard(buildUiDnaAgentCard())).not.toThrow();
  });

  it("fails closed if a capability advertises anything but read_only", () => {
    const bad = buildUiDnaAgentCard();
    const tampered: ApatureAgentCardV1 = {
      ...bad,
      capabilities: [{ ...bad.capabilities[0], access: "write" as never }],
    };
    expect(() => assertReadOnlyCard(tampered)).toThrow(UnsafeAgentCardError);
  });

  it("fails closed if the no_write / no_model_calls safety flags are dropped", () => {
    const bad = buildUiDnaAgentCard();
    expect(() => assertReadOnlyCard({ ...bad, safety: { ...bad.safety, no_write: false } })).toThrow(UnsafeAgentCardError);
    expect(() => assertReadOnlyCard({ ...bad, safety: { ...bad.safety, no_model_calls: false } })).toThrow(UnsafeAgentCardError);
  });
});
