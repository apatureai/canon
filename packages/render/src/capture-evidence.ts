import type { Provenance } from "@uidna/schema";

/**
 * `CaptureEvidence` — the typed INPUT PORT by which ui-dna consumes
 * judgment-engine's rendered-evidence artifacts (PRD §4, §7; ECOSYSTEM /
 * core #103 DECISION-3). The engine OWNS capture (Playwright viewports, DOM
 * geometry, a11y + computed-style, screenshot storage, phash); ui-dna OWNS
 * reconciliation and reads it through this seam. **This repo never runs a
 * browser** — these are plain serializable types describing already-captured
 * data, MOCKED in tests.
 *
 * The shapes mirror the engine surfaces named in issue #15 (cross-repo, not
 * reimplemented here): DOM geometry map (engine #18), 3 viewports @ DSF 2
 * (#11), a11y tree + computed-style (#19), downscale/tiling (#16/#17), phash
 * stability (#15). They are additive to and consistent with `@uidna/schema`
 * (e.g. screenshot `ref` matches `RenderedAnchor.ref` — bytes are NOT stored).
 */

/**
 * Version of the `CaptureEvidence` format this repo expects. Bumped on any
 * breaking change to the port shape; evidence evolves additive-only within a
 * version so downstream UD3 modules read it like a stable contract.
 */
export const CAPTURE_VERSION = "1";

/** A rendered viewport the engine captured at (device-scale-factor). */
export interface Viewport {
  width: number;
  height: number;
  /** Device scale factor (engine #11 captures at DSF 2). */
  deviceScaleFactor: number;
  /** Optional label, e.g. "mobile" | "tablet" | "desktop". */
  label?: string;
}

/** An axis-aligned bounding rect in CSS pixels (engine #18 DOM geometry). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One element in the captured DOM geometry map (engine #18: selector/role/rect). */
export interface GeometryNode {
  /** Stable CSS selector the engine assigned to the element. */
  selector: string;
  /** ARIA/implicit role, when the engine resolved one. */
  role: string | null;
  rect: Rect;
}

/**
 * A single a11y / computed-style observation the engine's checks produced
 * (engine #19: contrast, overflow, touch-target, ...). `selector` ties it back
 * to a `GeometryNode`; `value` is the engine's serialized finding.
 */
export interface ComputedStyleFact {
  /** Check id, e.g. "contrast" | "overflow" | "touch-target". */
  check: string;
  selector: string;
  /** Engine's serialized value/result for the check (kept opaque to ui-dna). */
  value: string;
  /** Whether the engine flagged this as a violation (vs. an observation). */
  violation: boolean;
}

/** A perceptual hash the engine computed for screenshot stability (engine #15). */
export interface Phash {
  /** Hex phash string. */
  hash: string;
  /** Bits in the phash (e.g. 64), so consumers can interpret hamming distance. */
  bits: number;
}

/** Captured evidence for ONE route at ONE viewport. */
export interface RouteCapture {
  route: string;
  viewport: Viewport;
  /**
   * Object-storage reference to the screenshot/crop (bytes are NOT stored here
   * — mirrors `@uidna/schema` `RenderedAnchor.ref`).
   */
  screenshotRef: string;
  /** DOM geometry map for this route@viewport (engine #18). */
  geometry: GeometryNode[];
  /** a11y + computed-style facts (engine #19). */
  computedStyle: ComputedStyleFact[];
  /** Perceptual hash of the screenshot (engine #15), when computed. */
  phash: Phash | null;
}

/**
 * The full bundle of rendered evidence the engine captured for a repo snapshot,
 * keyed by the extraction it belongs to. `provenance` is always "pixels" — this
 * is observed-from-render evidence, the counterpart to the "code"/"config"
 * facts the static extractors emit.
 */
export interface CaptureEvidence {
  /** Schema/format version of this evidence bundle (additive evolution). */
  captureVersion: string;
  /** Engine capture-pipeline version that produced it (determinism stamp). */
  engineCaptureVersion: string;
  /** Every captured route@viewport. */
  captures: RouteCapture[];
  /** Always "pixels" for rendered evidence; carried for downstream fact stamping. */
  provenance: Extract<Provenance, "pixels">;
}
