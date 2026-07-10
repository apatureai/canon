import resolveConfig from "tailwindcss-v3/resolveConfig";
import type { TokenMap } from "./tokens.js";

/**
 * Tailwind v3 token extraction (PRD §6). The v3 `resolveConfig` helper is kept
 * behind an npm alias while the primary Tailwind dependency tracks v4. This
 * preserves defaults, presets, and theme functions for v3 configs; v4 CSS
 * tokens continue to come from `tailwind-v4.ts`.
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
 * Resolve a Tailwind v3 config OBJECT and extract its complete theme.
 */
export function resolveTailwindV3Tokens(userConfig: unknown): TokenMap | null {
  try {
    return extractTailwindTokens(resolveConfig(userConfig).theme);
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
  return resolveTailwindV3Tokens(config);
}
