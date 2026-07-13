import type { DnaTokens, Fact } from "@uidna/schema";
import { fact } from "@uidna/schema";
import { classifyTokenName, emptyTokens } from "./token-groups.js";
import { resolveTokensJson, type DtcgValue, type ResolutionDiagnostic } from "./tokens-resolver.js";

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

/** Project a resolved DTCG value to the consumer string form (composites deterministic). */
function projectValue(value: DtcgValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value); // composite/array projected only at this consumer boundary, never internally
}

export interface ExtractTokensResult {
  tokens: DnaTokens;
  /** Tokens that could not be resolved (unresolved/circular/type-mismatch/malformed) — abstained, never promoted. */
  diagnostics: ResolutionDiagnostic[];
}

/**
 * Extract canonical DNA tokens from a parsed-JSON tokens document, resolving
 * DTCG 2025.10 aliases first (ui-dna#65). Deterministic. A token whose reference
 * is unresolved/circular/type-mismatched is NEVER promoted to a 0.8 config fact —
 * it is abstained and reported as a diagnostic. Only fully-resolved values reach
 * the genome.
 */
export function extractTokensJsonWithDiagnostics(doc: unknown): ExtractTokensResult {
  const tokens = emptyTokens();
  const { resolved, diagnostics } = resolveTokensJson(doc);

  for (const { name, value, type } of resolved) {
    const group = groupFromType(type) ?? classifyTokenName(name);
    if (!group) continue;
    (tokens[group] as Record<string, Fact<string>>)[name] = fact(projectValue(value), CONFIG_CONFIDENCE, "config");
  }

  return { tokens, diagnostics };
}

/** Backwards-compatible extractor (tokens only); diagnostics available via the `WithDiagnostics` form. */
export function extractTokensJson(doc: unknown): DnaTokens {
  return extractTokensJsonWithDiagnostics(doc).tokens;
}
