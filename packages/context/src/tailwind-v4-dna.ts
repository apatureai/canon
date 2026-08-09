import type { DnaTokens, Fact } from "@uidna/schema";
import { fact } from "@uidna/schema";
import { classifyTokenName, emptyTokens } from "./token-groups.js";
import { extractTailwindV4 } from "./tailwind-v4.js";

/**
 * Map a Tailwind v4 `@theme` block onto the canonical `DnaTokens` groups
 * (PRD §5), stamping every value as a `Fact<string>` with provenance "code".
 *
 * Tailwind v4's `@theme` namespace IS the group taxonomy (`--color-*`,
 * `--spacing-*`, `--font-*`, `--radius-*`, `--shadow-*`, `--breakpoint-*`,
 * `--ease-*`/`--animate-*`), so the shared name classifier resolves the group
 * directly. These are author-declared design tokens (a stronger signal than
 * ad-hoc CSS vars), so confidence sits a notch above raw css-vars but still
 * below 1 (reserved for human-confirmed facts). The `@config` path is returned
 * alongside for the v3 resolveConfig pass (#1) to merge.
 */
const THEME_CONFIDENCE = 0.7;

export interface TailwindV4Tokens {
  tokens: DnaTokens;
  /** True only when an actual `@theme` at-rule was parsed. See `TailwindV4Result`. */
  hasTheme: boolean;
  /** Path from a `@config "..."` directive, if present (resolve via #1). */
  configPath: string | null;
}

/**
 * Extract canonical DNA tokens from a Tailwind v4 CSS source. Deterministic:
 * same CSS in → same tokens out. Tokens whose name doesn't map to a canonical
 * group are dropped rather than guessed.
 */
export function extractTailwindV4Tokens(css: string): TailwindV4Tokens {
  const { tokens: raw, hasTheme, configPath } = extractTailwindV4(css);
  const tokens = emptyTokens();

  for (const [prop, value] of Object.entries(raw)) {
    const group = classifyTokenName(prop);
    if (!group) continue;
    (tokens[group] as Record<string, Fact<string>>)[prop] = fact(value, THEME_CONFIDENCE, "code");
  }

  return { tokens, hasTheme, configPath };
}
