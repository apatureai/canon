import type { TokenMap } from "./tokens.js";

/** The exact JSON value retained by the DTCG resolver before consumer projection. */
export type TokenJsonValue =
  | null
  | boolean
  | number
  | string
  | TokenJsonValue[]
  | { [key: string]: TokenJsonValue };

export const DTCG_2025_10_PROFILE = Object.freeze({
  formatModule: "2025.10",
  aliases: true,
  jsonPointer: "same-document-only",
  groupExtends: true,
  resolverSetsAndModifiers: false,
  externalSources: false,
} as const);

export type TokenDiagnosticCode =
  | "invalid_document"
  | "invalid_structure"
  | "invalid_reference"
  | "unresolved_reference"
  | "circular_reference"
  | "type_mismatch"
  | "invalid_value"
  | "missing_type"
  | "unsupported_external_reference"
  | "unsupported_resolver_module"
  | "resource_limit";

export interface TokenDiagnostic {
  code: TokenDiagnosticCode;
  path: string;
  message: string;
}

export interface TokenDerivationStep {
  kind: "curly_alias" | "json_pointer" | "group_extend";
  from: string;
  to: string;
}

/** A resolved token retains its typed JSON value and the alias/extension trail. */
export interface ParsedToken {
  name: string;
  value: TokenJsonValue;
  /** Null only for the retained classic Style Dictionary compatibility path. */
  type: string | null;
  derivation: TokenDerivationStep[];
}

export interface TokensJsonResolution {
  profile: typeof DTCG_2025_10_PROFILE;
  tokens: ParsedToken[];
  diagnostics: TokenDiagnostic[];
}

export interface TokensJsonResolutionOptions {
  /** Bounded to keep hostile token files from expanding without limit. */
  maxTokens?: number;
  /** Bounds alias, pointer, and group-extension chains. */
  maxDepth?: number;
  /** Bounds the parsed document before resolution. */
  maxInputNodes?: number;
  /** Bounds expanded output when many aliases target a large composite. */
  maxResolvedValueNodes?: number;
}

interface RawToken {
  name: string;
  rawValue: unknown;
  declaredType: string | null;
  inheritedType: string | null;
  legacyStyleDictionary: boolean;
  groupDerivation: TokenDerivationStep[];
}

interface ResolveContext {
  doc: Record<string, unknown>;
  maxDepth: number;
  diagnostics: TokenDiagnostic[];
  rawTokens: Map<string, RawToken>;
  resolvedTokens: Map<string, ParsedToken>;
  maxResolvedValueNodes: number;
  resolvedValueNodes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isJsonValue(value: unknown): value is TokenJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function countNodes(value: unknown, ceiling: number): number {
  const stack: unknown[] = [value];
  const seen = new WeakSet<object>();
  let count = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    count += 1;
    if (count > ceiling) return count;
    if (current !== null && typeof current === "object") {
      if (seen.has(current)) return ceiling + 1;
      seen.add(current);
      stack.push(...(Array.isArray(current) ? current : Object.values(current)));
    }
  }
  return count;
}

function stableJson(value: TokenJsonValue): TokenJsonValue {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([key, child]) => [key, stableJson(child as TokenJsonValue)]),
  );
}

