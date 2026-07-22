/**
 * Design↔code drift: where the CODE genome diverges from the DESIGN genome
 * (design authoritative). Distinct from diffSnapshots (symmetric versioning) —
 * this classifies drift: value_mismatch, missing_in_code, undocumented_in_design.
 * The primitive behind the design-system drift gate.
 */
import { describe, expect, it } from "vitest";
import { fact, type DnaTokens } from "@uidna/schema";
import { computeDesignCodeDrift, driftFromEntries } from "@uidna/store";

const emptyTokens = (): DnaTokens => ({
  color: {}, typography: {}, spacing: {}, radii: {}, shadows: {}, breakpoints: {}, motion: {},
});

const tokens = (color: Record<string, string>): DnaTokens => {
  const t = emptyTokens();
  for (const [k, v] of Object.entries(color)) t.color[k] = fact(v, 1, "config");
  return t;
};

describe("computeDesignCodeDrift (#drift gate)", () => {
  it("reports no drift when code conforms to design", () => {
    const t = tokens({ "brand.primary": "#2563EB", "brand.bg": "#FFFFFF" });
    const r = computeDesignCodeDrift(t, tokens({ "brand.primary": "#2563EB", "brand.bg": "#FFFFFF" }));
    expect(r.conformant).toBe(true);
    expect(r.entries).toEqual([]);
    expect(r.summary.aligned).toBe(2);
  });

  it("flags a value_mismatch when code hardcodes a value different from the design token", () => {
    const design = tokens({ "brand.primary": "#2563EB" });
    const code = tokens({ "brand.primary": "#3B82F6" }); // code drifted off the design value
    const r = computeDesignCodeDrift(design, code);
    expect(r.conformant).toBe(false);
    expect(r.entries).toEqual([
      { group: "color", name: "brand.primary", kind: "value_mismatch", design: "#2563EB", code: "#3B82F6" },
    ]);
    expect(r.summary.valueMismatch).toBe(1);
  });

  it("flags missing_in_code when the design defines a token the code does not use", () => {
    const r = computeDesignCodeDrift(tokens({ "brand.accent": "#10B981" }), emptyTokens());
    expect(r.entries).toEqual([
      { group: "color", name: "brand.accent", kind: "missing_in_code", design: "#10B981" },
    ]);
    expect(r.summary.missingInCode).toBe(1);
  });

  it("flags undocumented_in_design when the code invents a token the design never sanctioned", () => {
    const r = computeDesignCodeDrift(emptyTokens(), tokens({ "misc.random": "#123456" }));
    expect(r.entries).toEqual([
      { group: "color", name: "misc.random", kind: "undocumented_in_design", code: "#123456" },
    ]);
    expect(r.summary.undocumentedInDesign).toBe(1);
  });

  it("compares across all token groups and orders entries by group then name", () => {
    const design = emptyTokens();
    design.spacing["gap.sm"] = fact("8px", 1, "config");
    design.color["a"] = fact("#000", 1, "config");
    const code = emptyTokens();
    code.spacing["gap.sm"] = fact("6px", 1, "config"); // mismatch
    code.color["a"] = fact("#000", 1, "config"); // aligned
    const r = computeDesignCodeDrift(design, code);
    // color precedes spacing in group order; only the spacing mismatch drifts.
    expect(r.entries).toEqual([
      { group: "spacing", name: "gap.sm", kind: "value_mismatch", design: "8px", code: "6px" },
    ]);
    expect(r.summary.aligned).toBe(1);
  });

  it("is deterministic", () => {
    const build = () => computeDesignCodeDrift(tokens({ b: "#1", a: "#2" }), tokens({ a: "#9", c: "#3" }));
    expect(build()).toEqual(build());
  });
});

import { evaluateDriftGate, DEFAULT_DRIFT_GATE_POLICY, computeDesignCodeDrift as drift2 } from "@uidna/store";

