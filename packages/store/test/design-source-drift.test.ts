/**
 * Design-source drift gate: parse a design-tool DTCG export and gate the code
 * genome against it. Load-bearing behaviors: a usable export produces a drift
 * report + neutral verdict; a fundamentally-malformed export is REFUSED
 * (`invalid_design_source`) rather than gating an empty genome (which would flag
 * everything); the fair delta variant gates only on drift the head introduces.
 * Pure + deterministic.
 */
import { describe, expect, it } from "vitest";
import {
  reviewDesignSourceDrift,
  reviewDesignSourceDriftDelta,
} from "@uidna/store";
import { extractTokensJson } from "@uidna/context";
import type { DnaTokens } from "@uidna/schema";

/** DTCG 2025.10 color `$value` is a structured object, not a bare hex string. */
function colorValue(hex: string) {
  return { colorSpace: "srgb", components: [0, 0, 0], alpha: 1, hex };
}
// A minimal DTCG 2025.10 export: one color token → tokens.color["color.primary"].
const designExport = { color: { primary: { $value: colorValue("#2563EB"), $type: "color" } } };
// The design genome the export parses to — derived so we never hard-code the
// context package's name mapping.
const design: DnaTokens = extractTokensJson(designExport);

/** Clone a genome, changing the first color token's value (deterministic; name-agnostic). */
function mutateFirstColor(tokens: DnaTokens, newValue: string): DnaTokens {
  const color = { ...tokens.color };
  const firstKey = Object.keys(color)[0];
  if (firstKey !== undefined) color[firstKey] = { ...color[firstKey], value: newValue };
  return { ...tokens, color };
}

describe("reviewDesignSourceDrift — gate the code against a design export", () => {
  it("passes when the code genome matches the design export (conformant)", () => {
    const r = reviewDesignSourceDrift(designExport, design);
    expect(r.status).toBe("gated");
    if (r.status !== "gated") return;
    expect(r.drift.conformant).toBe(true);
    expect(r.verdict.decision).toBe("pass");
  });

  it("blocks when the code drifted off an existing design token (value_mismatch)", () => {
    const code = mutateFirstColor(design, "#FF0000");
    const r = reviewDesignSourceDrift(designExport, code);
    expect(r.status).toBe("gated");
    if (r.status !== "gated") return;
    expect(r.drift.summary.valueMismatch).toBe(1);
    expect(r.verdict.decision).toBe("block");
  });

  it("REFUSES to gate a fundamentally malformed export (never gates an empty genome)", () => {
    const r = reviewDesignSourceDrift("not a token document", design);
    expect(r.status).toBe("invalid_design_source");
    if (r.status !== "invalid_design_source") return;
    expect(r.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("reviewDesignSourceDriftDelta — fair base-vs-head against a design export", () => {
  it("blocks only on drift the head INTRODUCES, not pre-existing debt", () => {
    // base already drifts one token; head drifts a further edit of it — but since
    // the design/base already diverge, the fair gate must not double-blame base debt.
    const base = design; // conformant base
    const head = mutateFirstColor(design, "#FF0000"); // head introduces a value_mismatch
    const r = reviewDesignSourceDriftDelta(designExport, base, head);
    expect(r.status).toBe("delta");
    if (r.status !== "delta") return;
    expect(r.delta.introduced.length).toBe(1);
    expect(r.delta.verdict.decision).toBe("block");
  });

  it("passes when base and head drift identically (all pre-existing, none introduced)", () => {
    const drifted = mutateFirstColor(design, "#FF0000");
    const r = reviewDesignSourceDriftDelta(designExport, drifted, drifted);
    expect(r.status).toBe("delta");
    if (r.status !== "delta") return;
    expect(r.delta.introduced).toHaveLength(0);
    expect(r.delta.persisting.length).toBe(1);
    expect(r.delta.verdict.decision).toBe("pass");
  });

  it("refuses a malformed export in the delta path too", () => {
    const r = reviewDesignSourceDriftDelta(42, design, design);
    expect(r.status).toBe("invalid_design_source");
  });
});
