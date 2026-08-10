import { validateSnapshot, emptyDraft } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import { extractCssTokens } from "../src/index.js";

describe("extractCssTokens", () => {
  it("classifies base custom properties into canonical token groups", () => {
    const tokens = extractCssTokens(`
      :root {
        --color-bg: #ffffff;
        --font-sans: Inter, sans-serif;
        --space-4: 16px;
        --radius-md: 8px;
        --shadow-sm: 0 1px 2px rgba(0,0,0,0.1);
        --breakpoint-md: 768px;
        --duration-fast: 150ms;
      }
    `);
    expect(tokens.color["--color-bg"]?.value).toBe("#ffffff");
    expect(tokens.typography["--font-sans"]?.value).toBe("Inter, sans-serif");
    expect(tokens.spacing["--space-4"]?.value).toBe("16px");
    expect(tokens.radii["--radius-md"]?.value).toBe("8px");
    expect(tokens.shadows["--shadow-sm"]?.value).toBe("0 1px 2px rgba(0,0,0,0.1)");
    expect(tokens.breakpoints["--breakpoint-md"]?.value).toBe("768px");
    expect(tokens.motion["--duration-fast"]?.value).toBe("150ms");
  });

  it("stamps every token as a code-provenance fact with sub-1 confidence", () => {
    const tokens = extractCssTokens(`:root { --color-primary: #0a0a0a; }`);
    const f = tokens.color["--color-primary"];
    expect(f?.provenance).toBe("code");
    expect(f?.confidence).toBeGreaterThan(0);
    expect(f?.confidence).toBeLessThan(1);
  });

  it("keys theme-scoped tokens by <theme>:--name so they don't clobber base", () => {
    const tokens = extractCssTokens(`
      :root { --color-bg: #ffffff; }
      [data-theme="dark"] { --color-bg: #000000; }
    `);
    expect(tokens.color["--color-bg"]?.value).toBe("#ffffff");
    expect(tokens.color["dark:--color-bg"]?.value).toBe("#000000");
  });

  it("drops unclassifiable tokens rather than guessing a group", () => {
    const tokens = extractCssTokens(`:root { --z-index-modal: 50; --colorize: nope; }`);
    expect(Object.keys(tokens.color)).toHaveLength(0);
    expect(Object.keys(tokens.spacing)).toHaveLength(0);
  });

  it("produces facts that pass schema validation when merged into a draft", () => {
    const draft = emptyDraft("apatureai", "canon", "test");
    draft.tokens = extractCssTokens(`:root { --color-bg: #fff; --space-2: 8px; }`);
    expect(validateSnapshot(draft)).toEqual({ ok: true });
  });

  it("is deterministic: same CSS in -> same tokens out", () => {
    const css = `:root { --color-bg: #fff; --space-1: 4px; }`;
    expect(extractCssTokens(css)).toEqual(extractCssTokens(css));
  });
});
