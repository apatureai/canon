import { fact } from "@apatureai/canon-schema";
import { describe, expect, it } from "vitest";
import { reconcileContributions, tokenCountsByGroup } from "../src/index.js";
import type { TokenContribution } from "../src/index.js";

const contribution = (
  name: string,
  value: string,
  confidence: number,
  provenance: "code" | "config",
  source: string,
): TokenContribution => ({ group: "color", name, fact: fact(value, confidence, provenance), source });

/**
 * The CLI's merge step. One token declared by several files is exactly the case
 * the precedence ladder exists for, so these assert the ladder's behaviour as it
 * appears in the report rather than re-testing `reconcileField` in isolation.
 */
describe("reconcileContributions", () => {
  it("passes a single-source token through untouched", () => {
    const result = reconcileContributions([contribution("--color-ink", "#101010", 0.6, "code", "app.css")]);
    expect(result.tokens.color["--color-ink"]).toEqual({
      value: "#101010",
      confidence: 0.6,
      provenance: "code",
    });
    expect(result.conflicts).toEqual([]);
  });

  it("reinforces confidence when two independent files agree", () => {
    const result = reconcileContributions([
      contribution("--color-ink", "#101010", 0.6, "code", "app.css"),
      contribution("--color-ink", "#101010", 0.7, "code", "theme.css"),
    ]);
    const resolved = result.tokens.color["--color-ink"];
    expect(resolved?.value).toBe("#101010");
    expect(resolved?.confidence).toBeGreaterThan(0.7); // above either source alone
    expect(resolved?.confidence).toBeLessThan(1); // 1.0 stays reserved for sign-off
    expect(result.conflicts).toEqual([]);
  });

  it("lets a declared config token outrank extracted code, and records the trail", () => {
    const result = reconcileContributions([
      contribution("--color-brand", "#0a58ca", 0.6, "code", "app.css"),
      contribution("--color-brand", "#2f6fed", 0.8, "config", "tokens.json"),
    ]);
    const resolved = result.tokens.color["--color-brand"];
    expect(resolved?.value).toBe("#2f6fed");
    expect(resolved?.provenance).toBe("config");
    expect(resolved?.confidence).toBeLessThan(0.8); // dissent degrades trust
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.field).toBe("tokens.color.--color-brand");
    expect(result.conflicts[0]?.candidates.map((candidate) => candidate.value)).toEqual([
      "#0a58ca",
      "#2f6fed",
    ]);
    // The report needs to name the files, which the schema Conflict does not carry.
    expect(result.conflictSources["tokens.color.--color-brand"]).toEqual(["app.css", "tokens.json"]);
  });

  it("is order-independent: candidate order never changes the resolved value", () => {
    const a = contribution("--color-brand", "#0a58ca", 0.6, "code", "app.css");
    const b = contribution("--color-brand", "#2f6fed", 0.8, "config", "tokens.json");
    expect(reconcileContributions([a, b]).tokens.color["--color-brand"]).toEqual(
      reconcileContributions([b, a]).tokens.color["--color-brand"],
    );
  });

  it("counts every canonical group, including the empty ones", () => {
    const result = reconcileContributions([contribution("--color-ink", "#101010", 0.6, "code", "app.css")]);
    expect(tokenCountsByGroup(result.tokens)).toEqual([
      { group: "color", count: 1 },
      { group: "typography", count: 0 },
      { group: "spacing", count: 0 },
      { group: "radii", count: 0 },
      { group: "shadows", count: 0 },
      { group: "breakpoints", count: 0 },
      { group: "motion", count: 0 },
    ]);
  });
});
