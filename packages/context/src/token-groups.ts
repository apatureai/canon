import type { DnaTokens } from "@uidna/schema";

/**
 * Shared classification of an extracted token onto the canonical `DnaTokens`
 * groups (PRD §5). Every static extractor (CSS custom properties, tokens.json,
 * Tailwind) normalizes onto these groups so the genome is consistent regardless
 * of source. Group is inferred from the token's name; unclassifiable tokens are
 * dropped from the typed groups rather than guessed.
 */

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

/** Strip a leading `--` (CSS var), lowercase, for prefix matching. */
function normalizeName(name: string): string {
  return name.replace(/^--/, "").toLowerCase();
}

/**
 * Classify a token by its name onto a canonical group, or `null` if no prefix
 * matches. Matches at a token boundary so `color-bg`/`color` hit `color` but
 * `colorize` does not. Works on CSS var names (`--color-bg`) and dotted
 * tokens.json paths (`color.brand.primary`) alike — the first path segment is
 * what carries the group intent.
 */
export function classifyTokenName(name: string): keyof DnaTokens | null {
  const normalized = normalizeName(name);
  // For dotted paths, the leading segment carries the group; for CSS vars the
  // whole hyphenated name does. Test both the full name and its first segment.
  const candidates = [normalized, normalized.split(".")[0] ?? normalized];
  for (const candidate of candidates) {
    for (const [group, prefixes] of GROUP_PREFIXES) {
      for (const prefix of prefixes) {
        if (candidate === prefix || candidate.startsWith(`${prefix}-`)) return group;
      }
    }
  }
  return null;
}

/** A fresh, empty `DnaTokens` with every canonical group present. */
export function emptyTokens(): DnaTokens {
  return { color: {}, typography: {}, spacing: {}, radii: {}, shadows: {}, breakpoints: {}, motion: {} };
}
