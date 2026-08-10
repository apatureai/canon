import type { RenderedAnchor } from "@uidna/schema";
import type { CaptureEvidence, RouteCapture } from "./capture-evidence.js";

/**
 * Rendered-anchor selection (PRD §5, §8). Deterministically SELECT the
 * screenshot crops that best demonstrate canonical patterns from already-
 * captured evidence and emit them as `RenderedAnchor[]`, each carrying an
 * object-storage `ref` (bytes are NOT inlined), the `route`, a `description`,
 * and `pixels` provenance. This is selection over the `@uidna/render` port, NOT
 * capture; no IO here.
 *
 * The customer controls which routes may become canonical anchors (PRD §8), via
 * an allow/deny route list. Selection is bounded (a cap per route and per
 * snapshot) and ranks by canonical-pattern coverage so the strongest anchors
 * win when the cap binds.
 */

export interface SelectAnchorsOptions {
  /** If set, only these routes are eligible (allow-list). */
  allowRoutes?: string[];
  /** Routes excluded from anchoring (deny-list); applied after the allow-list. */
  denyRoutes?: string[];
  /** Max anchors per route (default 1, one canonical crop per route). */
  maxPerRoute?: number;
  /** Max anchors in the whole snapshot (default 12). */
  maxTotal?: number;
}

const DEFAULT_MAX_PER_ROUTE = 1;
const DEFAULT_MAX_TOTAL = 12;

/**
 * Canonical-pattern coverage score for a capture: more observed elements and
 * more clean (non-violation) computed-style facts = a better demonstration of
 * the canonical look; any violation penalizes it (a broken page is a poor
 * anchor). Integer + bounded so ranking is stable.
 */
function coverageScore(capture: RouteCapture): number {
  const elements = capture.geometry.length;
  const clean = capture.computedStyle.filter((f) => !f.violation).length;
  const violations = capture.computedStyle.filter((f) => f.violation).length;
  return elements + clean - violations * 5;
}

function isEligible(route: string, opts: SelectAnchorsOptions): boolean {
  if (opts.allowRoutes && !opts.allowRoutes.includes(route)) return false;
  if (opts.denyRoutes && opts.denyRoutes.includes(route)) return false;
  return true;
}

function describe(capture: RouteCapture): string {
  const vp = capture.viewport.label ?? `${capture.viewport.width}x${capture.viewport.height}`;
  return `Canonical render of ${capture.route} at ${vp} (${capture.geometry.length} elements)`;
}

/**
 * Select canonical rendered anchors from capture evidence. Deterministic:
 * captures are ranked by coverage (desc) with stable tie-breaks (route, then
 * viewport width, then screenshot ref), capped per-route and per-snapshot.
 */
export function selectAnchors(
  evidence: CaptureEvidence,
  opts: SelectAnchorsOptions = {},
): RenderedAnchor[] {
  const maxPerRoute = opts.maxPerRoute ?? DEFAULT_MAX_PER_ROUTE;
  const maxTotal = opts.maxTotal ?? DEFAULT_MAX_TOTAL;

  const ranked = evidence.captures
    .filter((c) => isEligible(c.route, opts))
    .map((c) => ({ capture: c, score: coverageScore(c) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.capture.route !== b.capture.route) return a.capture.route < b.capture.route ? -1 : 1;
      if (a.capture.viewport.width !== b.capture.viewport.width) {
        return a.capture.viewport.width - b.capture.viewport.width;
      }
      return a.capture.screenshotRef < b.capture.screenshotRef ? -1 : 1;
    });

  const perRoute = new Map<string, number>();
  const anchors: RenderedAnchor[] = [];
  for (const { capture } of ranked) {
    if (anchors.length >= maxTotal) break;
    const used = perRoute.get(capture.route) ?? 0;
    if (used >= maxPerRoute) continue;
    perRoute.set(capture.route, used + 1);
    anchors.push({
      ref: capture.screenshotRef,
      route: capture.route,
      description: describe(capture),
      provenance: "pixels",
    });
  }
  return anchors;
}
