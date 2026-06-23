import type { DnaTokens, Fact, VisualDistributions } from "@uidna/schema";
import { clampConfidence } from "./thresholds.js";

/**
 * Turn a `VisualDistributions` (#16, observed render reality) into per-group
 * `pixels`-provenance candidate Facts, with confidence COMPUTED from the
 * distribution's stability/coverage — NOT a fixed ladder rung (the decided
 * rule). A value that dominates its distribution (a high share of observations)
 * is a more stable, higher-confidence pixels candidate than a one-off.
 *
 * Numeric groups (spacing/typography/radii) are keyed by their canonical
 * numeric string (e.g. "16"); color is keyed by the lowercased color string and
 * its confidence is its observed proportion. These keys are what
 * `reconcileTokens` matches declared token VALUES against.
 */

/** Min pixels confidence floor and max ceiling (never the 1.0 reserved for sign-off). */
const PIXELS_MIN = 0.2;
const PIXELS_MAX = 0.9;

function scale(share: number): number {
  // Map a 0..1 coverage share onto [PIXELS_MIN, PIXELS_MAX] linearly.
  return clampConfidence(PIXELS_MIN + (PIXELS_MAX - PIXELS_MIN) * clampConfidence(share));
}

/** A numeric interval distribution -> { canonicalValue: pixelsFact } keyed by number string. */
function numericFacts(values: number[]): Record<string, Fact<string>> {
  const out: Record<string, Fact<string>> = {};
  if (values.length === 0) return out;
  // Coverage share: each distinct interval's weight is 1/N — a sequence with
  // fewer distinct intervals means each is more canonical (more stable), so a
  // single dominant interval scores near the ceiling and a long tail scores low.
  const share = 1 / values.length;
  for (const v of values) {
    out[String(v)] = { value: String(v), confidence: scale(share), provenance: "pixels" };
  }
  return out;
}

function colorFacts(proportions: Record<string, number>): Record<string, Fact<string>> {
  const out: Record<string, Fact<string>> = {};
  for (const [color, proportion] of Object.entries(proportions)) {
    out[color.toLowerCase()] = { value: color, confidence: scale(proportion), provenance: "pixels" };
  }
  return out;
}

/** Pixels candidate facts per canonical token group, keyed by canonical value. */
export interface PixelsFactsByGroup {
  color: Record<string, Fact<string>>;
  typography: Record<string, Fact<string>>;
  spacing: Record<string, Fact<string>>;
  radii: Record<string, Fact<string>>;
  /** Groups the render distribution carries no signal for (always empty here). */
  shadows: Record<string, Fact<string>>;
  breakpoints: Record<string, Fact<string>>;
  motion: Record<string, Fact<string>>;
}

/** Build pixels candidate facts (keyed by canonical value) from a distribution. */
export function pixelsFactsFromDistributions(d: VisualDistributions): PixelsFactsByGroup {
  return {
    color: colorFacts(d.colorProportions),
    typography: numericFacts(d.typeScale),
    spacing: numericFacts(d.spacingIntervals),
    radii: numericFacts(d.radiusPatterns),
    shadows: {},
    breakpoints: {},
    motion: {},
  };
}

/** The canonical token groups the render distribution can speak to. */
export const RENDER_BACKED_GROUPS = ["color", "typography", "spacing", "radii"] as const;
export type RenderBackedGroup = (typeof RENDER_BACKED_GROUPS)[number];

/** Canonicalize a declared token VALUE for matching against pixels facts. */
export function canonicalTokenValue(group: keyof DnaTokens, value: string): string {
  if (group === "color") return value.trim().toLowerCase();
  // numeric groups: match on the leading number (e.g. "16px" -> "16").
  const m = /-?\d+(?:\.\d+)?/.exec(value);
  return m ? m[0] : value.trim();
}
