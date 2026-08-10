import { CAPTURE_VERSION, type CaptureEvidence } from "./capture-evidence.js";

/**
 * A small, deterministic `CaptureEvidence` fixture for tests and local dev, the
 * stand-in for real engine capture so UD3 modules and the input port can be
 * exercised with no browser. Two routes at one desktop viewport.
 */
export function sampleCaptureEvidence(): CaptureEvidence {
  return {
    captureVersion: CAPTURE_VERSION,
    engineCaptureVersion: "test-engine-0",
    provenance: "pixels",
    captures: [
      {
        route: "/",
        viewport: { width: 1280, height: 800, deviceScaleFactor: 2, label: "desktop" },
        screenshotRef: "s3://uidna-fixtures/home@desktop.png",
        geometry: [
          { selector: "main", role: "main", rect: { x: 0, y: 0, width: 1280, height: 2400 } },
          { selector: "button.cta", role: "button", rect: { x: 32, y: 96, width: 160, height: 44 } },
        ],
        computedStyle: [
          { check: "contrast", selector: "button.cta", value: "4.8", violation: false },
          { check: "touch-target", selector: "button.cta", value: "44x44", violation: false },
          { check: "font-size", selector: "main", value: "16px", violation: false },
          { check: "font-size", selector: "button.cta", value: "14px", violation: false },
          { check: "border-radius", selector: "button.cta", value: "8px", violation: false },
          { check: "color", selector: "main", value: "#0a0a0a", violation: false },
          { check: "background-color", selector: "main", value: "#ffffff", violation: false },
        ],
        phash: { hash: "f0e1d2c3b4a59687", bits: 64 },
      },
      {
        route: "/pricing",
        viewport: { width: 1280, height: 800, deviceScaleFactor: 2, label: "desktop" },
        screenshotRef: "s3://uidna-fixtures/pricing@desktop.png",
        geometry: [
          { selector: "section.tiers", role: null, rect: { x: 0, y: 120, width: 1280, height: 900 } },
        ],
        computedStyle: [
          { check: "overflow", selector: "section.tiers", value: "none", violation: false },
          { check: "font-size", selector: "section.tiers", value: "16px", violation: false },
          { check: "border-radius", selector: "section.tiers", value: "12px", violation: false },
          { check: "color", selector: "section.tiers", value: "#0A0A0A", violation: false },
        ],
        phash: null,
      },
    ],
  };
}
