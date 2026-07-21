/**
 * Design-source provenance (D2): the drift gate keeps blocking authority only
 * when the design export's provenance meets a verification bar. Load-bearing:
 * meets-bar → full authority; below-bar advisory → a `block` is capped to `warn`
 * (never fails the PR) with the would-be blockers surfaced as warnings; below-bar
 * refuse → `unverified_design_source`; a malformed export passes through; a block
 * is NEVER added. Pure + deterministic.
 */
import { describe, expect, it } from "vitest";
import {
  reviewDesignSourceDrift,
  enforceDesignSourceProvenance,
  provenanceMeetsBar,
  DEFAULT_PROVENANCE_POLICY,
  type DesignSourceProvenance,
  type DesignSourceProvenancePolicy,
} from "@uidna/store";
import { extractTokensJson } from "@uidna/context";
import type { DnaTokens } from "@uidna/schema";

function colorValue(hex: string) {
  return { colorSpace: "srgb", components: [0, 0, 0], alpha: 1, hex };
}
const designExport = { color: { primary: { $value: colorValue("#2563EB"), $type: "color" } } };
const design: DnaTokens = extractTokensJson(designExport);

function mutateFirstColor(tokens: DnaTokens, newValue: string): DnaTokens {
  const color = { ...tokens.color };
  const firstKey = Object.keys(color)[0];
  if (firstKey !== undefined) color[firstKey] = { ...color[firstKey], value: newValue };
  return { ...tokens, color };
}

// A drift outcome that BLOCKS (code drifted off an existing design token).
const blockingOutcome = reviewDesignSourceDrift(designExport, mutateFirstColor(design, "#FF0000"));
// A drift outcome that PASSES (code conformant).
const passingOutcome = reviewDesignSourceDrift(designExport, design);

const prov = (verification: DesignSourceProvenance["verification"]): DesignSourceProvenance => ({
  sourceId: "figma:abc123",
  verification,
});

describe("provenanceMeetsBar", () => {
  it("ranks unverified < declared < attested < signed against the bar", () => {
    const policy: DesignSourceProvenancePolicy = { minVerification: "attested", belowBar: "advisory" };
    expect(provenanceMeetsBar(prov("signed"), policy)).toBe(true);
    expect(provenanceMeetsBar(prov("attested"), policy)).toBe(true);
    expect(provenanceMeetsBar(prov("declared"), policy)).toBe(false);
    expect(provenanceMeetsBar(prov("unverified"), policy)).toBe(false);
  });
});

describe("enforceDesignSourceProvenance", () => {
  it("keeps full authority when provenance meets the bar (a block stays a block)", () => {
    const r = enforceDesignSourceProvenance(blockingOutcome, prov("attested"));
    expect(r.status).toBe("gated");
    if (r.status !== "gated") return;
    expect(r.verdict.decision).toBe("block");
    expect(r.provenanceSufficient).toBe(true);
    expect(r.provenance.sourceId).toBe("figma:abc123");
  });

  it("advisory (default): below-bar caps a block down to warn — never fails the PR", () => {
    const r = enforceDesignSourceProvenance(blockingOutcome, prov("declared"));
    expect(r.status).toBe("gated_advisory");
    if (r.status !== "gated_advisory") return;
    expect(r.verdict.decision).toBe("warn"); // capped
    expect(r.ungatedVerdict.decision).toBe("block"); // what it would have been
    expect(r.provenanceSufficient).toBe(false);
    // The would-be blockers are surfaced as warnings, not dropped.
    expect(r.verdict.blocking).toEqual([]);
    expect(r.verdict.warnings.length).toBeGreaterThan(0);
  });

  it("advisory: a passing outcome is unaffected below the bar (nothing to cap)", () => {
    const r = enforceDesignSourceProvenance(passingOutcome, prov("unverified"));
    expect(r.status).toBe("gated_advisory");
    if (r.status !== "gated_advisory") return;
    expect(r.verdict.decision).toBe("pass");
    expect(r.ungatedVerdict.decision).toBe("pass");
  });

  it("refuse: below-bar returns unverified_design_source (no gate)", () => {
    const policy: DesignSourceProvenancePolicy = { minVerification: "signed", belowBar: "refuse" };
    const r = enforceDesignSourceProvenance(blockingOutcome, prov("attested"), policy);
    expect(r.status).toBe("unverified_design_source");
    if (r.status !== "unverified_design_source") return;
    expect(r.requiredVerification).toBe("signed");
    expect(r.provenance.verification).toBe("attested");
  });

  it("passes a malformed export through untouched (it was never gated)", () => {
    const invalid = reviewDesignSourceDrift("not a token document", design);
    expect(invalid.status).toBe("invalid_design_source");
    const r = enforceDesignSourceProvenance(invalid, prov("unverified"));
    expect(r.status).toBe("invalid_design_source");
  });

  it("never ADDS a block: the default policy only ever softens authority", () => {
    // Whatever the provenance, the enforced decision is never stricter than the drift's own.
    for (const v of ["unverified", "declared", "attested", "signed"] as const) {
      const r = enforceDesignSourceProvenance(passingOutcome, prov(v));
      const decision = r.status === "gated" || r.status === "gated_advisory" ? r.verdict.decision : "pass";
      expect(decision).toBe("pass"); // a passing drift never becomes a block via provenance
    }
  });

  it("is deterministic", () => {
    const build = () => enforceDesignSourceProvenance(blockingOutcome, prov("declared"), DEFAULT_PROVENANCE_POLICY);
    expect(build()).toEqual(build());
  });
});
