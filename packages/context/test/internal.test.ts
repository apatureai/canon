/**
 * The context extractors' shared internals, isRecord and CONFIG_CONFIDENCE,
 * extracted from byte-identical copies (brand/tokens-json and tailwind-dna/
 * tokens-json-dna). Pins the plain-object guard and the config-provenance
 * confidence both pairs of extractors depend on.
 */
import { describe, expect, it } from "vitest";
import { isRecord, CONFIG_CONFIDENCE } from "../src/internal.js";

describe("isRecord", () => {
  it("is true only for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });
  it("is false for null, arrays, and primitives", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("x")).toBe(false);
    expect(isRecord(3)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe("CONFIG_CONFIDENCE", () => {
  it("is the config-provenance confidence (0.8)", () => {
    expect(CONFIG_CONFIDENCE).toBe(0.8);
  });
});
