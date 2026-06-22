import type { DnaTokens, Fact } from "@uidna/schema";
import { fact } from "@uidna/schema";
import { extractCssCustomProperties } from "./css-vars.js";

/**
 * Map extracted CSS custom properties onto the canonical `DnaTokens` groups
 * (PRD §5), stamping every value as a `Fact<string>` with provenance "code".
 *
 * The extractor reads code, not rendered pixels, so confidence is fixed below 1
 * (reserved for human-confirmed facts): the *name* of a `--color-*` var is a
 * strong signal of intent but still inferred until a human signs off. The group
 * a token lands in is inferred from its name prefix; unclassifiable tokens are
 * dropped from the typed groups (they are surfaced raw elsewhere, not guessed).
 */
const CODE_CONFIDENCE = 0.6;

/** Token-name prefixes that map onto each canonical group. Order: first match wins. */
const GROUP_PREFIXES: ReadonlyArray<readonly [keyof DnaTokens, readonly string[]]> = [
  ["color", ["color", "clr", "bg", "background", "fg", "foreground", "accent", "border", "ring", "muted", "primary", "secondary", "destructive", "popover", "card"]],
  ["typography", ["font", "text", "leading", "tracking", "line-height", "letter-spacing", "type"]],
  ["spacing", ["space", "spacing", "gap", "inset", "size"]],
  ["radii", ["radius", "rounded", "radii"]],
  ["shadows", ["shadow", "elevation"]],
  ["breakpoints", ["breakpoint", "screen", "bp"]],
  ["motion", ["motion", "duration", "ease", "easing", "transition", "animate", "animation"]],
];

/** Strip the leading `--` and any vendor-ish wrapper, lowercased, for prefix matching. */
function normalizeName(prop: string): string {
  return prop.replace(/^--/, "").toLowerCase();
}

function classify(prop: string): keyof DnaTokens | null {
  const name = normalizeName(prop);
  for (const [group, prefixes] of GROUP_PREFIXES) {
    for (const prefix of prefixes) {
      // match prefix at a token boundary: `color-bg`, `color`, but not `colorize`
      if (name === prefix || name.startsWith(`${prefix}-`)) return group;
    }
  }
  return null;
}

function emptyTokens(): DnaTokens {
  return { color: {}, typography: {}, spacing: {}, radii: {}, shadows: {}, breakpoints: {}, motion: {} };
}

/**
 * Extract CSS custom properties from a global stylesheet and classify them into
 * the canonical `DnaTokens` groups as provenance-stamped facts.
 *
 * Base (`:root`/`html`) tokens are keyed by their bare name (e.g. `--color-bg`).
 * Theme-scoped tokens are keyed `<theme>:--name` so a dark override does not
 * clobber the base fact; the reconciler (UD3) decides canonical theme later.
 * Deterministic: same CSS in → same `DnaTokens` out.
 */
export function extractCssTokens(css: string): DnaTokens {
  const { base, themes } = extractCssCustomProperties(css);
  const tokens = emptyTokens();

  const put = (key: string, prop: string, value: string): void => {
    const group = classify(prop);
    if (!group) return;
    (tokens[group] as Record<string, Fact<string>>)[key] = fact(value, CODE_CONFIDENCE, "code");
  };

  for (const [prop, value] of Object.entries(base)) put(prop, prop, value);
  for (const [theme, map] of Object.entries(themes)) {
    for (const [prop, value] of Object.entries(map)) put(`${theme}:${prop}`, prop, value);
  }

  return tokens;
}
