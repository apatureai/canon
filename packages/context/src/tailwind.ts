import type { TokenMap } from "./tokens.js";

/**
 * Tailwind v3 token extraction (PRD §6). When Tailwind's legacy `resolveConfig`
 * helper is available, file-based extraction uses it. Under Tailwind v4, where
 * that helper is not exported, object extraction falls back to authored
 * theme/extend values and v4 CSS tokens come from `tailwind-v4.ts`.
 *
 * `tailwind.config.{js,ts}` is EXECUTABLE code, so loading it is isolated behind
 * a `ConfigLoader` seam (below): the production loader runs it in a sandboxed
 * worker (same isolation class as render capture), and tests inject a stub that
 * returns a plain config object — so **no untrusted code is ever executed in
 * tests**. The pure resolve + flatten is fully testable with a config object.
 *
 * Ported from judgment-engine's proven `@engine/context` (LOOP.md reuse note).
 */

const CATEGORIES = [
  "colors",
  "spacing",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "lineHeight",
  "borderRadius",
  "screens",
  "boxShadow",
] as const;

type TailwindConfig = {
  theme?: {
    extend?: Record<string, unknown>;
    [key: string]: unknown;
  };
};

type TailwindResolver = (config: unknown) => { theme: Record<string, unknown> };

const TAILWIND_RESOLVE_CONFIG = "tailwindcss/resolveConfig";

let resolveConfigPromise: Promise<TailwindResolver | null> | null = null;

async function loadResolveConfig(): Promise<TailwindResolver | null> {
  resolveConfigPromise ??= import(TAILWIND_RESOLVE_CONFIG)
    .then((mod: { default?: TailwindResolver }) => mod.default ?? null)
    .catch(() => null);
  return resolveConfigPromise;
}

function mergeTheme(userConfig: unknown): Record<string, unknown> | null {
  if (userConfig === null || typeof userConfig !== "object") return {};
  const theme = (userConfig as TailwindConfig).theme;
  if (theme === undefined) return {};
  if (theme === null || typeof theme !== "object") return null;

  const { extend, ...baseTheme } = theme;
  const merged: Record<string, unknown> = { ...baseTheme };
  if (extend && typeof extend === "object" && !Array.isArray(extend)) {
    for (const [key, value] of Object.entries(extend)) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        merged[key] &&
        typeof merged[key] === "object" &&
        !Array.isArray(merged[key])
      ) {
        merged[key] = { ...(merged[key] as Record<string, unknown>), ...value };
      } else {
        merged[key] = value;
      }
    }
  }
  return merged;
}

function flatten(prefix: string, value: unknown, out: TokenMap): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number") {
    out[prefix] = String(value);
    return;
  }
  if (Array.isArray(value)) {
    const strings = value.filter((v): v is string => typeof v === "string");
    // fontFamily -> join the stack; fontSize tuple [size, {...}] -> the size.
    if (strings.length > 0) out[prefix] = strings.length > 1 ? strings.join(", ") : (strings[0] as string);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      // Tailwind's DEFAULT key collapses onto the parent (e.g. borderRadius.DEFAULT).
      flatten(k === "DEFAULT" ? prefix : `${prefix}.${k}`, v, out);
    }
  }
}

/** Flatten a resolved Tailwind theme object into the shared TokenMap. */
export function extractTailwindTokens(theme: Record<string, unknown>): TokenMap {
  const out: TokenMap = {};
  for (const category of CATEGORIES) {
    if (theme[category] !== undefined) flatten(category, theme[category], out);
  }
  return out;
}

/**
 * Resolve a Tailwind v3 config OBJECT and extract its tokens. Tailwind v4 no
 * longer exposes the v3 `resolveConfig` helper, so this falls back to authored
 * theme/extend values when that helper is unavailable.
 */
export function resolveTailwindV3Tokens(userConfig: unknown): TokenMap | null {
  try {
    const theme = mergeTheme(userConfig);
    return theme ? extractTailwindTokens(theme) : null;
  } catch {
    return null;
  }
}

/**
 * Seam for loading an executable `tailwind.config.{js,ts}`. Production supplies a
 * worker-backed loader that imports the file in isolation; tests supply a stub
 * that returns a config object (or throws) so no real config is ever executed.
 */
export interface ConfigLoader {
  /** Load and evaluate the config at `path`, returning the exported config object. */
  load(path: string): Promise<unknown>;
}

/**
 * Resolve Tailwind v3 tokens from a config FILE via an injected loader. Returns
 * null when the loader throws (untrusted config blew up / file missing) so the
 * caller degrades to CSS extraction. The loader is the only place untrusted code
 * runs; keeping it injected is what makes this testable without a sandbox.
 */
export async function resolveTailwindV3FromFile(
  path: string,
  loader: ConfigLoader,
): Promise<TokenMap | null> {
  let config: unknown;
  try {
    config = await loader.load(path);
  } catch {
    return null; // load failed (bad config / missing file) -> degrade
  }
  const resolver = await loadResolveConfig();
  if (resolver) {
    try {
      return extractTailwindTokens(resolver(config).theme);
    } catch {
      return null;
    }
  }
  return resolveTailwindV3Tokens(config);
}
