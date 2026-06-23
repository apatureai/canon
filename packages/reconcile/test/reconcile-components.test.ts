import { emptyDraft, validateSnapshot, type ComponentConvention } from "@uidna/schema";
import { sampleCaptureEvidence, type CaptureEvidence } from "@uidna/render";
import { describe, expect, it } from "vitest";
import { reconcileComponents } from "../src/index.js";

function detected(name: string): ComponentConvention {
  return { name, variants: [], props: [], usageExamples: ["dep present"], confidence: 0.5, provenance: "code" };
}

const emptyEvidence: CaptureEvidence = {
  captureVersion: "1",
  engineCaptureVersion: "test-engine-0",
  provenance: "pixels",
  captures: [],
};

describe("reconcileComponents — confirmed usage", () => {
  it("lifts confidence and provenance when usage is observed on rendered routes", () => {
    // sample fixture has a button.cta element (role 'button') -> matches shadcn/radix.
    const { components, conflicts } = reconcileComponents([detected("radix")], sampleCaptureEvidence());
    const radix = components.find((c) => c.name === "radix");
    expect(radix?.confidence).toBeGreaterThan(0.5); // reinforced
    expect(radix?.provenance).toBe("pixels"); // lifted from code (dep-presence)
    expect(conflicts).toEqual([]);
  });

  it("enriches the convention with observed roles and a usage example", () => {
    const { components } = reconcileComponents([detected("shadcn/ui")], sampleCaptureEvidence());
    const shadcn = components.find((c) => c.name === "shadcn/ui");
    expect(shadcn?.variants).toContain("button"); // observed role
    expect(shadcn?.usageExamples.some((e) => e.includes("observed on"))).toBe(true);
  });
});

describe("reconcileComponents — unused dep", () => {
  it("degrades confidence and records a conflict when no usage is observed", () => {
    const { components, conflicts } = reconcileComponents([detected("mantine")], emptyEvidence);
    const mantine = components.find((c) => c.name === "mantine");
    expect(mantine?.confidence).toBeLessThan(0.5); // degraded
    expect(mantine?.provenance).toBe("code"); // not lifted
    expect(conflicts.some((c) => c.field === "components.mantine")).toBe(true);
  });

  it("never degrades below the floor", () => {
    const conv = { ...detected("mantine"), confidence: 0.1 };
    const { components } = reconcileComponents([conv], emptyEvidence);
    expect(components[0]?.confidence).toBeGreaterThanOrEqual(0.1);
  });
});

describe("reconcileComponents — validity + determinism", () => {
  it("produces components that validate against the schema when merged into a draft", () => {
    const draft = emptyDraft("apatureai", "ui-dna", "test");
    draft.components = reconcileComponents([detected("radix")], sampleCaptureEvidence()).components;
    expect(validateSnapshot(draft)).toEqual({ ok: true });
  });

  it("is deterministic", () => {
    const a = reconcileComponents([detected("radix")], sampleCaptureEvidence());
    const b = reconcileComponents([detected("radix")], sampleCaptureEvidence());
    expect(a).toEqual(b);
  });

  it("returns empty for no detected libraries", () => {
    expect(reconcileComponents([], sampleCaptureEvidence())).toEqual({ components: [], conflicts: [] });
  });
});
