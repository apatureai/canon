/**
 * Shared design-token model. Every static extractor (CSS custom properties,
 * Tailwind, tokens.json) normalizes into a flat `TokenMap` of name -> string
 * value before it is classified into the canonical `DnaTokens` groups and
 * stamped with confidence + provenance. Ported from verdict's proven
 * `@apatureai/verdict-context` so UI DNA owns the canonical genome.
 */
export type TokenMap = Record<string, string>;

/** A token source, highest precedence last (later sources override earlier). */
export interface TokenSource {
  /** Provenance label, e.g. "css-vars", "tailwind", "tokens.json". */
  source: string;
  tokens: TokenMap;
}

/**
 * Merge token sources in order; later sources win on key collisions. Keys are
 * returned sorted so the result is deterministic regardless of source order
 * within a precedence tier.
 */
export function mergeTokens(sources: TokenSource[]): TokenMap {
  const merged: TokenMap = {};
  for (const { tokens } of sources) {
    for (const [key, value] of Object.entries(tokens)) {
      merged[key] = value;
    }
  }
  return sortTokens(merged);
}

/** Return a new TokenMap with keys in sorted order (deterministic serialization). */
export function sortTokens(tokens: TokenMap): TokenMap {
  const out: TokenMap = {};
  for (const key of Object.keys(tokens).sort()) {
    out[key] = tokens[key] as string;
  }
  return out;
}
