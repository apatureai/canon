import { emptyDraft, validateSnapshot, type ComponentConvention } from "@apatureai/canon-schema";
import { sampleCaptureEvidence, type CaptureEvidence, type GeometryNode } from "@apatureai/canon-render";
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

/** One-route evidence whose geometry is the given nodes (for usage-signature tests). */
function evidenceWith(geometry: GeometryNode[]): CaptureEvidence {
  return {
    captureVersion: "1",
    engineCaptureVersion: "test-engine-0",
    provenance: "pixels",
    captures: [
      {
        route: "/",
        viewport: { width: 1280, height: 800, deviceScaleFactor: 2, label: "desktop" },
        screenshotRef: "s3://uidna-fixtures/x.png",
        geometry,
        computedStyle: [],
        phash: null,
      },
    ],
  };
}

/** A genuine Radix-family marker (data-radix/data-state), not a bare ARIA role. */
const radixNode: GeometryNode = {
  selector: "div[data-radix-popper-content-wrapper]",
  role: "dialog",
  rect: { x: 0, y: 0, width: 320, height: 200 },
};
/** A plain role=button element that appears on ANY site (must NOT confirm Radix/shadcn). */
const bareButtonNode: GeometryNode = {
  selector: "button.cta",
  role: "button",
  rect: { x: 32, y: 96, width: 160, height: 44 },
};

describe("reconcileComponents — confirmed usage (#38)", () => {
  it("lifts confidence and provenance when a Radix-family marker is observed", () => {
    const { components, conflicts } = reconcileComponents([detected("radix")], evidenceWith([radixNode]));
    const radix = components.find((c) => c.name === "radix");
    expect(radix?.confidence).toBeGreaterThan(0.5); // reinforced
    expect(radix?.provenance).toBe("pixels"); // lifted from code (dep-presence)
    expect(conflicts).toEqual([]);
  });

  it("pixel confirmation never LOWERS a detection already above the reinforce ceiling", () => {
    // A high-confidence detection (0.99 > 0.98) confirmed on rendered routes must
    // not be penalized: before the fix, negative headroom dragged it below 0.99.
    const conv: ComponentConvention = { ...detected("radix"), confidence: 0.99 };
    const { components } = reconcileComponents([conv], evidenceWith([radixNode]));
    const radix = components.find((c) => c.name === "radix");
    expect(radix?.confidence).toBeGreaterThanOrEqual(0.99);
    expect(radix?.provenance).toBe("pixels");
  });

  it("enriches the convention with observed roles and a usage example", () => {
    const { components } = reconcileComponents([detected("shadcn/ui")], evidenceWith([radixNode]));
    const shadcn = components.find((c) => c.name === "shadcn/ui");
    expect(shadcn?.variants).toContain("dialog"); // observed role on the matched node
    expect(shadcn?.usageExamples.some((e) => e.includes("observed on"))).toBe(true);
  });

  it("a bare role=button element does NOT confirm a declared-but-unused Radix/shadcn dep (#38)", () => {
    const { components, conflicts } = reconcileComponents([detected("radix")], evidenceWith([bareButtonNode]));
    const radix = components.find((c) => c.name === "radix");
    expect(radix?.confidence).toBeLessThan(0.5); // degraded, not observed
    expect(radix?.provenance).toBe("code"); // not lifted
    expect(conflicts.some((c) => c.field === "components.radix")).toBe(true);
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
    const draft = emptyDraft("apatureai", "canon", "test");
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
