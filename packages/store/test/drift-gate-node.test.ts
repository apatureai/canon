/**
 * Drift gate node: the drift axis as a conditional graph node. Load-bearing:
 * routes on the drift the change INTRODUCED (pre-existing drift proceeds; an
 * introduced value_mismatch routes to fix); the remediation back-edge is for the
 * introduced drift only and cites tokens; pure + deterministic.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateDriftGateNode,
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

const mismatch = (name: string, code: string): DriftEntry => ({ group: "color", name, kind: "value_mismatch", design: "#2563EB", code });

describe("evaluateDriftGateNode — the drift axis as a graph node", () => {
  it("PROCEEDS when the value_mismatch is pre-existing (inherited, not introduced)", () => {
    const r = evaluateDriftGateNode(drift([mismatch("brand", "#111")]), drift([mismatch("brand", "#111")]));
    expect(r.verdict).toBe("pass");
    expect(r.route).toBe("proceed");
    expect(r.persistingCount).toBe(1);
    expect(r.remediation.blocking).toEqual([]);
  });

  it("routes to FIX when the change introduces a value_mismatch, with a cited back-edge", () => {
    const r = evaluateDriftGateNode(drift([]), drift([mismatch("brand", "#111")]));
    expect(r.verdict).toBe("block");
    expect(r.route).toBe("fix");
    expect(r.introducedCount).toBe(1);
    expect(r.remediation.blocking[0]!.instruction).toContain("color.brand");
    // eyes-not-hands: the back-edge cites, never edits
    expect(r.remediation.blocking[0]!.instruction).not.toMatch(/\.(ts|css)\b|querySelector/);
  });

  it("honors a policy that also routes warnings to fix, and is deterministic", () => {
    const missing = drift([{ group: "spacing", name: "gap", kind: "missing_in_code", design: "8px" }]);
    const r = evaluateDriftGateNode(drift([]), missing, { routeToFixOn: ["block", "warn"] });
    expect(r.verdict).toBe("warn"); // missing_in_code warns by default
    expect(r.route).toBe("fix");
    const build = () => evaluateDriftGateNode(drift([]), drift([mismatch("a", "#1")]));
    expect(build()).toEqual(build());
  });
});