/** Named lossy projection used only by string-valued legacy/DNA consumers. */
export function projectTokenValue(value: TokenJsonValue, type: string | null = null): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isRecord(value)) {
    if (type === "color" && typeof value.hex === "string") return value.hex;
    if ((type === "dimension" || type === "duration") && typeof value.value === "number" && typeof value.unit === "string") {
      return `${value.value}${value.unit}`;
    }
  }
  return JSON.stringify(stableJson(value));
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateResolvedValue(type: string, value: TokenJsonValue): string | null {
  switch (type) {
    case "color":
      if (!isRecord(value) || typeof value.colorSpace !== "string" || !Array.isArray(value.components) || value.components.length !== 3) {
        return "A color must contain colorSpace and exactly three components.";
      }
      if (!value.components.every((item) => finiteNumber(item) || item === "none")) return "Color components must be finite numbers or 'none'.";
      if (value.alpha !== undefined && (!finiteNumber(value.alpha) || value.alpha < 0 || value.alpha > 1)) return "Color alpha must be between 0 and 1.";
      return null;
    case "dimension":
    case "duration":
      if (!isRecord(value) || !finiteNumber(value.value) || typeof value.unit !== "string" || value.unit.length === 0) {
        return `A ${type} must contain a finite numeric value and unit.`;
      }
      return null;
    case "fontFamily":
      return typeof value === "string" || (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string"))
        ? null
        : "A fontFamily must be a string or non-empty string array.";
    case "fontWeight":
      return typeof value === "string" || finiteNumber(value) ? null : "A fontWeight must be a string or finite number.";
    case "cubicBezier":
      return Array.isArray(value) && value.length === 4 && value.every(finiteNumber)
        ? null
        : "A cubicBezier must contain exactly four finite numbers.";
    case "number":
      return finiteNumber(value) ? null : "A number token must be finite.";
    case "strokeStyle":
      return typeof value === "string" || isRecord(value) ? null : "A strokeStyle must be a string or object.";
    case "border":
    case "transition":
    case "typography":
      return isRecord(value) ? null : `A ${type} token must be an object.`;
    case "shadow":
      return isRecord(value) || (Array.isArray(value) && value.length > 0 && value.every(isRecord))
        ? null
        : "A shadow token must be an object or non-empty object array.";
    case "gradient":
      return Array.isArray(value) && value.length > 0 && value.every(isRecord)
        ? null
        : "A gradient token must be a non-empty object array.";
    default:
      // DTCG permits tools to carry extension types. Reference compatibility is
      // still enforced; an owning consumer decides how to project the value.
      return null;
  }
}

function diagnostic(
  ctx: Pick<ResolveContext, "diagnostics">,
  code: TokenDiagnosticCode,
  path: string,
  message: string,
): void {
  ctx.diagnostics.push({ code, path, message });
}

function decodePointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function pointerSegments(reference: string): string[] | null {
  if (reference === "#") return [];
  if (!reference.startsWith("#/")) return null;
  return reference.slice(2).split("/").map(decodePointerSegment);
}

function getAtPath(root: unknown, segments: readonly string[]): unknown {
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined;
      current = current[Number(segment)];
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function referenceToSegments(reference: string): string[] | null {
  const curly = /^\{([^{}]+)\}$/.exec(reference);
  if (curly) return curly[1]!.split(".");
  return pointerSegments(reference);
}

function deepMerge(base: unknown, local: unknown): unknown {
  if (!isRecord(base) || !isRecord(local)) return local;
  if ("$value" in base || "value" in base || "$value" in local || "value" in local) return local;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(local)) {
    if (key === "$extends" || key === "$ref") continue;
    result[key] = isRecord(result[key]) && isRecord(value) ? deepMerge(result[key], value) : value;
  }
  return result;
}

function resolveGroups(
  root: Record<string, unknown>,
  maxDepth: number,
  diagnostics: TokenDiagnostic[],
): { doc: Record<string, unknown>; derivations: Map<string, TokenDerivationStep[]> } {
  const memo = new Map<string, Record<string, unknown>>();
  const derivations = new Map<string, TokenDerivationStep[]>();
  const invalidGroups = new Set<string>();

  const resolveGroup = (
    path: string[],
    node: Record<string, unknown>,
    stack: string[],
    depth = 0,
  ): Record<string, unknown> => {
    const name = path.join(".");
    const cached = memo.get(name);
    if (cached) return cached;
    if (depth >= maxDepth || stack.length >= maxDepth) {
      diagnostics.push({ code: "resource_limit", path: name, message: `Group resolution exceeds maxDepth ${maxDepth}.` });
      invalidGroups.add(name);
      return {};
    }
    if (stack.includes(name)) {
      diagnostics.push({ code: "circular_reference", path: name, message: `Circular group extension: ${[...stack, name].join(" -> ")}.` });
      for (const group of [...stack, name]) invalidGroups.add(group);
      return {};
    }

    const reference = typeof node.$extends === "string"
      ? node.$extends
      : typeof node.$ref === "string" && !("$value" in node)
        ? node.$ref
        : null;
    let merged: Record<string, unknown> = { ...node };
    if (reference) {
      const targetSegments = referenceToSegments(reference);
      if (!targetSegments) {
        diagnostics.push({ code: "unsupported_external_reference", path: name, message: `Only same-document group references are supported: ${reference}.` });
        invalidGroups.add(name);
        merged = {};
      } else {
        const target = getAtPath(root, targetSegments);
        const targetName = targetSegments.join(".");
        if (!isRecord(target) || "$value" in target || "value" in target) {
          diagnostics.push({ code: "invalid_reference", path: name, message: `Group extension target is not a group: ${reference}.` });
          invalidGroups.add(name);
          merged = {};
        } else {
          const resolvedTarget = resolveGroup(targetSegments, target, [...stack, name], depth + 1);
          if (invalidGroups.has(targetName)) {
            invalidGroups.add(name);
            merged = {};
          } else {
            merged = deepMerge(resolvedTarget, node) as Record<string, unknown>;
            derivations.set(name, [
              ...(derivations.get(targetName) ?? []),
              { kind: "group_extend", from: name, to: targetName },
            ]);
          }
        }
      }
    }

    if (invalidGroups.has(name)) merged = {};

    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(merged)) {
      if ((key === "$extends" || key === "$ref") && reference) continue;
      if (!key.startsWith("$") && isRecord(child) && !("$value" in child) && !("value" in child)) {
        output[key] = resolveGroup([...path, key], child, stack, depth + 1);
      } else {
        output[key] = child;
      }
    }
    memo.set(name, output);
    return output;
  };

  const doc = resolveGroup([], root, []);
  return { doc, derivations };
}

