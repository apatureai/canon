import { emptyDraft, validateSnapshot } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import { extractBrandIdentity } from "../src/index.js";

describe("extractBrandIdentity", () => {
  const yml = `
brand:
  description: A calm budgeting app for freelancers
  tone: friendly, reassuring
  audience: self-employed people
  do:
    - use warm neutral colors
  dont:
    - use aggressive red for normal balances
`;

  it("maps the brand block onto ProductIdentity facts", () => {
    const id = extractBrandIdentity(yml);
    expect(id.tone?.value).toBe("friendly, reassuring");
    expect(id.audience?.value).toBe("self-employed people");
    expect(id.dos.map((f) => f.value)).toEqual(["use warm neutral colors"]);
    expect(id.donts.map((f) => f.value)).toEqual(["use aggressive red for normal balances"]);
  });

  it("stamps fields as human-authored facts with sub-1 confidence", () => {
    const id = extractBrandIdentity(yml);
    for (const f of [id.tone, id.audience, ...id.dos, ...id.donts]) {
      expect(f?.provenance).toBe("human");
      expect(f?.confidence).toBeGreaterThan(0);
      expect(f?.confidence).toBeLessThan(1);
    }
  });

  it("leaves name null — brand description is intent, not a product name", () => {
    expect(extractBrandIdentity(yml).name).toBeNull();
  });

  it("suppresses identity entirely when the brand block is absent/empty/invalid", () => {
    const empty = { name: null, audience: null, tone: null, dos: [], donts: [] };
    expect(extractBrandIdentity("rules:\n  max_per_pr: 5")).toEqual(empty);
    expect(extractBrandIdentity("brand:")).toEqual(empty);
    expect(extractBrandIdentity("brand:\n  : : bad")).toEqual(empty);
  });

  it("produces facts that pass schema validation when merged into a draft", () => {
    const draft = emptyDraft("apatureai", "canon", "test");
    draft.identity = extractBrandIdentity(yml);
    expect(validateSnapshot(draft)).toEqual({ ok: true });
  });

  it("is deterministic: same YAML in -> same identity out", () => {
    expect(extractBrandIdentity(yml)).toEqual(extractBrandIdentity(yml));
  });
});
