import type { Conflict, DnaTokens, Fact, VisualDistributions } from "@uidna/schema";
import {
  canonicalTokenValue,
  pixelsFactsFromDistributions,
  RENDER_BACKED_GROUPS,
  type PixelsFactsByGroup,
} from "./pixels-facts.js";
import { reconcileField } from "./reconcile-field.js";
import { clampDelta, DISAGREEMENT_DEGRADE, MIN_DEGRADED_CONFIDENCE } from "./thresholds.js";

/**
 * Token reconciliation (#19): merge the code/config-extracted `DnaTokens`
 * (#1–#4) against the rendered `VisualDistributions` (#16) into a single
 * resolved `DnaTokens` + `Conflict[]`, via `reconcileField`.
 *
 * Per declared token (in a render-backed group):
 * - the pixels distribution CONFIRMS its value → reconcileField reinforces it;
 * - the pixels NEVER exhibit its value (dead declared token) → keep the value,
 *   degrade confidence, record a conflict (the #21 dead-token signal);
 * - groups the render can't speak to (shadows/breakpoints/motion) pass through
 *   unchanged — pixels have nothing to say.
 *
 * Then any strong rendered value with NO declared token is surfaced as a real
 * `pixels` candidate Fact (never silently dropped) for sign-off.
 *
 * Pure + deterministic. Output validates against `@uidna/schema`.
 */
export interface ReconcileTokensResult {
  tokens: DnaTokens;
  conflicts: Conflict[];
}

const RENDER_BACKED = new Set<keyof DnaTokens>(RENDER_BACKED_GROUPS);

function emptyTokens(): DnaTokens {
  return { color: {}, typography: {}, spacing: {}, radii: {}, shadows: {}, breakpoints: {}, motion: {} };
}

/** A declared token observed nowhere in pixels: keep value, degrade, record conflict. */
function deadToken(
  field: string,
  declared: Fact<string>,
): { resolved: Fact<string>; conflict: Conflict } {
  const resolved: Fact<string> = {
    value: declared.value,
    confidence: Math.max(MIN_DEGRADED_CONFIDENCE, declared.confidence * (1 - DISAGREEMENT_DEGRADE)),
    provenance: declared.provenance,
  };
  return {
    resolved,
    conflict: {
      field,
      candidates: [
        { value: declared.value, provenance: declared.provenance, confidence: declared.confidence },
      ],
      winner: declared.provenance,
      confidenceDelta: clampDelta(resolved.confidence - declared.confidence),
    },
  };
}

export function reconcileTokens(
  codeTokens: DnaTokens,
  distributions: VisualDistributions,
): ReconcileTokensResult {
  const pixels = pixelsFactsFromDistributions(distributions);
  const out = emptyTokens();
  const conflicts: Conflict[] = [];

  for (const group of Object.keys(out) as (keyof DnaTokens)[]) {
    const declaredGroup = codeTokens[group];
    const pixelsGroup = (pixels as PixelsFactsByGroup)[group] ?? {};
    const matchedPixelKeys = new Set<string>();

    for (const [name, declared] of Object.entries(declaredGroup)) {
      const field = `tokens.${group}.${name}`;
      if (!RENDER_BACKED.has(group)) {
        out[group][name] = declared; // pixels can't speak to this group
        continue;
      }
      const key = canonicalTokenValue(group, declared.value);
      const pixelFact = pixelsGroup[key];
      if (pixelFact) {
        matchedPixelKeys.add(key);
        // The declared value and the pixels candidate match canonically (same
        // key) but may differ in raw string (e.g. "16px" vs "16"). Reconcile on
        // the DECLARED value so this registers as agreement, not a false
        // disagreement, and the resolved fact keeps the declared form.
        const pixelsAgreeing: Fact<string> = { ...pixelFact, value: declared.value };
        const { resolved, conflicts: fc } = reconcileField(field, [declared, pixelsAgreeing]);
        out[group][name] = resolved;
        conflicts.push(...fc);
      } else {
        const { resolved, conflict } = deadToken(field, declared);
        out[group][name] = resolved;
        conflicts.push(conflict);
      }
    }

    // Pixels-only: a strong rendered value with no declared token -> candidate
    // Fact. Sorted so output is deterministic regardless of distribution order.
    if (RENDER_BACKED.has(group)) {
      for (const key of Object.keys(pixelsGroup).sort()) {
        if (matchedPixelKeys.has(key)) continue;
        out[group][`pixels:${key}`] = pixelsGroup[key] as Fact<string>;
      }
    }
  }

  return { tokens: out, conflicts };
}
