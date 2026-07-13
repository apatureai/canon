/**
 * DTCG 2025.10 Format-module alias/reference resolver (ui-dna#65).
 *
 * The stable Design Tokens Format Module 2025.10 requires a tool to RESOLVE
 * same-document aliases — curly-brace `{group.token}` references and RFC 6901
 * `$ref` JSON pointers — recursively (chained + property-level inside composite
 * values), with type-inheritance/compatibility checks, and to REPORT invalid,
 * unresolvable, circular, or type-mismatched references rather than serve the raw
 * reference syntax. Source of Truth preserves exactly what UI DNA approves, so an
 * unresolved `"{primitive.ink}"` must never be promoted as if it were a value.
 *
 * This module implements the required Format-module alias semantics. The Resolver
 * Module (sets/modifiers, `resolutionOrder`) and any filesystem/remote `$ref` are
 * OUT of scope here (same-document only; a sandboxed loader is a later slice).
 * Pure and deterministic: same document in → same result out; fail-closed on any
 * malformed/unresolved/circular/type-invalid reference.
 */

export type DtcgValue = string | number | boolean | null | DtcgValue[] | { [key: string]: DtcgValue };

export type ResolutionErrorKind =
  | "unresolved_reference"
  | "circular_reference"
  | "type_mismatch"
  | "malformed_reference";

export interface ResolvedToken {
  name: string;
  type: string | null;
  /** The fully-resolved value — composite structure PRESERVED, never stringified. */
  value: DtcgValue;
  /** The alias derivation chain: the ordered token names traversed, `[]` for a literal. */
  derivation: string[];
}

export interface ResolutionDiagnostic {
  name: string;
  kind: ResolutionErrorKind;
  detail: string;
}

export interface ResolveResult {
  resolved: ResolvedToken[];
  diagnostics: ResolutionDiagnostic[];
}

interface RawToken {
  name: string;
  raw: DtcgValue;
  type: string | null;
}

class ResolutionError extends Error {
  constructor(readonly kind: ResolutionErrorKind, message: string) {
    super(message);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** A whole-value curly-brace alias, e.g. `"{color.brand}"` → the path `color.brand`. */
function curlyAliasPath(value: DtcgValue): string | null {
  if (typeof value !== "string") return null;
  const m = /^\{([^{}]+)\}$/.exec(value.trim());
  return m ? m[1]!.trim() : null;
}

/** An RFC 6901 same-document `$ref`, e.g. `{ "$ref": "#/color/brand" }` → the dotted token name. */
function refPointerName(value: DtcgValue): string | null {
  if (!isRecord(value) || typeof value.$ref !== "string") return null;
  const ref = value.$ref;
  if (!ref.startsWith("#/")) throw new ResolutionError("malformed_reference", `only same-document '#/...' $ref is supported, got "${ref}"`);
  // RFC 6901: unescape ~1 -> '/', ~0 -> '~'; drop a trailing /$value segment.
  const segments = ref
    .slice(2)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  const trimmed = segments[segments.length - 1] === "$value" ? segments.slice(0, -1) : segments;
  return trimmed.join(".");
}

/** Walk the document collecting raw token nodes (value kept intact, `$type` inherited). */
function collectRawTokens(doc: unknown): Map<string, RawToken> {
  const tokens = new Map<string, RawToken>();
  const walk = (node: unknown, path: string[], inheritedType: string | null): void => {
    if (!isRecord(node)) return;
    const declaredType = typeof node.$type === "string" ? node.$type : inheritedType;
    const hasValue = "$value" in node || "value" in node;
    if (hasValue) {
      const raw = ("$value" in node ? node.$value : node.value) as DtcgValue;
      if (path.length > 0) tokens.set(path.join("."), { name: path.join("."), raw, type: declaredType });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      walk(child, [...path, key], declaredType);
    }
  };
  walk(doc, [], null);
  return tokens;
}

/**
 * Resolve every token's value against same-document aliases. Returns the resolved
 * tokens (value + derivation chain) and a diagnostic per token that could not be
 * resolved — a token with a diagnostic is never emitted as resolved (fail closed).
 */
export function resolveTokensJson(doc: unknown): ResolveResult {
  const raw = collectRawTokens(doc);
  const memo = new Map<string, ResolvedToken>();
  const resolved: ResolvedToken[] = [];
  const diagnostics: ResolutionDiagnostic[] = [];

  /** Resolve token `name`, tracking the active chain for cycle detection. */
  const resolveToken = (name: string, visiting: readonly string[]): ResolvedToken => {
    const cached = memo.get(name);
    if (cached !== undefined) return cached;
    if (visiting.includes(name)) {
      throw new ResolutionError("circular_reference", `circular reference: ${[...visiting, name].join(" -> ")}`);
    }
    const token = raw.get(name);
    if (token === undefined) throw new ResolutionError("unresolved_reference", `unresolved reference to "${name}"`);

    const nextVisiting = [...visiting, name];
    const { value, type, derivation } = resolveValue(token.raw, token.type, nextVisiting);
    const out: ResolvedToken = { name, type: type ?? token.type, value, derivation };
    memo.set(name, out);
    return out;
  };

  /** Resolve one value: a whole-value alias, a `$ref`, or a composite of properties. */
  const resolveValue = (
    value: DtcgValue,
    expectedType: string | null,
    visiting: readonly string[],
  ): { value: DtcgValue; type: string | null; derivation: string[] } => {
    const aliasName = curlyAliasPath(value) ?? refPointerName(value);
    if (aliasName !== null) {
      const target = resolveToken(aliasName, visiting);
      if (expectedType !== null && target.type !== null && expectedType !== target.type) {
        throw new ResolutionError(
          "type_mismatch",
          `type mismatch: alias declares "${expectedType}" but "${aliasName}" is "${target.type}"`,
        );
      }
      return { value: target.value, type: target.type ?? expectedType, derivation: [aliasName, ...target.derivation] };
    }
    // Composite value: resolve each property; aliases may appear property-level.
    if (isRecord(value)) {
      const out: Record<string, DtcgValue> = {};
      const derivation: string[] = [];
      for (const [key, v] of Object.entries(value as Record<string, DtcgValue>)) {
        const r = resolveValue(v, null, visiting);
        out[key] = r.value;
        for (const d of r.derivation) if (!derivation.includes(d)) derivation.push(d);
      }
      return { value: out, type: expectedType, derivation };
    }
    if (Array.isArray(value)) {
      const parts = value.map((v) => resolveValue(v, null, visiting));
      const derivation: string[] = [];
      for (const p of parts) for (const d of p.derivation) if (!derivation.includes(d)) derivation.push(d);
      return { value: parts.map((p) => p.value), type: expectedType, derivation };
    }
    return { value, type: expectedType, derivation: [] };
  };

  for (const name of raw.keys()) {
    try {
      resolved.push(resolveToken(name, []));
    } catch (error) {
      if (error instanceof ResolutionError) {
        diagnostics.push({ name, kind: error.kind, detail: error.message });
      } else {
        throw error;
      }
    }
  }
  return { resolved, diagnostics };
}
