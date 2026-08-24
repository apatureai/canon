import { emptyDraft, validateSnapshot } from "@apatureai/canon-schema";
import { describe, expect, it } from "vitest";
import { extractComponentConventions } from "../src/index.js";

describe("extractComponentConventions", () => {
  it("maps detected libraries onto ComponentConvention facts", () => {
    const conventions = extractComponentConventions({
      dependencies: { "class-variance-authority": "^0.7.0", "@radix-ui/react-dialog": "^1" },
    });
    const names = conventions.map((c) => c.name).sort();
    expect(names).toEqual(["radix", "shadcn/ui"]);
    const shadcn = conventions.find((c) => c.name === "shadcn/ui");
    expect(shadcn?.usageExamples[0]).toContain("CSS-variable");
    expect(shadcn?.provenance).toBe("code");
    expect(shadcn?.confidence).toBeGreaterThan(0);
    expect(shadcn?.confidence).toBeLessThan(1);
  });

  it("returns no conventions when no library is detected (never invented)", () => {
    expect(extractComponentConventions({ dependencies: { react: "^18" } })).toEqual([]);
    expect(extractComponentConventions({})).toEqual([]);
  });

  it("produces conventions that pass schema validation when merged into a draft", () => {
    const draft = emptyDraft("apatureai", "canon", "test");
    draft.components = extractComponentConventions({ dependencies: { "@mui/material": "^5" } });
    expect(validateSnapshot(draft)).toEqual({ ok: true });
  });

  it("is deterministic: same package.json in -> same conventions out", () => {
    const pkg = { dependencies: { "@chakra-ui/react": "^2" } };
    expect(extractComponentConventions(pkg)).toEqual(extractComponentConventions(pkg));
  });
});
