import type { DnaTokens, Fact } from "@uidna/schema";
import { fact } from "@uidna/schema";
import { classifyTokenName, emptyTokens } from "./token-groups.js";
import { parseTokensJsonTyped } from "./tokens-json.js";

/**
 * Map a `tokens.json` document onto the canonical `DnaTokens` groups (PRD §5),
 * stamping every value as a `Fact<string>` with provenance "config" — a
 * tokens.json is an explicit, declared design-token file, a stronger signal than
 * CSS vars inferred from code, so it earns a higher confidence.
 *
 * Grouping prefers the W3C `$type` (an authored, machine-declared category) and
 * falls back to name-prefix classification when `$type` is absent (classic Style
 * Dictionary files rarely declare it). Tokens that match neither are dropped from
 * the typed groups rather than guessed.
 */
const CONFIG_CONFIDENCE = 0.8;

/** Map a W3C `$type` onto a canonical `DnaTokens` group, or null if it has no home. */
function groupFromType(type: string | null): keyof DnaTokens | null {
  switch (type) {
    case "color":
      return "color";
    case "dimension":
    case "spacing":
      return "spacing";
    case "fontFamily":
    case "fontWeight":
    case "fontSize":
    case "typography":
    case "letterSpacing":
    case "lineHeight":
      return "typography";
    case "borderRadius":
      return "radii";
    case "shadow":
      return "shadows";
    case "duration":
    case "cubicBezier":
    case "transition":
      return "motion";
    default:
      return null;
  }
}

/**
 * Extract canonical DNA tokens from a parsed-JSON tokens document. Deterministic:
 * same document in → same `DnaTokens` out (token list is walked in document
 * order; later duplicate dotted-names win, matching JSON object semantics).
 */
export function extractTokensJson(doc: unknown): DnaTokens {
  const tokens = emptyTokens();

  for (const { name, value, type } of parseTokensJsonTyped(doc)) {
    const group = groupFromType(type) ?? classifyTokenName(name);
    if (!group) continue;
    (tokens[group] as Record<string, Fact<string>>)[name] = fact(value, CONFIG_CONFIDENCE, "config");
  }

  return tokens;
}
