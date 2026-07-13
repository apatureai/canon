import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DTCG_2025_10_PROFILE,
  mergeTokens,
  parseTokensJson,
  parseTokensJsonTyped,
  projectTokenValue,
  resolveTokensJson,
  sortTokens,
} from "../src/index.js";

function colorValue(hex: string, components: [number, number, number] = [0, 0, 0]) {
  return { colorSpace: "srgb", components, alpha: 1, hex };
}

describe("Design Tokens Format Module 2025.10", () => {
  it("matches the frozen Format 2025.10 conformance golden byte-for-byte", () => {
    const input = JSON.parse(readFileSync(new URL("./fixtures/dtcg-2025.10-format.json", import.meta.url), "utf8"));
    const expected = JSON.parse(readFileSync(
      new URL("./fixtures/dtcg-2025.10-format.expected.json", import.meta.url),
      "utf8",
    ));
    const actual = resolveTokensJson(input);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
    expect(JSON.stringify(resolveTokensJson(input))).toBe(JSON.stringify(actual));
  });

  it("matches the frozen adversarial error taxonomy", () => {
    const input = JSON.parse(readFileSync(new URL("./fixtures/dtcg-2025.10-adversarial.json", import.meta.url), "utf8"));
    const result = resolveTokensJson(input);
    expect(result.tokens.map((token) => token.name)).toEqual(["valid"]);
    expect(new Set(result.diagnostics.map((item) => item.code))).toEqual(new Set([
      "circular_reference",
      "type_mismatch",
      "unresolved_reference",
      "unsupported_external_reference",
    ]));
  });

  it("retains exact structured values until the named string projection", () => {
    const doc = {
      shadow: {
        card: {
          $type: "shadow",
          $value: [{ color: "#0008", offsetX: { unit: "px", value: 0 } }],
        },
      },
    };
    const [token] = parseTokensJsonTyped(doc);
    expect(token?.value).toEqual([{ color: "#0008", offsetX: { unit: "px", value: 0 } }]);
    expect(projectTokenValue(token!.value)).toBe(
      '[{"color":"#0008","offsetX":{"unit":"px","value":0}}]',
    );
  });

  it("resolves chained curly aliases and inherits the referenced type", () => {
    const result = resolveTokensJson({
      primitive: { ink: { $type: "color", $value: colorValue("#111") } },
      semantic: {
        text: { $value: "{primitive.ink}" },
        body: { $value: "{semantic.text}" },
      },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.find((token) => token.name === "semantic.body")).toEqual({
      name: "semantic.body",
      value: colorValue("#111"),
      type: "color",
      derivation: [
        { kind: "curly_alias", from: "semantic.text", to: "primitive.ink" },
        { kind: "curly_alias", from: "semantic.body", to: "semantic.text" },
      ],
    });
  });

  it("resolves same-document JSON Pointers and property-level composite references", () => {
    const result = resolveTokensJson({
      palette: {
        blue: {
          $type: "color",
          $value: { colorSpace: "srgb", components: [0, 0.4, 0.8], alpha: 1 },
        },
      },
      alias: { $value: { $ref: "#/palette/blue/$value" } },
      translucent: {
        $type: "color",
        $value: {
          colorSpace: "srgb",
          components: [
            { $ref: "#/palette/blue/$value/components/0" },
            { $ref: "#/palette/blue/$value/components/1" },
            { $ref: "#/palette/blue/$value/components/2" },
          ],
          alpha: 0.5,
        },
      },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.find((token) => token.name === "alias")?.value).toEqual({
      alpha: 1,
      colorSpace: "srgb",
      components: [0, 0.4, 0.8],
    });
    expect(result.tokens.find((token) => token.name === "alias")?.type).toBe("color");
    expect(result.tokens.find((token) => token.name === "translucent")?.value).toEqual({
      alpha: 0.5,
      colorSpace: "srgb",
      components: [0, 0.4, 0.8],
    });
  });

  it("implements RFC 6901 escaping and shallow sibling overrides", () => {
    const result = resolveTokensJson({
      "brand/ink~dark": {
        $type: "color",
        $value: colorValue("#111"),
      },
      alias: {
        $type: "color",
        $value: {
          $ref: "#/brand~1ink~0dark/$value",
          alpha: 0.75,
        },
      },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.find((token) => token.name === "alias")?.value).toEqual({
      alpha: 0.75,
      colorSpace: "srgb",
      components: [0, 0, 0],
      hex: "#111",
    });
  });

  it("deep-merges group $extends, applies local token overrides, and records derivation", () => {
    const result = resolveTokensJson({
      button: {
        $type: "color",
        background: { $value: colorValue("#06c", [0, 0.4, 0.8]) },
        text: { $value: colorValue("#fff", [1, 1, 1]) },
      },
      primary: {
        $extends: "{button}",
        background: { $value: colorValue("#c06", [0.8, 0, 0.4]) },
      },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.find((token) => token.name === "primary.background")).toMatchObject({
      value: colorValue("#c06", [0.8, 0, 0.4]),
      type: "color",
      derivation: [{ kind: "group_extend", from: "primary", to: "button" }],
    });
    expect(result.tokens.find((token) => token.name === "primary.text")?.value).toEqual(
      colorValue("#fff", [1, 1, 1]),
    );
  });

  it("accepts the Format Module's JSON Pointer spelling for group extension", () => {
    const result = resolveTokensJson({
      base: { $type: "dimension", gap: { $value: { value: 8, unit: "px" } } },
      compact: { $ref: "#/base", gap: { $value: { value: 4, unit: "px" } } },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.find((token) => token.name === "compact.gap")).toMatchObject({
      value: { unit: "px", value: 4 },
      type: "dimension",
      derivation: [{ kind: "group_extend", from: "compact", to: "base" }],
    });
  });

  it("supports $root tokens explicitly", () => {
    const result = resolveTokensJson({
      spacing: {
        $type: "dimension",
        $root: { $value: { value: 16, unit: "px" } },
        small: { $value: { value: 8, unit: "px" } },
      },
    });
    expect(result.tokens.map((token) => token.name)).toEqual(["spacing.$root", "spacing.small"]);
  });

  it("supports classic Style Dictionary values without claiming DTCG conformance", () => {
    expect(parseTokensJsonTyped({ size: { base: { value: 16 } } })).toEqual([
      { name: "size.base", value: 16, type: null, derivation: [] },
    ]);
    expect(parseTokensJson({ size: { base: { value: 16 } } })).toEqual({ "size.base": "16" });
  });

  it("publishes an explicit bounded capability profile", () => {
    expect(DTCG_2025_10_PROFILE).toEqual({
      formatModule: "2025.10",
      aliases: true,
      jsonPointer: "same-document-only",
      groupExtends: true,
      resolverSetsAndModifiers: false,
      externalSources: false,
    });
  });
});

describe("DTCG diagnostics and fail-closed behavior", () => {
  it.each([
    [
      "unresolved alias",
      { bad: { $type: "color", $value: "{missing}" } },
      "unresolved_reference",
      "bad",
    ],
    [
      "token cycle",
      { a: { $type: "color", $value: "{b}" }, b: { $type: "color", $value: "{a}" } },
      "circular_reference",
      "a",
    ],
    [
      "group cycle",
      { a: { $extends: "{b}" }, b: { $extends: "{a}" } },
      "circular_reference",
      "a",
    ],
    [
      "type mismatch",
      { base: { $type: "color", $value: colorValue("#fff", [1, 1, 1]) }, bad: { $type: "dimension", $value: "{base}" } },
      "type_mismatch",
      "bad",
    ],
    [
      "missing DTCG type",
      { bad: { $value: "#fff" } },
      "missing_type",
      "bad",
    ],
    [
      "external reference",
      { bad: { $type: "color", $value: { $ref: "https://example.com/tokens.json#/x" } } },
      "unsupported_external_reference",
      "bad",
    ],
  ] as const)("reports %s and never emits the invalid token", (_name, doc, code, invalidName) => {
    const result = resolveTokensJson(doc);
    expect(result.tokens.some((token) => token.name === invalidName)).toBe(false);
    expect(result.diagnostics.some((item) => item.code === code)).toBe(true);
  });

  it("abstains explicitly from Resolver Module sets/modifiers", () => {
    const result = resolveTokensJson({
      sets: { base: { sources: [{ $ref: "tokens.json" }] } },
      resolutionOrder: [{ $ref: "#/sets/base" }],
    });
    expect(result.tokens).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "unsupported_resolver_module" }),
    ]);
  });

  it("rejects a raw value that does not conform to its DTCG type", () => {
    const result = resolveTokensJson({ bad: { $type: "color", $value: "#fff" } });
    expect(result.tokens).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid_value",
      path: "bad",
    }));
  });

  it("rejects DTCG names that make alias paths ambiguous", () => {
    const result = resolveTokensJson({ "bad.name": { $type: "number", $value: 1 } });
    expect(result.tokens).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid_structure",
      path: "bad.name",
    }));
  });

  it("rejects documents above the configured token ceiling", () => {
    const result = resolveTokensJson(
      { color: { a: { $type: "color", $value: "#111" }, b: { $type: "color", $value: "#222" } } },
      { maxTokens: 1 },
    );
    expect(result.tokens).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "resource_limit" }));
  });

  it("bounds input and expanded alias value nodes", () => {
    expect(resolveTokensJson(
      { nested: { token: { $type: "number", $value: 1 } } },
      { maxInputNodes: 1 },
    )).toMatchObject({ tokens: [], diagnostics: [expect.objectContaining({ code: "resource_limit" })] });

    const result = resolveTokensJson({
      base: { $type: "color", $value: colorValue("#111") },
      alias: { $value: "{base}" },
    }, { maxResolvedValueNodes: 1 });
    expect(result.tokens).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "resource_limit" }));
  });
});

describe("token merge + sort", () => {
  it("merges sources with later-source-wins and sorted keys", () => {
    const merged = mergeTokens([
      { source: "tailwind", tokens: { "color.b": "1", "color.a": "2" } },
      { source: "css-vars", tokens: { "color.b": "override" } },
    ]);
    expect(Object.keys(merged)).toEqual(["color.a", "color.b"]);
    expect(merged["color.b"]).toBe("override");
  });

  it("sortTokens is order-independent", () => {
    expect(JSON.stringify(sortTokens({ b: "1", a: "2" }))).toBe(
      JSON.stringify(sortTokens({ a: "2", b: "1" })),
    );
  });
});
