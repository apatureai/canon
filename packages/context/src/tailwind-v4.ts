import postcss, { type AtRule } from "postcss";
import type { TokenMap } from "./tokens.js";

/**
 * Tailwind v4 token extraction (PRD §6). v4 is CSS-first: design tokens are
 * declared as custom properties inside `@theme { ... }` blocks in CSS, and a
 * `@config "..."` directive can point back to a v3-style JS/TS config. This
 * parses the CSS with PostCSS, collects the `@theme` custom properties as
 * tokens, and surfaces any `@config` path so the caller can also resolve it via
 * the v3 resolveConfig path (#1).
 *
 * Ported from judgment-engine's proven `@engine/context` (LOOP.md reuse note):
 * pure (PostCSS only) — fully testable without a build step.
 */
export interface TailwindV4Result {
  tokens: TokenMap;
  /** Path from a `@config "..."` directive, if present (resolve via #1). */
  configPath: string | null;
}

export function extractTailwindV4(css: string): TailwindV4Result {
  const tokens: TokenMap = {};
  let configPath: string | null = null;
  const root = postcss.parse(css);

  root.walkAtRules((atRule: AtRule) => {
    if (atRule.name === "theme") {
      atRule.walkDecls((decl) => {
        if (decl.prop.startsWith("--")) tokens[decl.prop] = decl.value.trim();
      });
    } else if (atRule.name === "config") {
      const m = /["']([^"']+)["']/.exec(atRule.params);
      if (m?.[1]) configPath = m[1];
    }
  });

  return { tokens, configPath };
}