function collectRawTokens(
  ctx: ResolveContext,
  node: unknown,
  path: string[],
  inheritedType: string | null,
  groupDerivations: Map<string, TokenDerivationStep[]>,
): void {
  if (!isRecord(node)) return;
  const declaredGroupType = typeof node.$type === "string" ? node.$type : inheritedType;
  const rawValue = "$value" in node ? node.$value : "value" in node ? node.value : undefined;
  if (rawValue !== undefined) {
    const name = path.join(".");
    if ("$value" in node && path.some((segment) => segment !== "$root" && (segment.startsWith("$") || /[.{}]/.test(segment)))) {
      diagnostic(ctx, "invalid_structure", name, "DTCG token and group names cannot start with '$' or contain '.', '{', or '}'.");
      return;
    }
    const childKeys = Object.keys(node).filter((key) => !key.startsWith("$") && key !== "value");
    if (childKeys.length > 0) {
      diagnostic(ctx, "invalid_structure", name, "A token cannot also contain child tokens or groups.");
      return;
    }
    let nearest: TokenDerivationStep[] = [];
    for (let size = path.length - 1; size >= 0; size -= 1) {
      const found = groupDerivations.get(path.slice(0, size).join("."));
      if (found) { nearest = found; break; }
    }
    ctx.rawTokens.set(name, {
      name,
      rawValue,
      declaredType: typeof node.$type === "string" ? node.$type : null,
      inheritedType: declaredGroupType,
      legacyStyleDictionary: !("$value" in node) && "value" in node,
      groupDerivation: nearest,
    });
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$") && key !== "$root") continue;
    collectRawTokens(ctx, child, [...path, key], declaredGroupType, groupDerivations);
  }
}

