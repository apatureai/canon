import { describe, expect, it } from "vitest";
import { extractTailwindV4 } from "../src/index.js";

describe("extractTailwindV4", () => {
  it("collects @theme custom properties as tokens", () => {
    const result = extractTailwindV4(`
      @import "tailwindcss";
      @theme {
        --color-brand: #bada55;
        --spacing-gutter: 24px;
        --font-display: "Satoshi", sans-serif;
      }
    `);
    expect(result.tokens).toEqual({
      "--color-brand": "#bada55",
      "--spacing-gutter": "24px",
      "--font-display": '"Satoshi", sans-serif',
    });
    expect(result.configPath).toBeNull();
  });

  it("surfaces a @config directive path for v3 resolveConfig resolution", () => {
    const result = extractTailwindV4(`@config "./tailwind.config.ts";\n@theme { --color-x: #000; }`);
    expect(result.configPath).toBe("./tailwind.config.ts");
    expect(result.tokens["--color-x"]).toBe("#000");
  });

  it("returns empty results for CSS with no Tailwind v4 directives", () => {
    expect(extractTailwindV4(`.btn { color: red; }`)).toEqual({ tokens: {}, hasTheme: false, configPath: null });
  });

  it("does not mistake the words '@theme' in a comment for an @theme block", () => {
    // A caller that text-matched `@theme` here would report "@theme block"
    // about a file that has none - a false claim about the reader's repo.
    const result = extractTailwindV4(`
      /* Tailwind v4 is consumed with @import; there is no literal @theme block. */
      @import "tailwindcss";
      .btn { color: red; }
    `);
    expect(result.hasTheme).toBe(false);
    expect(result.tokens).toEqual({});
  });

  it("reports an empty @theme block as present but contributing nothing", () => {
    const result = extractTailwindV4(`@theme { }`);
    expect(result).toEqual({ tokens: {}, hasTheme: true, configPath: null });
  });
});
