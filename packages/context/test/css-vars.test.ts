import { describe, expect, it } from "vitest";
import { extractCssCustomProperties } from "../src/index.js";

describe("extractCssCustomProperties", () => {
  it("collects :root custom properties as base tokens", () => {
    const { base } = extractCssCustomProperties(`
      :root { --color-bg: #ffffff; --space-1: 4px; }
    `);
    expect(base).toEqual({ "--color-bg": "#ffffff", "--space-1": "4px" });
  });

  it("treats html the same as :root for base tokens", () => {
    const { base } = extractCssCustomProperties(`html { --color-bg: #fff; }`);
    expect(base).toEqual({ "--color-bg": "#fff" });
  });

  it("captures theme-scoped blocks: [data-theme], .dark, and prefers-color-scheme", () => {
    const result = extractCssCustomProperties(`
      :root { --color-bg: #ffffff; }
      [data-theme="dark"] { --color-bg: #000000; }
      @media (prefers-color-scheme: dark) { :root { --color-fg: #eeeeee; } }
      .dark { --accent: #8b5cf6; }
    `);
    expect(result.base).toEqual({ "--color-bg": "#ffffff" });
    expect(result.themes.dark).toEqual({
      "--color-bg": "#000000",
      "--color-fg": "#eeeeee",
      "--accent": "#8b5cf6",
    });
  });

  it("keys custom theme names from [data-theme=...]", () => {
    const result = extractCssCustomProperties(`[data-theme="brand"] { --color-primary: #ff0; }`);
    expect(result.themes.brand).toEqual({ "--color-primary": "#ff0" });
  });

  it("ignores component-scoped custom properties (not design tokens)", () => {
    const result = extractCssCustomProperties(`
      .button { --btn-x: 1px; }
      :root { --real: 2px; }
    `);
    expect(result.base).toEqual({ "--real": "2px" });
    expect(result.themes).toEqual({});
  });

  it("ignores theme tokens nested under a component selector (.dark .button)", () => {
    const result = extractCssCustomProperties(`
      .dark .button { --bg: #111; }
      .light .card { --bg: #fff; }
      :root { --real: 2px; }
    `);
    expect(result.base).toEqual({ "--real": "2px" });
    expect(result.themes).toEqual({});
  });

  it("ignores theme tokens on a compound theme+component selector (.dark.fancy)", () => {
    const result = extractCssCustomProperties(`.dark.fancy { --bg: #111; }`);
    expect(result.themes).toEqual({});
  });

  it("ignores component-scoped custom props inside a prefers-color-scheme media query", () => {
    const result = extractCssCustomProperties(`
      @media (prefers-color-scheme: dark) { .button { --bg: #111; } }
    `);
    expect(result.themes).toEqual({});
    expect(result.base).toEqual({});
  });

  it("still captures base-scoped .dark/:root and @media(...){ :root } (regression guard)", () => {
    const result = extractCssCustomProperties(`
      :root { --color-bg: #ffffff; }
      .dark { --accent: #8b5cf6; }
      @media (prefers-color-scheme: dark) { :root { --color-fg: #eeeeee; } }
    `);
    expect(result.base).toEqual({ "--color-bg": "#ffffff" });
    expect(result.themes.dark).toEqual({
      "--accent": "#8b5cf6",
      "--color-fg": "#eeeeee",
    });
  });

  it("is deterministic and trims values", () => {
    const css = `:root { --x:  10px ; }`;
    expect(extractCssCustomProperties(css)).toEqual(extractCssCustomProperties(css));
    expect(extractCssCustomProperties(css).base).toEqual({ "--x": "10px" });
  });
});