function rawTokenAtPointer(ctx: ResolveContext, reference: string): RawToken | null {
  const segments = pointerSegments(reference);
  if (!segments) return null;
  const valueIndex = segments.findIndex((segment) => segment === "$value" || segment === "value");
  const tokenSegments = valueIndex >= 0 ? segments.slice(0, valueIndex) : segments;
  return ctx.rawTokens.get(tokenSegments.join(".")) ?? null;
}

function resolvePointerValue(
  ctx: ResolveContext,
  reference: string,
  path: string,
  tokenStack: string[],
  pointerStack: string[],
  valueDepth: number,
): { value: TokenJsonValue; derivation: TokenDerivationStep[]; referencedType: string | null } | null {
  const segments = pointerSegments(reference);
  if (!segments) {
    diagnostic(ctx, reference.includes(":") || !reference.startsWith("#") ? "unsupported_external_reference" : "invalid_reference", path, `Only RFC 6901 same-document references are supported: ${reference}.`);
    return null;
  }
  if (pointerStack.length >= ctx.maxDepth || pointerStack.includes(reference)) {
    diagnostic(ctx, pointerStack.includes(reference) ? "circular_reference" : "resource_limit", path, `Invalid JSON Pointer chain: ${[...pointerStack, reference].join(" -> ")}.`);
    return null;
  }

  const referencedToken = rawTokenAtPointer(ctx, reference);
  if (referencedToken) {
    const resolved = resolveToken(ctx, referencedToken.name, tokenStack);
    if (!resolved) return null;
    const valueIndex = segments.findIndex((segment) => segment === "$value" || segment === "value");
    const suffix = valueIndex >= 0 ? segments.slice(valueIndex + 1) : [];
    const selected = getAtPath(resolved.value, suffix);
    if (!isJsonValue(selected)) {
      diagnostic(ctx, "unresolved_reference", path, `JSON Pointer does not resolve to a JSON value: ${reference}.`);
      return null;
    }
    return {
      value: stableJson(selected),
      derivation: [...resolved.derivation, { kind: "json_pointer", from: path, to: reference }],
      referencedType: suffix.length === 0 ? resolved.type : null,
    };
  }

  const target = getAtPath(ctx.doc, segments);
  if (!isJsonValue(target)) {
    diagnostic(ctx, "unresolved_reference", path, `JSON Pointer does not resolve: ${reference}.`);
    return null;
  }
  const resolved = resolveValue(ctx, target, path, tokenStack, [...pointerStack, reference], valueDepth + 1);
  return resolved ? {
    ...resolved,
    derivation: [...resolved.derivation, { kind: "json_pointer", from: path, to: reference }],
  } : null;
}

