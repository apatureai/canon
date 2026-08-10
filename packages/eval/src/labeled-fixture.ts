import type { DnaTokens, VisualDistributions } from "@uidna/schema";

/**
 * A labeled reconciliation fixture (#28, PRD §9): the inputs to token
 * reconciliation (code/config-extracted `DnaTokens` × rendered
 * `VisualDistributions`) PLUS the human-confirmed truth for each resolved field.
 * This is what makes the precedence ladder MEASURED rather than assumed.
 *
 * Synthetic for now (hand-labeled fixtures). The PRODUCTION gate needs REAL
 * customer labels, the team-acceptance signal from sign-off (PRD §9, like #9),
 * before these thresholds gate a release on real data; see the harness note.
 */

/** The human-confirmed truth for one resolved token field. */
export interface FieldLabel {
  /** Field key as `reconcileTokens` emits it, e.g. "tokens.color.--brand". */
  field: string;
  /** The value a human confirmed is correct (the resolved fact should match this). */
  expectedValue: string;
  /** True when the inputs genuinely disagree → reconciliation SHOULD record a conflict. */
  expectConflict: boolean;
}

/** One labeled case: reconcile inputs + the per-field truth. */
export interface LabeledReconcileFixture {
  name: string;
  codeTokens: DnaTokens;
  distributions: VisualDistributions;
  labels: FieldLabel[];
}

/** Empty `DnaTokens` helper so fixtures only set the groups they exercise. */
export function emptyTokens(): DnaTokens {
  return { color: {}, typography: {}, spacing: {}, radii: {}, shadows: {}, breakpoints: {}, motion: {} };
}

/** Empty `VisualDistributions` helper for fixtures that exercise only some signals. */
export function emptyDistributions(): VisualDistributions {
  return { spacingIntervals: [], typeScale: [], colorProportions: {}, radiusPatterns: [], density: null };
}
