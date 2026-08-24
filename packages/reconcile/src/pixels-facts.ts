import { canonicalColor, type DnaTokens, type Fact, type VisualDistributions } from "@apatureai/canon-schema";
import { clampConfidence } from "./thresholds.js";

/**
 * Turn a `VisualDistributions` (#16, observed render reality) into per-group
 * `pixels`-provenance candidate Facts, with confidence COMPUTED from the
 * distribution's stability/coverage, NOT a fixed ladder rung (the decided
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
  // Coverage share: each distinct interval's weight is 1/N. A sequence with
  // fewer distinct intervals means each is more canonical (more stable), so a
  // single dominant interval scores near the ceiling and a long tail scores low.
  const share = 1 / values.length;
  for (const v of values) {
    out[String(v)] = { value: String(v), confidence: scale(share), provenance: "pixels" };
  }
  return out;
}

function colorFacts(proportions: Record<string, number>): Record<string, Fact<string>> {
  // Key by the SAME canonical form the declared-token side uses
  // (`canonicalColor`, via `canonicalTokenValue`) so matching is symmetric: a
  // rendered shorthand `#fff` and a declared `#ffffff` (or vice versa) resolve
  // to one key instead of reading as a false disagreement / dead token. Keying
  // by `color.toLowerCase()` alone only unified case, not shorthand, so an
  // observed shorthand hex could never confirm a declared longhand token.
  // A shorthand and its longhand form (and case variants) that collapse to the
  // same canonical color are the same observation: sum their shares. The first
  // observed raw string is kept as the candidate `value` (declared form still
  // wins on a match; this only names a pixels-only candidate).
  const agg = new Map<string, { value: string; share: number }>();
  for (const [color, proportion] of Object.entries(proportions)) {
    const key = colorKey(color);
    const existing = agg.get(key);
    if (existing) existing.share += proportion;
    else agg.set(key, { value: color, share: proportion });
  }
  const out: Record<string, Fact<string>> = {};
  for (const [key, { value, share }] of agg) {
    out[key] = { value, confidence: scale(share), provenance: "pixels" };
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

/** Root font size (px) used to normalize rem/em into px so they compare equal. */
const ROOT_FONT_PX = 16;

/**
 * A TOTAL colour key for matching a rendered colour to a declared token. Uses the
 * shared canonicalizer (`@apatureai/canon-schema` `canonicalColor`, #97) so hex, shorthand,
 * case, AND `rgb()/rgba()` all collapse to one `#rrggbbaa` key, so `#fff` /
 * `#ffffff` / `rgb(255,255,255)` are one observation, not a false disagreement /
 * dead token. Anything the shared canonicalizer does not recognize (named
 * colours, `hsl()`) falls back to the trimmed/lowercased string as its key.
 */
function colorKey(value: string): string {
  return canonicalColor(value) ?? value.trim().toLowerCase();
}

/**
 * Canonicalize a numeric token VALUE to a comparable px-number string. Pulls the
 * leading number + optional unit; `rem`/`em` are scaled by the root font size so
 * `1rem` ≡ `16` ≡ `16px` (the distributions are px-numeric). `px`/unitless keep
 * the raw number; an unrecognized unit keeps the bare number (errs toward a
 * conflict, never toward a false match). Trailing zeros are trimmed so
 * `16` ≡ `16.0`.
 */
function canonicalNumeric(value: string): string {
  const m = /(-?\d+(?:\.\d+)?)\s*(rem|em|px)?/.exec(value);
  if (!m) return value.trim();
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return (m[1] as string);
  const px = m[2] === "rem" || m[2] === "em" ? n * ROOT_FONT_PX : n;
  // Normalize the number form: integers print without a decimal, so "16" ≡ "16.0".
  return String(px);
}

/** Canonicalize a declared token VALUE for matching against pixels facts. */
export function canonicalTokenValue(group: keyof DnaTokens, value: string): string {
  if (group === "color") return colorKey(value);
  return canonicalNumeric(value);
}