function resolveValue(
  ctx: ResolveContext,
  value: unknown,
  path: string,
  tokenStack: string[],
  pointerStack: string[] = [],
  valueDepth = 0,
): { value: TokenJsonValue; derivation: TokenDerivationStep[]; referencedType: string | null } | null {
  if (valueDepth >= ctx.maxDepth) {
    diagnostic(ctx, "resource_limit", path, `Token value nesting exceeds maxDepth ${ctx.maxDepth}.`);
    return null;
  }
  if (typeof value === "string") {
    const alias = /^\{([^{}]+)\}$/.exec(value);
    if (!alias) return { value, derivation: [], referencedType: null };
    const targetName = alias[1]!;
    const target = resolveToken(ctx, targetName, tokenStack);
    if (!target) {
      if (!ctx.rawTokens.has(targetName)) diagnostic(ctx, "unresolved_reference", path, `Token alias does not resolve: ${value}.`);
      return null;
    }
    return {
      value: target.value,
      derivation: [...target.derivation, { kind: "curly_alias", from: path, to: targetName }],
      referencedType: target.type,
    };
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return { value, derivation: [], referencedType: null };
  }
  if (Array.isArray(value)) {
    const out: TokenJsonValue[] = [];
    const derivation: TokenDerivationStep[] = [];
    for (const [index, child] of value.entries()) {
      const resolved = resolveValue(ctx, child, `${path}/${index}`, tokenStack, pointerStack, valueDepth + 1);
      if (!resolved) return null;
      out.push(resolved.value);
      derivation.push(...resolved.derivation);
    }
    return { value: out, derivation, referencedType: null };
  }
  if (!isRecord(value)) {
    diagnostic(ctx, "invalid_structure", path, "Token value is not valid JSON.");
    return null;
  }
  if (typeof value.$ref === "string") {
    const resolved = resolvePointerValue(ctx, value.$ref, path, tokenStack, pointerStack, valueDepth);
    if (!resolved) return null;
    const local = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$ref"));
    if (Object.keys(local).length === 0) return resolved;
    if (!isRecord(resolved.value)) {
      diagnostic(ctx, "invalid_reference", path, "A JSON Pointer with sibling overrides must resolve to an object.");
      return null;
    }
    const projected: Record<string, TokenJsonValue> = { ...resolved.value };
    const derivation = [...resolved.derivation];
    for (const [key, child] of Object.entries(local)) {
      const localValue = resolveValue(ctx, child, `${path}/${key}`, tokenStack, pointerStack, valueDepth + 1);
      if (!localValue) return null;
      projected[key] = localValue.value;
      derivation.push(...localValue.derivation);
    }
    return { value: stableJson(projected), derivation, referencedType: resolved.referencedType };
  }
  const out: Record<string, TokenJsonValue> = {};
  const derivation: TokenDerivationStep[] = [];
  for (const [key, child] of Object.entries(value).sort(([a], [b]) => compareStrings(a, b))) {
    const resolved = resolveValue(ctx, child, `${path}/${key}`, tokenStack, pointerStack, valueDepth + 1);
    if (!resolved) return null;
    out[key] = resolved.value;
    derivation.push(...resolved.derivation);
  }
  return { value: out, derivation, referencedType: null };
}

function resolveToken(ctx: ResolveContext, name: string, stack: string[]): ParsedToken | null {
  const cached = ctx.resolvedTokens.get(name);
  if (cached) return cached;
  const raw = ctx.rawTokens.get(name);
  if (!raw) return null;
  if (stack.length >= ctx.maxDepth) {
    diagnostic(ctx, "resource_limit", name, `Token resolution exceeds maxDepth ${ctx.maxDepth}.`);
    return null;
  }
  if (stack.includes(name)) {
    diagnostic(ctx, "circular_reference", name, `Circular token alias: ${[...stack, name].join(" -> ")}.`);
    return null;
  }
  const resolved = resolveValue(ctx, raw.rawValue, name, [...stack, name]);
  if (!resolved) return null;
  const declared = raw.declaredType ?? raw.inheritedType;
  if (declared && resolved.referencedType && declared !== resolved.referencedType) {
    diagnostic(ctx, "type_mismatch", name, `Declared type ${declared} does not match referenced type ${resolved.referencedType}.`);
    return null;
  }
  const type = declared ?? resolved.referencedType;
  if (!type && !raw.legacyStyleDictionary) {
    diagnostic(ctx, "missing_type", name, "DTCG 2025.10 requires a declared, inherited, or referenced token type.");
    return null;
  }
  if (type && !raw.legacyStyleDictionary) {
    const invalid = validateResolvedValue(type, resolved.value);
    if (invalid) {
      diagnostic(ctx, "invalid_value", name, invalid);
      return null;
    }
  }
  const remainingNodes = ctx.maxResolvedValueNodes - ctx.resolvedValueNodes;
  const resolvedNodes = countNodes(resolved.value, remainingNodes);
  if (resolvedNodes > remainingNodes) {
    diagnostic(ctx, "resource_limit", name, `Resolved values exceed maxResolvedValueNodes ${ctx.maxResolvedValueNodes}.`);
    return null;
  }
  ctx.resolvedValueNodes += resolvedNodes;
  const token: ParsedToken = {
    name,
    value: stableJson(resolved.value),
    type,
    derivation: [...raw.groupDerivation, ...resolved.derivation],
  };
  ctx.resolvedTokens.set(name, token);
  return token;
}

