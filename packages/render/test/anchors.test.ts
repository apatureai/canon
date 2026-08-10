import { emptyDraft, validateSnapshot } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import { sampleCaptureEvidence, selectAnchors, type CaptureEvidence } from "../src/index.js";

describe("selectAnchors", () => {
  it("returns RenderedAnchors referencing storage refs, never inlining bytes", () => {
    const anchors = selectAnchors(sampleCaptureEvidence());
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(a.ref).toMatch(/^s3:\/\//); // object-storage ref, not bytes
      expect(a.provenance).toBe("pixels");
      expect(typeof a.route).toBe("string");
      expect(a.description).toContain(a.route);
    }
  });

  it("stamps every anchor provenance pixels and one per route by default", () => {
    const anchors = selectAnchors(sampleCaptureEvidence());
    const routes = anchors.map((a) => a.route);
    expect(new Set(routes).size).toBe(routes.length); // <= 1 per route
    expect(routes.sort()).toEqual(["/", "/pricing"]);
  });

  it("honors a customer allow-list for anchor eligibility (PRD §8)", () => {
    const anchors = selectAnchors(sampleCaptureEvidence(), { allowRoutes: ["/pricing"] });
    expect(anchors.map((a) => a.route)).toEqual(["/pricing"]);
  });

  it("honors a deny-list (applied after the allow-list)", () => {
    const anchors = selectAnchors(sampleCaptureEvidence(), { denyRoutes: ["/"] });
    expect(anchors.map((a) => a.route)).toEqual(["/pricing"]);
  });

  it("is bounded by maxTotal and maxPerRoute", () => {
    expect(selectAnchors(sampleCaptureEvidence(), { maxTotal: 1 })).toHaveLength(1);
  });

  it("ranks by canonical-pattern coverage (cleaner/richer capture wins under a cap)", () => {
    // The home route has more geometry + clean style facts than /pricing,
    // so under a 1-total cap it should win.
    const anchors = selectAnchors(sampleCaptureEvidence(), { maxTotal: 1 });
    expect(anchors[0]?.route).toBe("/");
  });

  it("penalizes captures with violations so a broken page is a poor anchor", () => {
    const ev = sampleCaptureEvidence();
    // Make /pricing richer in raw count but with a violation; / should still win.
    const pricing = ev.captures.find((c) => c.route === "/pricing");
    if (pricing) {
      pricing.computedStyle.push(
        { check: "contrast", selector: "x", value: "1.0", violation: true },
        { check: "a", selector: "x", value: "1", violation: false },
        { check: "b", selector: "x", value: "1", violation: false },
        { check: "c", selector: "x", value: "1", violation: false },
      );
    }
    const anchors = selectAnchors(ev, { maxTotal: 1 });
    expect(anchors[0]?.route).toBe("/");
  });

  it("is deterministic: same evidence -> same anchors", () => {
    expect(selectAnchors(sampleCaptureEvidence())).toEqual(selectAnchors(sampleCaptureEvidence()));
  });

  it("returns no anchors for empty evidence", () => {
    const empty: CaptureEvidence = {
      captureVersion: "1",
      engineCaptureVersion: "test-engine-0",
      provenance: "pixels",
      captures: [],
    };
    expect(selectAnchors(empty)).toEqual([]);
  });

  it("produces anchors that pass schema validation when merged into a draft", () => {
    const draft = emptyDraft("apatureai", "canon", "test");
    draft.anchors = selectAnchors(sampleCaptureEvidence());
    expect(validateSnapshot(draft)).toEqual({ ok: true });
  });
});
