import { describe, expect, it } from "vitest";
import { canonicalColor } from "@apatureai/canon-schema";

/**
 * Shared colour canonicalizer (#97): the one `canonicalColor` both the drift
 * gate and reconciliation use. Load-bearing: hex 3/4/6/8-digit + `rgb()/rgba()`
 * collapse to a single `#rrggbbaa` (opaque `ff`); unrecognized formats → null.
 */
describe("canonicalColor", () => {
  it("canonicalizes hex (case, shorthand, opaque alpha) to #rrggbbaa", () => {
    expect(canonicalColor("#FFF")).toBe("#ffffffff");
    expect(canonicalColor("#ffffff")).toBe("#ffffffff");
    expect(canonicalColor("#FFFFFFFF")).toBe("#ffffffff");
    expect(canonicalColor("#2563EB")).toBe("#2563ebff");
    expect(canonicalColor("#abcd")).toBe("#aabbccdd"); // 4-digit shorthand w/ alpha
  });

  it("canonicalizes rgb()/rgba() equal to the equivalent hex", () => {
    expect(canonicalColor("rgb(255,255,255)")).toBe("#ffffffff");
    expect(canonicalColor("rgb(37, 99, 235)")).toBe("#2563ebff");
    expect(canonicalColor("rgba(0,0,0,0.5)")).toBe("#00000080");
    expect(canonicalColor("rgb(100%, 0%, 0%)")).toBe("#ff0000ff");
  });

  it("returns null for unrecognized formats (no false equivalence)", () => {
    expect(canonicalColor("hsl(0,0%,100%)")).toBeNull();
    expect(canonicalColor("rebeccapurple")).toBeNull();
    expect(canonicalColor("rgb(300,0,0)")).toBeNull(); // out of range channel
    expect(canonicalColor("#ff")).toBeNull(); // invalid hex length
  });

  it("equal colours in different spellings canonicalize identically", () => {
    expect(canonicalColor("#fff")).toBe(canonicalColor("rgb(255,255,255)"));
    expect(canonicalColor("#00000080")).toBe(canonicalColor("rgba(0,0,0,.5)"));
  });
});
