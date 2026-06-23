import type { VisualDistributions } from "@uidna/schema";
import type { CaptureEvidence, ComputedStyleFact, GeometryNode } from "./capture-evidence.js";

/**
 * Visual-distribution analysis (PRD §5, §7). From the `CaptureEvidence`
 * DOM-geometry + computed-style facts, compute the canonical
 * `VisualDistributions` — the "rendered reality" half the reconciler (UD3)
 * weighs against the code-inferred tokens (UD1). Pure + deterministic: identical
 * evidence in → byte-identical distributions out (sorted, rounded — no float
 * churn). Consumes only the `@uidna/render` port; no IO.
 *
 * Signal sources within the evidence:
 * - spacing intervals  ← vertical gaps between sibling geometry rects
 * - density            ← elements per viewport area (geometry count / area)
 * - type scale         ← computed-style `font-size` facts
 * - radius patterns    ← computed-style `border-radius` facts
 * - color proportions  ← computed-style `color`/`background-color` facts
 * Distributions are empty/null where the evidence carries no such signal — never
 * invented, never NaN.
 */

/** Decimal places distributions are rounded to, so equal evidence hashes equal. */
const PRECISION = 3;

function round(n: number): number {
  const f = 10 ** PRECISION;
  // +0 avoids a "-0" result that would serialize differently from 0.
  return Math.round(n * f) / f + 0;
}

/** Sort ascending and drop duplicates (after rounding) for a stable interval set. */
function uniqueSorted(values: number[]): number[] {
  const rounded = values.map(round).filter((n) => Number.isFinite(n));
  return [...new Set(rounded)].sort((a, b) => a - b);
}

/** Parse a leading numeric value out of a computed-style string (e.g. "16px" -> 16). */
function parseNumber(value: string): number | null {
  const m = /-?\d+(?:\.\d+)?/.exec(value);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function styleValues(facts: ComputedStyleFact[], check: string): number[] {
  const out: number[] = [];
  for (const f of facts) {
    if (f.check !== check) continue;
    const n = parseNumber(f.value);
    if (n !== null) out.push(n);
  }
  return out;
}

/** Vertical gaps between vertically-adjacent sibling rects -> spacing signal. */
function spacingGaps(geometry: GeometryNode[]): number[] {
  const tops = geometry.map((g) => g.rect).sort((a, b) => a.y - b.y);
  const gaps: number[] = [];
  for (let i = 1; i < tops.length; i++) {
    const prev = tops[i - 1];
    const cur = tops[i];
    if (!prev || !cur) continue;
    const gap = cur.y - (prev.y + prev.height);
    if (gap > 0) gaps.push(gap);
  }
  return gaps;
}

/** Color proportions from `color`/`background-color` facts, normalized to sum ~1.0. */
function colorProportions(facts: ComputedStyleFact[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const f of facts) {
    if (f.check !== "color" && f.check !== "background-color") continue;
    const key = f.value.trim().toLowerCase();
    if (key === "") continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return {};
  const out: Record<string, number> = {};
  // Insertion in sorted-key order keeps serialization deterministic.
  for (const key of [...counts.keys()].sort()) {
    out[key] = round((counts.get(key) as number) / total);
  }
  return out;
}

/**
 * Compute the canonical `VisualDistributions` from captured render evidence.
 * Aggregates across every route@viewport in the bundle.
 */
export function computeVisualDistributions(evidence: CaptureEvidence): VisualDistributions {
  const allGaps: number[] = [];
  const allFontSizes: number[] = [];
  const allRadii: number[] = [];
  const allStyle: ComputedStyleFact[] = [];

  let elementCount = 0;
  let viewportArea = 0;

  for (const capture of evidence.captures) {
    allGaps.push(...spacingGaps(capture.geometry));
    allFontSizes.push(...styleValues(capture.computedStyle, "font-size"));
    allRadii.push(...styleValues(capture.computedStyle, "border-radius"));
    allStyle.push(...capture.computedStyle);
    elementCount += capture.geometry.length;
    viewportArea += capture.viewport.width * capture.viewport.height;
  }

  // Density = elements per million px^2 of viewport, null when no area observed.
  const density = viewportArea > 0 ? round((elementCount / viewportArea) * 1_000_000) : null;

  return {
    spacingIntervals: uniqueSorted(allGaps),
    typeScale: uniqueSorted(allFontSizes),
    colorProportions: colorProportions(allStyle),
    radiusPatterns: uniqueSorted(allRadii),
    density,
  };
}
