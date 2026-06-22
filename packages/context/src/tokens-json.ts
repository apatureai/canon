import type { TokenMap } from "./tokens.js";

/**
 * Parse a `tokens.json` in W3C Design Tokens or Style Dictionary format into the
 * shared `TokenMap` (PRD §5). Both formats are nested token groups; a node is a
 * token when it carries a value field:
 *   - W3C / Style Dictionary v4: `$value` (and `$type` metadata).
 *   - Style Dictionary (classic): `value`.
 * `$`-prefixed keys are metadata and are not traversed as groups.
 *
 * Ported from judgment-engine's proven `@engine/context` tokens-json parser
 * (LOOP.md reuse note): pure, deterministic, no IO. `parseTokensJson` keeps the
 * flat-map contract Gate already relies on; `parseTokensJsonTyped` additionally
 * surfaces each token's W3C `$type`, which UI DNA uses to classify accurately.
 */

function valueToString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Composite tokens (shadow/typography/etc.) serialize deterministically.
  if (value && typeof value === "object") return JSON.stringify(value);
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** A parsed token with its dotted name, string value, and W3C `$type` when declared. */
export interface ParsedToken {
  name: string;
  value: string;
  /** W3C `$type` (e.g. "color", "dimension", "shadow"), inherited from the nearest ancestor group; null if undeclared. */
  type: string | null;
}

/**
 * Parse a parsed-JSON tokens document into the list of tokens it declares, each
 * carrying its `$type`. W3C allows a group to declare a `$type` that its child
 * tokens inherit, so we thread the nearest declared type down the walk.
 */
export function parseTokensJsonTyped(doc: unknown): ParsedToken[] {
  const out: ParsedToken[] = [];

  const walk = (node: unknown, path: string[], inheritedType: string | null): void => {
    if (!isRecord(node)) return;

    const declaredType = typeof node.$type === "string" ? node.$type : inheritedType;

    // A token node carries `$value` (W3C) or `value` (classic Style Dictionary).
    const raw = "$value" in node ? node.$value : "value" in node ? node.value : undefined;
    if (raw !== undefined) {
      const str = valueToString(raw);
      if (str !== null && path.length > 0) {
        out.push({ name: path.join("."), value: str, type: declaredType });
      }
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue; // metadata, not a group
      walk(child, [...path, key], declaredType);
    }
  };

  walk(doc, [], null);
  return out;
}

/** Parse a parsed-JSON tokens document into a flat dotted-name TokenMap. */
export function parseTokensJson(doc: unknown): TokenMap {
  const out: TokenMap = {};
  for (const { name, value } of parseTokensJsonTyped(doc)) out[name] = value;
  return out;
}
