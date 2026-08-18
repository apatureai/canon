/**
 * Drift comment renderer: the human-readable PR comment for the drift gate.
 * Load-bearing: verdict header; introduced drift headlined by its token (un-arguable);
 * blocking leads then advisory; pre-existing counted-not-gated; resolved reported;
 * deterministic Markdown.
 */
import { describe, expect, it } from "vitest";
import {
  renderDriftComment,
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
const comment = (base: DriftEntry[], head: DriftEntry[]) => renderDriftComment(evaluateDriftGateNode(drift(base), drift(head)));

describe("renderDriftComment", () => {
  it("heads with the gate verdict", () => {
    expect(comment([], [mismatch("brand", "#111")])).toContain("changes requested");
    expect(comment([], [{ group: "spacing", name: "gap", kind: "missing_in_code", design: "8px" }])).toContain("warnings");
    expect(comment([], [])).toContain("passed");
  });

  it("headlines introduced drift by the design token it broke (un-arguable)", () => {
    const md = comment([], [mismatch("brand", "#3B82F6")]);
    expect(md).toContain("`color.brand`");
    expect(md).toContain("#3B82F6");
    expect(md).toContain("Introduced: must fix");
  });

  it("counts pre-existing drift without gating it", () => {
    const md = comment([mismatch("brand", "#111")], [mismatch("brand", "#111")]);
    expect(md).toContain("passed"); // pre-existing not gated
    expect(md).toContain("pre-existing");
  });

  it("reports resolved drift and is deterministic", () => {
    const md = comment([mismatch("gone", "#111")], []);
    expect(md).toContain("Resolved");
    const build = () => comment([], [mismatch("a", "#1")]);
    expect(build()).toBe(build());
  });
});