describe("evaluateDriftGate — the neutral gate over drift", () => {
  const mk = (designColors: Record<string, string>, codeColors: Record<string, string>) =>
    drift2(tokens(designColors), tokens(codeColors));

  it("passes a conformant genome", () => {
    const v = evaluateDriftGate(mk({ a: "#1" }, { a: "#1" }));
    expect(v.decision).toBe("pass");
    expect(v.blocking).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("BLOCKS a value_mismatch by default (code contradicts the source of truth)", () => {
    const v = evaluateDriftGate(mk({ a: "#2563EB" }, { a: "#3B82F6" }));
    expect(v.decision).toBe("block");
    expect(v.blocking.map((e) => e.name)).toEqual(["a"]);
  });

  it("WARNS on missing_in_code / undocumented_in_design by default", () => {
    const v = evaluateDriftGate(mk({ used: "#1" }, { invented: "#2" }));
    expect(v.decision).toBe("warn");
    expect(v.warnings.map((e) => e.kind).sort()).toEqual(["missing_in_code", "undocumented_in_design"]);
    expect(v.blocking).toEqual([]);
  });

  it("block wins over warn when both are present", () => {
    const v = evaluateDriftGate(mk({ a: "#1", b: "#2" }, { a: "#9" /* mismatch=block */ /* b missing=warn */ }));
    expect(v.decision).toBe("block");
    expect(v.blocking.map((e) => e.name)).toEqual(["a"]);
    expect(v.warnings.map((e) => e.name)).toEqual(["b"]);
  });

  it("honors a custom policy (e.g. block on undocumented tokens too)", () => {
    const strict = { block: ["value_mismatch", "undocumented_in_design"] as const, warn: ["missing_in_code"] as const };
    const v = evaluateDriftGate(mk({}, { invented: "#2" }), strict);
    expect(v.decision).toBe("block");
  });

  it("a kind in neither list is ignored (reported, not gated)", () => {
    const lenient = { block: [] as const, warn: [] as const };
    const v = evaluateDriftGate(mk({ a: "#2563EB" }, { a: "#3B82F6" }), lenient);
    expect(v.decision).toBe("pass");
    expect(v.ignored.map((e) => e.name)).toEqual(["a"]);
  });

  it("the default policy is the documented one", () => {
    expect(DEFAULT_DRIFT_GATE_POLICY).toEqual({ block: ["value_mismatch"], warn: ["missing_in_code", "undocumented_in_design"] });
  });
});

describe("driftFromEntries (shared helper)", () => {
  it("wraps entries into a DesignCodeDrift with a recomputed summary", () => {
    const d = driftFromEntries([
      { group: "color", name: "brand", kind: "value_mismatch", design: "#2563EB", code: "#3B82F6" },
      { group: "spacing", name: "gap", kind: "missing_in_code", design: "8px" },
    ]);
    expect(d.conformant).toBe(false);
    expect(d.summary.valueMismatch).toBe(1);
    expect(d.summary.missingInCode).toBe(1);
    expect(d.summary.aligned).toBe(0);
  });
  it("is conformant for an empty entry list", () => {
    expect(driftFromEntries([]).conformant).toBe(true);
  });
});

describe("computeDesignCodeDrift — hex color equivalence (no false value_mismatch)", () => {
  it("treats a hex color as equal regardless of case (the common false-positive)", () => {
    const r = computeDesignCodeDrift(tokens({ "brand.primary": "#2563EB" }), tokens({ "brand.primary": "#2563eb" }));
    expect(r.conformant).toBe(true);
    expect(r.summary.aligned).toBe(1);
    expect(r.summary.valueMismatch).toBe(0);
  });

  it("treats hex shorthand as equal to its expanded form", () => {
    const r = computeDesignCodeDrift(tokens({ "brand.bg": "#FFF" }), tokens({ "brand.bg": "#ffffff" }));
    expect(r.conformant).toBe(true);
    expect(r.summary.aligned).toBe(1);
  });

  it("ignores surrounding whitespace when comparing values", () => {
    const r = computeDesignCodeDrift(tokens({ "brand.primary": "#2563EB" }), tokens({ "brand.primary": "  #2563EB " }));
    expect(r.conformant).toBe(true);
  });

  it("still flags genuinely different colors (not a normalization false-negative)", () => {
    const r = computeDesignCodeDrift(tokens({ "brand.primary": "#2563EB" }), tokens({ "brand.primary": "#3B82F6" }));
    expect(r.summary.valueMismatch).toBe(1);
    expect(r.entries[0]).toMatchObject({ kind: "value_mismatch", design: "#2563EB", code: "#3B82F6" });
  });

  it("treats rgb()/rgba() as equal to the equivalent hex (no false mismatch)", () => {
    // design tokens are typically hex; hand-written CSS is often rgb() — the same
    // colour must not read as drift.
    expect(computeDesignCodeDrift(tokens({ c: "#ffffff" }), tokens({ c: "rgb(255,255,255)" })).conformant).toBe(true);
    expect(computeDesignCodeDrift(tokens({ c: "#2563eb" }), tokens({ c: "rgb(37, 99, 235)" })).conformant).toBe(true);
    // alpha: rgba(...,0.5) == #rrggbb80; and opaque hex6 == hex8-with-ff-alpha.
    expect(computeDesignCodeDrift(tokens({ c: "#00000080" }), tokens({ c: "rgba(0,0,0,0.5)" })).conformant).toBe(true);
    expect(computeDesignCodeDrift(tokens({ c: "#ffffff" }), tokens({ c: "#ffffffff" })).conformant).toBe(true);
  });

  it("still flags genuinely different rgb/hex colours, reporting the originals", () => {
    const r = computeDesignCodeDrift(tokens({ "brand.primary": "#ffffff" }), tokens({ "brand.primary": "rgb(0,0,0)" }));
    expect(r.summary.valueMismatch).toBe(1);
    expect(r.entries[0]).toMatchObject({ design: "#ffffff", code: "rgb(0,0,0)" });
  });

  it("does not coerce unrecognized colour formats (hsl vs hex still reported)", () => {
    // Scope boundary: hsl()/named colours fall back to exact compare — no false
    // equivalence, and the ORIGINAL strings are reported.
    const r = computeDesignCodeDrift(tokens({ c: "#ffffff" }), tokens({ c: "hsl(0,0%,100%)" }));
    expect(r.summary.valueMismatch).toBe(1);
    expect(r.entries[0]).toMatchObject({ design: "#ffffff", code: "hsl(0,0%,100%)" });
  });
});