/**
 * Resolve a Design Tokens Format Module 2025.10 document. Resolver Module
 * sets/modifiers and external source loading are deliberately disabled; callers
 * receive explicit diagnostics instead of raw reference syntax promoted as fact.
 */
export function resolveTokensJson(
  input: unknown,
  options: TokensJsonResolutionOptions = {},
): TokensJsonResolution {
  const diagnostics: TokenDiagnostic[] = [];
  if (!isRecord(input)) {
    return {
      profile: DTCG_2025_10_PROFILE,
      tokens: [],
      diagnostics: [{ code: "invalid_document", path: "", message: "A token document must be a JSON object." }],
    };
  }
  if ("sets" in input || "modifiers" in input || "resolutionOrder" in input) {
    return {
      profile: DTCG_2025_10_PROFILE,
      tokens: [],
      diagnostics: [{
        code: "unsupported_resolver_module",
        path: "",
        message: "Resolver Module sets/modifiers are not enabled; only same-document Format Module references are supported.",
      }],
    };
  }
  const maxTokens = options.maxTokens ?? 10_000;
  const maxDepth = options.maxDepth ?? 64;
  const maxInputNodes = options.maxInputNodes ?? 100_000;
  const maxResolvedValueNodes = options.maxResolvedValueNodes ?? 200_000;
  if (countNodes(input, maxInputNodes) > maxInputNodes) {
    return {
      profile: DTCG_2025_10_PROFILE,
      tokens: [],
      diagnostics: [{ code: "resource_limit", path: "", message: `Input exceeds maxInputNodes ${maxInputNodes}.` }],
    };
  }
  const groupResult = resolveGroups(input, maxDepth, diagnostics);
  const ctx: ResolveContext = {
    doc: groupResult.doc,
    maxDepth,
    diagnostics,
    rawTokens: new Map(),
    resolvedTokens: new Map(),
    maxResolvedValueNodes,
    resolvedValueNodes: 0,
  };
  collectRawTokens(ctx, ctx.doc, [], null, groupResult.derivations);
  if (ctx.rawTokens.size > maxTokens) {
    diagnostics.push({ code: "resource_limit", path: "", message: `Token count ${ctx.rawTokens.size} exceeds maxTokens ${maxTokens}.` });
    return { profile: DTCG_2025_10_PROFILE, tokens: [], diagnostics };
  }
  const tokens = [...ctx.rawTokens.keys()]
    .sort(compareStrings)
    .flatMap((name) => {
      const token = resolveToken(ctx, name, []);
      return token ? [token] : [];
    });
  const uniqueDiagnostics = [...new Map(diagnostics.map((item) => [
    `${item.path}\u0000${item.code}\u0000${item.message}`,
    item,
  ])).values()];
  uniqueDiagnostics.sort((a, b) => compareStrings(a.path, b.path) || compareStrings(a.code, b.code) || compareStrings(a.message, b.message));
  return { profile: DTCG_2025_10_PROFILE, tokens, diagnostics: uniqueDiagnostics };
}

/** Back-compatible name for resolved typed tokens; invalid tokens are omitted. */
export function parseTokensJsonTyped(doc: unknown): ParsedToken[] {
  return resolveTokensJson(doc).tokens;
}

/** Legacy string map projection. Structured values remain exact until this named boundary. */
export function parseTokensJson(doc: unknown): TokenMap {
  return Object.fromEntries(
    resolveTokensJson(doc).tokens.map((token) => [token.name, projectTokenValue(token.value, token.type)]),
  );
}
