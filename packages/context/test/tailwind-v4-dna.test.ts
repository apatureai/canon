import { emptyDraft, validateSnapshot } from "@apatureai/canon-schema";
import { describe, expect, it } from "vitest";
import { extractTailwindV4Tokens } from "../src/index.js";

describe("extractTailwindV4Tokens", () => {
  const css = `
    @import "tailwindcss";
    @theme {
      --color-brand: #bada55;
      --spacing-gutter: 24px;
      --font-display: "Satoshi", sans-serif;
      --radius-lg: 12px;
      --shadow-card: 0 1px 2px #0001;
      --breakpoint-md: 768px;
      --ease-snappy: cubic-bezier(0.2, 0, 0, 1);
    }
  `;

  it("classifies @theme tokens into canonical groups by the v4 namespace", () => {
    const { tokens } = extractTailwindV4Tokens(css);
    expect(tokens.color["--color-brand"]?.value).toBe("#bada55");
    expect(tokens.spacing["--spacing-gutter"]?.value).toBe("24px");
    expect(tokens.typography["--font-display"]?.value).toBe('"Satoshi", sans-serif');
    expect(tokens.radii["--radius-lg"]?.value).toBe("12px");
    expect(tokens.shadows["--shadow-card"]?.value).toBe("0 1px 2px #0001");
    expect(tokens.breakpoints["--breakpoint-md"]?.value).toBe("768px");
    expect(tokens.motion["--ease-snappy"]?.value).toBe("cubic-bezier(0.2, 0, 0, 1)");
  });

  it("stamps tokens as code-provenance facts with sub-1 confidence", () => {
    const { tokens } = extractTailwindV4Tokens(`@theme { --color-x: #000; }`);
    const f = tokens.color["--color-x"];
    expect(f?.provenance).toBe("code");
    expect(f?.confidence).toBeGreaterThan(0);
    expect(f?.confidence).toBeLessThan(1);
  });

  it("surfaces the @config path for the v3 resolveConfig pass", () => {
    const { configPath } = extractTailwindV4Tokens(`@config "./tailwind.config.ts";\n@theme { --color-x: #000; }`);
    expect(configPath).toBe("./tailwind.config.ts");
  });

  it("produces facts that pass schema validation when merged into a draft", () => {
    const draft = emptyDraft("apatureai", "canon", "test");
    draft.tokens = extractTailwindV4Tokens(css).tokens;
    expect(validateSnapshot(draft)).toEqual({ ok: true });
  });

  it("is deterministic and empty for non-v4 CSS", () => {
    expect(extractTailwindV4Tokens(css)).toEqual(extractTailwindV4Tokens(css));
    const { tokens, configPath } = extractTailwindV4Tokens(`.btn { color: red; }`);
    expect(configPath).toBeNull();
    for (const group of Object.values(tokens)) expect(Object.keys(group)).toHaveLength(0);
  });
});
