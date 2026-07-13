import { describe, expect, it } from "vitest";
import { extractTokensJsonWithDiagnostics, resolveTokensJson } from "../src/index.js";

function byName(result: ReturnType<typeof resolveTokensJson>) {
  return new Map(result.resolved.map((t) => [t.name, t]));
}

describe("DTCG 2025.10 alias resolution (ui-dna#65)", () => {
  it("resolves a same-document curly-brace alias and keeps the derivation chain", () => {
    const doc = {
      primitive: { ink: { $type: "color", $value: "#0a0a0a" } },
      semantic: { brand: { $type: "color", $value: "{primitive.ink}" } },
    };
    const m = byName(resolveTokensJson(doc));
    expect(m.get("semantic.brand")!.value).toBe("#0a0a0a"); // resolved, not "{primitive.ink}"
    expect(m.get("semantic.brand")!.derivation).toEqual(["primitive.ink"]);
    expect(m.get("semantic.brand")!.type).toBe("color");
  });

  it("resolves a chained alias (a -> b -> c) to the terminal literal", () => {
    const doc = {
      a: { $type: "color", $value: "#fff" },
      b: { $type: "color", $value: "{a}" },
      c: { $type: "color", $value: "{b}" },
    };
    const c = byName(resolveTokensJson(doc)).get("c")!;
    expect(c.value).toBe("#fff");
    expect(c.derivation).toEqual(["b", "a"]);
  });

  it("resolves a property-level alias inside a composite value, preserving structure", () => {
    const doc = {
      color: { border: { $type: "color", $value: "#ccc" } },
      shadow: {
        card: {
          $type: "shadow",
          $value: { color: "{color.border}", offsetX: "0px", offsetY: "1px", blur: "2px", spread: "0px" },
        },
      },
    };
    const s = byName(resolveTokensJson(doc)).get("shadow.card")!;
    expect(s.value).toEqual({ color: "#ccc", offsetX: "0px", offsetY: "1px", blur: "2px", spread: "0px" });
    expect(s.derivation).toContain("color.border");
  });

  it("resolves an RFC 6901 same-document $ref (including a /$value tail)", () => {
    const doc = {
      color: { brand: { $type: "color", $value: "#123456" } },
      alias: { $type: "color", $value: { $ref: "#/color/brand/$value" } },
    };
    expect(byName(resolveTokensJson(doc)).get("alias")!.value).toBe("#123456");
  });

  it("rejects a circular reference with a diagnostic and never emits it as resolved", () => {
    const doc = { a: { $type: "color", $value: "{b}" }, b: { $type: "color", $value: "{a}" } };
    const res = resolveTokensJson(doc);
    expect(res.resolved).toHaveLength(0);
    expect(res.diagnostics.map((d) => d.kind).sort()).toEqual(["circular_reference", "circular_reference"]);
  });

  it("rejects an unresolved reference", () => {
    const res = resolveTokensJson({ a: { $type: "color", $value: "{does.not.exist}" } });
    expect(res.resolved).toHaveLength(0);
    expect(res.diagnostics[0]).toMatchObject({ name: "a", kind: "unresolved_reference" });
  });

  it("rejects a type mismatch between an alias and its target", () => {
    const doc = {
      size: { base: { $type: "dimension", $value: "8px" } },
      c: { $type: "color", $value: "{size.base}" }, // color aliasing a dimension
    };
    const res = resolveTokensJson(doc);
    expect(res.diagnostics.find((d) => d.name === "c")).toMatchObject({ kind: "type_mismatch" });
  });

  it("rejects a remote/filesystem $ref as malformed (same-document only)", () => {
    const res = resolveTokensJson({ a: { $type: "color", $value: { $ref: "other.json#/x" } } });
    expect(res.diagnostics[0]).toMatchObject({ name: "a", kind: "malformed_reference" });
  });

  it("a literal token resolves to itself with an empty derivation", () => {
    const t = byName(resolveTokensJson({ x: { $type: "color", $value: "#000" } })).get("x")!;
    expect(t.value).toBe("#000");
    expect(t.derivation).toEqual([]);
  });
});

describe("extractTokensJson never promotes raw reference syntax (ui-dna#65)", () => {
  it("promotes the RESOLVED value, not the alias literal, and abstains on unresolved", () => {
    const doc = {
      primitive: { ink: { $type: "color", $value: "#0a0a0a" } },
      semantic: { brand: { $type: "color", $value: "{primitive.ink}" } },
      broken: { $type: "color", $value: "{missing}" },
    };
    const { tokens, diagnostics } = extractTokensJsonWithDiagnostics(doc);
    expect(tokens.color["semantic.brand"]!.value).toBe("#0a0a0a"); // resolved
    expect(JSON.stringify(tokens)).not.toContain("{primitive.ink}"); // raw syntax never promoted
    expect(tokens.color["broken"]).toBeUndefined(); // abstained
    expect(diagnostics.map((d) => d.name)).toContain("broken");
  });

  it("is deterministic: same document in -> byte-identical genome out", () => {
    const doc = {
      a: { $type: "color", $value: "#fff" },
      b: { $type: "color", $value: "{a}" },
    };
    expect(JSON.stringify(extractTokensJsonWithDiagnostics(doc).tokens)).toBe(
      JSON.stringify(extractTokensJsonWithDiagnostics(doc).tokens),
    );
  });
});
