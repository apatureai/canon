import type { DnaTokens, Fact } from "@uidna/schema";
import { fact } from "@uidna/schema";
import { emptyTokens } from "./token-groups.js";
import {
  resolveTailwindV3FromFile,
  resolveTailwindV3Tokens,
  type ConfigLoader,
} from "./tailwind.js";

/**
 * Map resolved Tailwind v3 tokens onto the canonical `DnaTokens` groups
 * (PRD §5), stamping each as a `Fact<string>` with provenance "config" — the
 * tokens come from the project's authored `tailwind.config`, a declared design
 * config (stronger than ad-hoc CSS vars), so confidence sits with tokens.json.
 *
 * Tailwind's resolved-theme category names map deterministically onto the
 * canonical groups (e.g. `colors.*` -> color, `screens.*` -> breakpoints), which
 * is more precise than name-prefix guessing. Tokens are keyed by their dotted
 * Tailwind name (e.g. `colors.brand`).
 */
const CONFIG_CONFIDENCE = 0.8;

/** Tailwind resolved-theme category (the dotted-name's first segment) -> canonical group. */
const CATEGORY_TO_GROUP: Record<string, keyof DnaTokens> = {
  colors: "color",
  spacing: "spacing",
  fontSize: "typography",
  fontFamily: "typography",
  fontWeight: "typography",
  lineHeight: "typography",
  borderRadius: "radii",
  boxShadow: "shadows",
  screens: "breakpoints",
};

function toDnaTokens(tokenMap: Record<string, string>): DnaTokens {
  const tokens = emptyTokens();
  for (const [name, value] of Object.entries(tokenMap)) {
    const category = name.split(".")[0] ?? "";
    const group = CATEGORY_TO_GROUP[category];
    if (!group) continue;
    (tokens[group] as Record<string, Fact<string>>)[name] = fact(value, CONFIG_CONFIDENCE, "config");
  }
  return tokens;
}

/**
 * Map a Tailwind v3 config OBJECT onto canonical DNA tokens. Returns empty
 * tokens when the config can't be resolved. Deterministic.
 */
export function extractTailwindV3Tokens(userConfig: unknown): DnaTokens {
  const tokenMap = resolveTailwindV3Tokens(userConfig);
  return tokenMap ? toDnaTokens(tokenMap) : emptyTokens();
}

/**
 * Map a Tailwind v3 config FILE onto canonical DNA tokens via an injected
 * `ConfigLoader` (production: sandboxed worker; tests: a stub — never executes
 * real config). Returns empty tokens when the loader/resolve fails.
 */
export async function extractTailwindV3TokensFromFile(
  path: string,
  loader: ConfigLoader,
): Promise<DnaTokens> {
  const tokenMap = await resolveTailwindV3FromFile(path, loader);
  return tokenMap ? toDnaTokens(tokenMap) : emptyTokens();
}
