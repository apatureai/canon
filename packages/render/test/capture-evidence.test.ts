import { describe, expect, it } from "vitest";
import {
  CAPTURE_VERSION,
  fixtureCaptureSource,
  sampleCaptureEvidence,
  validateCaptureEvidence,
  type CaptureEvidence,
} from "../src/index.js";

describe("validateCaptureEvidence", () => {
  it("accepts a well-formed fixture (round-trip with no live capture)", () => {
    expect(validateCaptureEvidence(sampleCaptureEvidence())).toEqual({ ok: true });
  });

  it("survives a JSON serialize/parse round-trip (the port is plain data)", () => {
    const parsed = JSON.parse(JSON.stringify(sampleCaptureEvidence())) as CaptureEvidence;
    expect(validateCaptureEvidence(parsed)).toEqual({ ok: true });
    expect(parsed.captureVersion).toBe(CAPTURE_VERSION);
  });

  it("rejects rendered evidence whose provenance is not pixels", () => {
    const bad = { ...sampleCaptureEvidence(), provenance: "code" as unknown as "pixels" };
    const result = validateCaptureEvidence(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("provenance");
  });

  it("reports structural problems with a path (geometry rect must be numeric)", () => {
    const ev = sampleCaptureEvidence();
    // @ts-expect-error: deliberately corrupt the rect for the negative case
    ev.captures[0].geometry[0].rect.width = "wide";
    const result = validateCaptureEvidence(ev);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("geometry[0]"))).toBe(true);
  });

  it("requires a non-empty screenshot ref (bytes are stored elsewhere)", () => {
    const ev = sampleCaptureEvidence();
    const first = ev.captures[0];
    if (first) first.screenshotRef = "";
    const result = validateCaptureEvidence(ev);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("screenshotRef");
  });
});

describe("fixtureCaptureSource (injected port)", () => {
  it("returns evidence for the requested routes only", async () => {
    const source = fixtureCaptureSource(sampleCaptureEvidence());
    const evidence = await source.capture(["/pricing"]);
    expect(evidence.captures.map((c) => c.route)).toEqual(["/pricing"]);
    expect(validateCaptureEvidence(evidence)).toEqual({ ok: true });
  });

  it("returns all captures when no routes are requested", async () => {
    const source = fixtureCaptureSource(sampleCaptureEvidence());
    const evidence = await source.capture([]);
    expect(evidence.captures.map((c) => c.route).sort()).toEqual(["/", "/pricing"]);
  });

  it("is deterministic: same fixture + routes -> same evidence", async () => {
    const source = fixtureCaptureSource(sampleCaptureEvidence());
    expect(await source.capture(["/"])).toEqual(await source.capture(["/"]));
  });
});
