/**
 * Drift remediation: the agent-actionable output of the drift gate. Load-bearing
 * behaviors: each drift kind maps to a cited fix instruction (eyes-not-hands, no
 * code edit); the plan partitions by the neutral gate (blocking vs advisory);
 * ignored drift is not remediated; deterministic + stable order.
 */
import { describe, expect, it } from "vitest";
import {
  buildDriftRemediation,
  driftRemediationToAxisFixItems,
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

const mismatch: DriftEntry = { group: "color", name: "brand", kind: "value_mismatch", design: "#2563EB", code: "#3B82F6" };
const missing: DriftEntry = { group: "spacing", name: "gap", kind: "missing_in_code", design: "8px" };
const undocumented: DriftEntry = { group: "color", name: "legacy", kind: "undocumented_in_design", code: "#abcabc" };

describe("buildDriftRemediation — cited, eyes-not-hands instructions", () => {
  it("value_mismatch → replace the hardcoded value with the token", () => {
    const r = buildDriftRemediation(drift([mismatch]));
    const rem = r.blocking[0]!;
    expect(rem.action).toBe("replace_with_token");
    expect(rem.instruction).toContain("color.brand");
    expect(rem.instruction).toContain("#3B82F6"); // the off-token value to replace
    expect(rem.instruction).toContain("#2563EB"); // the token's authoritative value
    expect(rem.designValue).toBe("#2563EB");
    expect(rem.codeValue).toBe("#3B82F6");
  });

  it("missing_in_code → adopt the design token", () => {
    const r = buildDriftRemediation(drift([missing]));
    // missing_in_code warns by default → advisory
    const rem = r.advisory[0]!;
    expect(rem.action).toBe("adopt_token");
    expect(rem.instruction).toContain("spacing.gap");
    expect(rem.designValue).toBe("8px");
    expect(rem.codeValue).toBeNull();
  });

  it("undocumented_in_design → sanction or replace", () => {
    const r = buildDriftRemediation(drift([undocumented]));
    const rem = r.advisory[0]!;
    expect(rem.action).toBe("sanction_or_replace");
    expect(rem.instruction).toContain("color.legacy");
    expect(rem.codeValue).toBe("#abcabc");
  });

  it("no instruction carries a file path, selector, or code edit (eyes-not-hands)", () => {
    const all = buildDriftRemediation(drift([mismatch, missing, undocumented]));
    for (const rem of [...all.blocking, ...all.advisory]) {
      expect(rem.instruction).not.toMatch(/\.(ts|tsx|css|scss|js)\b|querySelector|<[a-z]|line \d/i);
    }
  });
});

describe("partitions by the neutral gate", () => {
  it("value_mismatch blocks; missing/undocumented are advisory (default policy)", () => {
    const r = buildDriftRemediation(drift([mismatch, missing, undocumented]));
    expect(r.blocking.map((x) => x.kind)).toEqual(["value_mismatch"]);
    expect(r.advisory.map((x) => x.kind).sort()).toEqual(["missing_in_code", "undocumented_in_design"]);
  });

  it("honors a custom policy (e.g. undocumented also blocks)", () => {
    const r = buildDriftRemediation(drift([undocumented]), { block: ["undocumented_in_design"], warn: [] });
    expect(r.blocking.map((x) => x.kind)).toEqual(["undocumented_in_design"]);
    expect(r.advisory).toEqual([]);
  });

  it("does not remediate ignored drift", () => {
    // both kinds present, but a policy that gates neither → nothing to remediate
    const r = buildDriftRemediation(drift([mismatch, missing]), { block: [], warn: [] });
    expect(r.blocking).toEqual([]);
    expect(r.advisory).toEqual([]);
  });

  it("is deterministic and conformant drift yields an empty plan", () => {
    expect(buildDriftRemediation(drift([]))).toEqual({ blocking: [], advisory: [] });
    const build = () => buildDriftRemediation(drift([mismatch, missing]));
    expect(build()).toEqual(build());
  });
});

describe("driftRemediationToAxisFixItems — feeds the combined cross-axis fix plan", () => {
  it("projects each remediation to an AxisFixItem: token ref, grounded, blocking from the gate split", () => {
    const plan = buildDriftRemediation(drift([mismatch, missing, undocumented]));
    const items = driftRemediationToAxisFixItems(plan);
    // The blocking value_mismatch first, as a grounded, blocking, token-cited fix.
    expect(items[0]).toEqual({
      ref: "color.brand",
      instruction: plan.blocking[0]!.instruction,
      grounded: true,
      blocking: true,
    });
    // Every drift remediation is grounded (token-cited, deterministic action).
    expect(items.every((i) => i.grounded)).toBe(true);
    // Blocking items precede advisory ones; advisory carry blocking:false.
    expect(items.map((i) => i.blocking)).toEqual([true, false, false]);
    expect(items.map((i) => i.ref)).toEqual(["color.brand", "spacing.gap", "color.legacy"]);
  });

  it("is deterministic and an empty plan yields no items", () => {
    expect(driftRemediationToAxisFixItems({ blocking: [], advisory: [] })).toEqual([]);
    const build = () => driftRemediationToAxisFixItems(buildDriftRemediation(drift([mismatch])));
    expect(build()).toEqual(build());
  });
});
