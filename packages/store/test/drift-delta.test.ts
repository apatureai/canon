/**
 * Drift delta: the base-vs-head diff that makes the drift gate fair. Load-bearing
 * behaviors: drift entries partition into introduced / resolved / persisting by
 * their natural group+name+kind key; the verdict gates on the INTRODUCED set
 * only (pre-existing drift never blocks); a custom key can match more strictly;
 * multiset matching is order-stable; pure + deterministic.
 */
import { describe, expect, it } from "vitest";
import {
  diffDrift,
  defaultDriftKey,
  DESIGN_CODE_DRIFT_VERSION,
  type DesignCodeDrift,
  type DriftEntry,
} from "@uidna/store";

function drift(entries: DriftEntry[]): DesignCodeDrift {
  return {
    driftModelVersion: DESIGN_CODE_DRIFT_VERSION,
    entries,
    summary: { aligned: 0, valueMismatch: 0, missingInCode: 0, undocumentedInDesign: 0 },
    conformant: entries.length === 0,
  };
}

const mismatch = (name: string, code: string, design = "#2563EB"): DriftEntry => ({
  group: "color",
  name,
  kind: "value_mismatch",
  design,
  code,
});

describe("diffDrift — introduced / resolved / persisting", () => {
  it("drift only at head is introduced; only at base is resolved; in both is persisting", () => {
    const base = drift([mismatch("brand", "#111"), mismatch("accent", "#222")]);
    const head = drift([mismatch("brand", "#111"), mismatch("danger", "#333")]);
    const d = diffDrift(base, head);
    expect(d.introduced.map((e) => e.name)).toEqual(["danger"]);
    expect(d.resolved.map((e) => e.name)).toEqual(["accent"]);
    expect(d.persisting.map((e) => e.name)).toEqual(["brand"]);
  });

  it("treats an already-drifting token as persisting even if its code value changed (default key ignores value)", () => {
    const base = drift([mismatch("brand", "#111")]);
    const head = drift([mismatch("brand", "#999")]); // still value_mismatch at color.brand
    const d = diffDrift(base, head);
    expect(d.persisting.map((e) => e.name)).toEqual(["brand"]);
    expect(d.introduced).toEqual([]);
  });
});

describe("the gate is fair: verdict is on the INTRODUCED set only", () => {
  it("does NOT block when a value_mismatch is pre-existing", () => {
    const d = diffDrift(drift([mismatch("brand", "#111")]), drift([mismatch("brand", "#111")]));
    expect(d.persisting).toHaveLength(1);
    expect(d.verdict.decision).toBe("pass"); // introduced is empty
  });

  it("blocks when the change INTRODUCES a value_mismatch", () => {
    const d = diffDrift(
      drift([{ group: "spacing", name: "gap", kind: "missing_in_code", design: "8px" }]),
      drift([mismatch("brand", "#111")]),
    );
    expect(d.introduced.map((e) => e.name)).toEqual(["brand"]);
    expect(d.verdict.decision).toBe("block");
    expect(d.verdict.blocking.map((e) => e.name)).toEqual(["brand"]);
  });

  it("a change that resolves a value_mismatch and adds only an undocumented token warns, not blocks", () => {
    const base = drift([mismatch("brand", "#111")]);
    const head = drift([{ group: "color", name: "brand", kind: "undocumented_in_design", code: "#111" }]);
    const d = diffDrift(base, head);
    // brand:value_mismatch resolved; brand:undocumented_in_design introduced (kind changed)
    expect(d.resolved.map((e) => e.kind)).toEqual(["value_mismatch"]);
    expect(d.introduced.map((e) => e.kind)).toEqual(["undocumented_in_design"]);
    expect(d.verdict.decision).toBe("warn"); // undocumented warns by default policy
  });
});

describe("custom key + multiset + determinism", () => {
  it("a stricter key (include code value) flags a re-drifted token as introduced", () => {
    const strict = (e: DriftEntry) => `${e.group}|${e.name}|${e.kind}|${e.code ?? ""}`;
    const d = diffDrift(drift([mismatch("brand", "#111")]), drift([mismatch("brand", "#999")]), { keyOf: strict });
    expect(d.introduced.map((e) => e.code)).toEqual(["#999"]);
    expect(d.resolved.map((e) => e.code)).toEqual(["#111"]);
    expect(d.verdict.decision).toBe("block");
  });

  it("multiset: two same-key at base cancel two at head, a third is introduced", () => {
    const base = drift([mismatch("brand", "#1"), mismatch("brand", "#2")]); // both color|brand|value_mismatch
    const head = drift([mismatch("brand", "#1"), mismatch("brand", "#2"), mismatch("brand", "#3")]);
    const d = diffDrift(base, head);
    expect(d.persisting).toHaveLength(2);
    expect(d.introduced).toHaveLength(1);
  });

  it("exposes the default key and is deterministic", () => {
    expect(defaultDriftKey(mismatch("brand", "#111"))).toBe("color|brand|value_mismatch");
    const run = () => diffDrift(drift([mismatch("a", "#1")]), drift([mismatch("b", "#2")]));
    expect(run()).toEqual(run());
  });
});
