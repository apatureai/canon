import { fact } from "@uidna/schema";
import {
  emptyDistributions,
  emptyTokens,
  type LabeledReconcileFixture,
} from "../../src/index.js";

/**
 * The FROZEN labeled reconciliation fixture set the #28 CI gate runs against.
 * Each case is hand-labeled with the human-confirmed truth for every resolved
 * field — so reconciliation accuracy + calibration are MEASURED, not assumed.
 *
 * SYNTHETIC for now. The production gate needs REAL customer labels (the
 * team-acceptance / manual-edit signal from sign-off, PRD §9, like #9) before
 * it gates a release on real-world calibration; these prove the harness and the
 * current precedence ladder behaves as decided.
 *
 * Each case exercises a distinct reconciliation path:
 *  - agreement: a declared token CONFIRMED by the render distribution.
 *  - dead token: a declared token observed nowhere in pixels (kept, degraded, conflict).
 *  - pass-through: a non-render-backed group (shadows) the pixels can't speak to.
 *  - human override: a human/feedback token that wins the value over pixels.
 */

/** Agreement: code `--brand` confirmed by a dominant render color → reinforced, no conflict. */
function agreementConfirmed(): LabeledReconcileFixture {
  const codeTokens = emptyTokens();
  codeTokens.color["--brand"] = fact("#0a0a0a", 0.8, "code");
  codeTokens.spacing["--gap"] = fact("8px", 0.8, "config");
  const distributions = emptyDistributions();
  distributions.colorProportions = { "#0a0a0a": 0.7 };
  distributions.spacingIntervals = [8]; // single dominant interval -> strong pixels agreement
  return {
    name: "agreement-confirmed",
    codeTokens,
    distributions,
    labels: [
      { field: "tokens.color.--brand", expectedValue: "#0a0a0a", expectConflict: false },
      { field: "tokens.spacing.--gap", expectedValue: "8px", expectConflict: false },
    ],
  };
}

/** Dead token: a declared token the render never exhibits → value kept, conflict recorded. */
function deadDeclaredToken(): LabeledReconcileFixture {
  const codeTokens = emptyTokens();
  codeTokens.spacing["--legacy"] = fact("13px", 0.7, "config"); // never observed
  codeTokens.radii["--md"] = fact("6px", 0.7, "code"); // never observed
  const distributions = emptyDistributions();
  distributions.spacingIntervals = [8, 16]; // 13 not present
  distributions.radiusPatterns = [4]; // 6 not present
  return {
    name: "dead-declared-token",
    codeTokens,
    distributions,
    labels: [
      { field: "tokens.spacing.--legacy", expectedValue: "13px", expectConflict: true },
      { field: "tokens.radii.--md", expectedValue: "6px", expectConflict: true },
    ],
  };
}

/** Pass-through: a shadow token (non-render-backed group) kept verbatim, no conflict. */
function passThroughShadow(): LabeledReconcileFixture {
  const codeTokens = emptyTokens();
  codeTokens.shadows["--card"] = fact("0 1px 2px rgba(0,0,0,.1)", 0.75, "config");
  codeTokens.breakpoints["--md"] = fact("768px", 0.9, "config");
  return {
    name: "pass-through-non-render-backed",
    codeTokens,
    distributions: emptyDistributions(),
    labels: [
      { field: "tokens.shadows.--card", expectedValue: "0 1px 2px rgba(0,0,0,.1)", expectConflict: false },
      { field: "tokens.breakpoints.--md", expectedValue: "768px", expectConflict: false },
    ],
  };
}

/** Human override: a human token wins the value; with no pixel match it's a kept conflict. */
function humanOverride(): LabeledReconcileFixture {
  const codeTokens = emptyTokens();
  codeTokens.color["--brand"] = fact("#ffffff", 1, "human"); // sign-off truth
  const distributions = emptyDistributions();
  distributions.colorProportions = { "#0a0a0a": 0.6 }; // pixels disagree (different color)
  return {
    name: "human-override",
    codeTokens,
    distributions,
    labels: [
      // Human value is kept; the render disagreement is recorded as a conflict.
      { field: "tokens.color.--brand", expectedValue: "#ffffff", expectConflict: true },
    ],
  };
}

/** The frozen set the CI gate runs against. */
export const LABELED_FIXTURES: LabeledReconcileFixture[] = [
  agreementConfirmed(),
  deadDeclaredToken(),
  passThroughShadow(),
  humanOverride(),
];
