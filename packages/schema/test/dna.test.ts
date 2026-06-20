import { describe, expect, it } from "vitest";
import {
  emptyDraft,
  fact,
  isApproved,
  SCHEMA_VERSION,
  validateSnapshot,
  type DnaSnapshot,
} from "../src/index.js";

describe("@uidna/schema contract (#11)", () => {
  it("fact() stamps confidence (clamped) + provenance", () => {
    expect(fact("#0a0a0a", 0.8, "code")).toEqual({ value: "#0a0a0a", confidence: 0.8, provenance: "code" });
    expect(fact("x", 1.5, "human").confidence).toBe(1); // clamped high
    expect(fact("x", -1, "pixels").confidence).toBe(0); // clamped low
    expect(fact("x", Number.NaN, "config").confidence).toBe(0); // non-finite -> 0
  });

  it("emptyDraft() is a schema-versioned, unapproved snapshot", () => {
    const d = emptyDraft("acme", "web", "extract@1");
    expect(d.repository).toEqual({ owner: "acme", name: "web" });
    expect(d.metadata.schemaVersion).toBe(SCHEMA_VERSION);
    expect(d.metadata.approvalState).toBe("draft");
    expect(isApproved(d)).toBe(false);
    expect(validateSnapshot(d).ok).toBe(true);
  });

  it("isApproved() gates downstream use on human sign-off", () => {
    const d = emptyDraft("acme", "web", "extract@1");
    expect(isApproved(d)).toBe(false);
    d.metadata.approvalState = "approved";
    expect(isApproved(d)).toBe(true);
  });

  it("validateSnapshot() catches bad confidence, provenance, schema version, approval state", () => {
    const d = emptyDraft("acme", "web", "extract@1");
    d.tokens.color.primary = { value: "#fff", confidence: 2, provenance: "code" }; // out of range
    d.identity.tone = { value: "calm", confidence: 0.5, provenance: "made-up" as never }; // bad provenance
    const res = validateSnapshot(d);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes("tokens.color.primary"))).toBe(true);
      expect(res.errors.some((e) => e.includes("identity.tone"))).toBe(true);
    }
  });

  it("rejects an unsupported schema version (additive-only contract)", () => {
    const d: DnaSnapshot = { ...emptyDraft("a", "b", "e@1") };
    d.metadata = { ...d.metadata, schemaVersion: "999" };
    const res = validateSnapshot(d);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("accepts a well-formed populated snapshot", () => {
    const d = emptyDraft("acme", "web", "extract@1");
    d.identity.name = fact("Acme", 0.9, "config");
    d.tokens.spacing["4"] = fact("1rem", 1, "code");
    d.components.push({ name: "Button", variants: ["primary"], props: ["size"], usageExamples: [], confidence: 0.7, provenance: "code" });
    expect(validateSnapshot(d).ok).toBe(true);
  });
});
