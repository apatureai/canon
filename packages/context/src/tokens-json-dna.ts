import type { DnaTokens, Fact } from "@apatureai/canon-schema";
import { fact } from "@apatureai/canon-schema";
import { classifyTokenName, emptyTokens } from "./token-groups.js";
import type { TokenDiagnostic } from "./tokens-json.js";
import { projectTokenValue, resolveTokensJson } from "./tokens-json.js";
import { CONFIG_CONFIDENCE } from "./internal.js";

/**
 * Map a `tokens.json` document onto the canonical `DnaTokens` groups (PRD §5),
 * stamping every value as a `Fact<string>` with provenance "config". A
 * tokens.json is an explicit, declared design-token file, a stronger signal than
 * CSS vars inferred from code, so it earns a higher confidence.
 *
 * Grouping prefers the DTCG Format 2025.10 `$type` (an authored category) and
 * falls back to name-prefix classification when `$type` is absent (classic Style
 * Dictionary files rarely declare it). Tokens that match neither are dropped from
 * the typed groups rather than guessed.
 */

/** Map a DTCG Format 2025.10 `$type` onto a canonical group, or null if it has no home. */
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

export interface ExtractTokensResult {
  tokens: DnaTokens;
  /** Tokens that could not be resolved or validated are abstained, never promoted. */
  diagnostics: TokenDiagnostic[];
}

/**
 * Extract canonical DNA tokens from a parsed-JSON tokens document. Deterministic:
 * same document in → same `DnaTokens` out (token list is walked in document
 * order; later duplicate dotted-names win, matching JSON object semantics).
 */
export function extractTokensJsonWithDiagnostics(doc: unknown): ExtractTokensResult {
  const tokens = emptyTokens();
  const resolution = resolveTokensJson(doc);

  for (const { name, value, type } of resolution.tokens) {
    // DTCG 2025.10 types border-radius AND typographic lengths (font-size,
    // line-height, letter-spacing) as `dimension`, the SAME `$type` as spacing,
    // so `groupFromType` alone would file all of them under `spacing`. The token
    // NAME is the only disambiguator the format offers, so for a `dimension` token
    // let a more specific name-group (`radii` or `typography`) win over the
    // spacing default. This keeps radius/type drift grounded against the group
    // where code-side extraction files it, instead of comparing it as spacing.
    const byName = classifyTokenName(name);
    const nameRefinesDimension = type === "dimension" && (byName === "radii" || byName === "typography");
    const group = nameRefinesDimension ? byName : (groupFromType(type) ?? byName);
    if (!group) continue;
    (tokens[group] as Record<string, Fact<string>>)[name] = fact(
      projectTokenValue(value, type),
      CONFIG_CONFIDENCE,
      "config",
    );
  }

  return { tokens, diagnostics: resolution.diagnostics };
}

/** Compatibility projection for existing DNA consumers. */
export function extractTokensJson(doc: unknown): DnaTokens {
  return extractTokensJsonWithDiagnostics(doc).tokens;
}
