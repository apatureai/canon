import { emptyDraft, fact, type DnaSnapshot } from "@apatureai/canon-schema";
import { describe, expect, it } from "vitest";
import { diffSnapshots } from "../src/index.js";

function base(): DnaSnapshot {
  const d = emptyDraft("apatureai", "canon", "extract-1");
  d.tokens.color["--brand"] = fact("#bada55", 0.8, "config");
  d.tokens.spacing["--gap"] = fact("8px", 0.6, "pixels");
  return d;
}

describe("diffSnapshots — field changes across sections", () => {
  it("detects an added token", () => {
    const a = base();
    const b = base();
    b.tokens.color["--accent"] = fact("#00f", 0.7, "config");
    const { changes } = diffSnapshots(a, b);
    const added = changes.find((c) => c.field === "tokens.color.--accent");
    expect(added?.kind).toBe("added");
    expect(added?.newValue).toBe("#00f");
    expect(added?.oldValue).toBeNull();
  });

  it("detects a removed token", () => {
    const a = base();
    const b = base();
    delete b.tokens.spacing["--gap"];
    const removed = diffSnapshots(a, b).changes.find((c) => c.field === "tokens.spacing.--gap");
    expect(removed?.kind).toBe("removed");
    expect(removed?.oldValue).toBe("8px");
  });

  it("detects a changed token with value/confidence/provenance deltas", () => {
    const a = base();
    const b = base();
    b.tokens.color["--brand"] = fact("#000000", 1, "human"); // sign-off lift
    const changed = diffSnapshots(a, b).changes.find((c) => c.field === "tokens.color.--brand");
    expect(changed?.kind).toBe("changed");
    expect(changed?.oldValue).toBe("#bada55");
    expect(changed?.newValue).toBe("#000000");
    expect(changed?.oldConfidence).toBe(0.8);
    expect(changed?.newConfidence).toBe(1);
    expect(changed?.oldProvenance).toBe("config");
    expect(changed?.newProvenance).toBe("human");
  });

  it("diffs identity, components, and exceptions sections", () => {
    const a = base();
    const b = base();
    b.identity.tone = fact("calm", 1, "human");
    b.components = [{ name: "radix", variants: [], props: [], usageExamples: [], confidence: 0.7, provenance: "pixels" }];
    b.exceptions = [{ route: "/promo", reason: "campaign" }];
    const fields = diffSnapshots(a, b).changes.map((c) => c.field);
    expect(fields).toContain("identity.tone");
    expect(fields).toContain("components.radix");
    expect(fields).toContain("exceptions./promo");
  });
});

describe("diffSnapshots — distributions changes (#41)", () => {
  it("enumerates a spacingIntervals change into changes[]", () => {
    const a = base();
    const b = base();
    b.distributions.spacingIntervals = [8, 16];
    const change = diffSnapshots(a, b).changes.find((c) => c.field === "distributions.spacingIntervals");
    expect(change?.kind).toBe("changed"); // [] -> [8,16]
    expect(change?.oldValue).toBe("[]");
    expect(change?.newValue).toBe("[8,16]");
  });

  it("enumerates per-color colorProportions add/change", () => {
    const a = base();
    const b = base();
    a.distributions.colorProportions = { "#0a0a0a": 0.4 };
    b.distributions.colorProportions = { "#0a0a0a": 0.6, "#ffffff": 0.2 };
    const fields = diffSnapshots(a, b).changes;
    const changed = fields.find((c) => c.field === "distributions.colorProportions.#0a0a0a");
    const added = fields.find((c) => c.field === "distributions.colorProportions.#ffffff");
    expect(changed?.kind).toBe("changed");
    expect(changed?.oldValue).toBe("0.4");
    expect(changed?.newValue).toBe("0.6");
    expect(added?.kind).toBe("added");
  });

  it("enumerates a density change (nullable scalar)", () => {
    const a = base();
    const b = base();
    b.distributions.density = 1.5;
    const change = diffSnapshots(a, b).changes.find((c) => c.field === "distributions.density");
    expect(change?.kind).toBe("added"); // null -> 1.5
    expect(change?.newValue).toBe("1.5");
  });

  it("a distributions-only change is NOT metadataOnly and now reports the change", () => {
    const a = base();
    const b = base();
    b.distributions.typeScale = [14, 16];
    const diff = diffSnapshots(a, b);
    expect(diff.metadataOnly).toBe(false);
    expect(diff.changes.map((c) => c.field)).toContain("distributions.typeScale");
  });

  it("identical distributions produce no distributions changes", () => {
    const a = base();
    const b = base();
    a.distributions.spacingIntervals = [8];
    b.distributions.spacingIntervals = [8];
    expect(diffSnapshots(a, b).changes.filter((c) => c.field.startsWith("distributions."))).toEqual([]);
  });
});

describe("diffSnapshots — metadata-only vs genome change", () => {
  it("flags metadataOnly when only approval/version stamps differ", () => {
    const a = base();
    const b = base();
    b.metadata.dnaVersion = "v2";
    b.metadata.approvalState = "approved";
    const diff = diffSnapshots(a, b);
    expect(diff.changes).toEqual([]);
    expect(diff.metadataOnly).toBe(true);
  });

  it("is NOT metadataOnly when genome content changed", () => {
    const a = base();
    const b = base();
    b.tokens.color["--brand"] = fact("#000000", 0.8, "config");
    expect(diffSnapshots(a, b).metadataOnly).toBe(false);
  });
});

describe("diffSnapshots — deterministic", () => {
  it("sorts changes by field and is order-independent", () => {
    const a = base();
    const b = base();
    b.tokens.color["--z"] = fact("#1", 0.5, "config");
    b.tokens.color["--a"] = fact("#2", 0.5, "config");
    const fields = diffSnapshots(a, b).changes.map((c) => c.field);
    expect(fields).toEqual([...fields].sort());
  });

  it("an identical snapshot diffs to no changes", () => {
    expect(diffSnapshots(base(), base()).changes).toEqual([]);
  });
});
