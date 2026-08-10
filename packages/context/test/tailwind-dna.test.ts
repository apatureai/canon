import { emptyDraft, validateSnapshot } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import {
  extractTailwindV3Tokens,
  extractTailwindV3TokensFromFile,
  type ConfigLoader,
} from "../src/index.js";

const config = {
  content: [],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: "#bada55" } },
      spacing: { gutter: "24px" },
      borderRadius: { card: "12px" },
      fontFamily: { display: ["Satoshi", "sans-serif"] },
      screens: { wide: "1440px" },
    },
  },
};

describe("extractTailwindV3Tokens", () => {
  it("maps resolved-theme categories onto canonical DnaTokens groups", () => {
    const tokens = extractTailwindV3Tokens(config);
    expect(tokens.color["colors.brand"]?.value).toBe("#bada55");
    expect(tokens.spacing["spacing.gutter"]?.value).toBe("24px");
    expect(tokens.radii["borderRadius.card"]?.value).toBe("12px");
    expect(tokens.typography["fontFamily.display"]?.value).toBe("Satoshi, sans-serif");
    expect(tokens.breakpoints["screens.wide"]?.value).toBe("1440px");
  });

  it("stamps tokens as config-provenance facts with sub-1 confidence", () => {
    const f = extractTailwindV3Tokens(config).color["colors.brand"];
    expect(f?.provenance).toBe("config");
    expect(f?.confidence).toBeGreaterThan(0);
    expect(f?.confidence).toBeLessThan(1);
  });

  it("returns empty tokens when the config can't be resolved", () => {
    const exploding = {
      get theme(): never {
        throw new Error("boom");
      },
    };
    const tokens = extractTailwindV3Tokens(exploding);
    for (const group of Object.values(tokens)) expect(Object.keys(group)).toHaveLength(0);
  });

  it("produces facts that pass schema validation when merged into a draft", () => {
    const draft = emptyDraft("apatureai", "canon", "test");
    draft.tokens = extractTailwindV3Tokens(config);
    expect(validateSnapshot(draft)).toEqual({ ok: true });
  });
});

describe("extractTailwindV3TokensFromFile (stubbed worker seam)", () => {
  const stubLoader = (cfg: unknown): ConfigLoader => ({ load: () => Promise.resolve(cfg) });

  it("maps tokens from a config file via the injected loader (no real config executed)", async () => {
    const tokens = await extractTailwindV3TokensFromFile("tailwind.config.ts", stubLoader(config));
    expect(tokens.spacing["spacing.gutter"]?.value).toBe("24px");
  });

  it("returns empty tokens when the loader throws", async () => {
    const failing: ConfigLoader = { load: () => Promise.reject(new Error("worker failed")) };
    const tokens = await extractTailwindV3TokensFromFile("tailwind.config.ts", failing);
    for (const group of Object.values(tokens)) expect(Object.keys(group)).toHaveLength(0);
  });
});
