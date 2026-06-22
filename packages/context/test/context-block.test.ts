import { emptyDraft, fact } from "@uidna/schema";
import { describe, expect, it } from "vitest";
import {
  buildContextBlock,
  CONTEXT_VERSION,
  extractCssTokens,
  serializeContextBlock,
} from "../src/index.js";

function draftFromCss(css: string) {
  const draft = emptyDraft("apatureai", "ui-dna", "test");
  draft.tokens = extractCssTokens(css);
  return draft;
}

describe("serializeContextBlock", () => {
  it("is byte-identical across two PRs of the same repo state (sorted keys, no timestamps)", () => {
    // Same tokens, different insertion order -> identical serialization.
    const a = draftFromCss(`:root { --color-bg: #fff; --space-2: 8px; }`);
    const b = draftFromCss(`:root { --space-2: 8px; --color-bg: #fff; }`);
    expect(serializeContextBlock(a)).toBe(serializeContextBlock(b));
    expect(buildContextBlock(a).contentHash).toBe(buildContextBlock(b).contentHash);
  });

  it("contains no timestamp and stamps the context version", () => {
    const s = serializeContextBlock(draftFromCss(`:root { --color-bg: #fff; }`));
    expect(s).toContain(`"contextVersion":"${CONTEXT_VERSION}"`);
    expect(s).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no ISO timestamp leaked in
  });

  it("recomputes (hash changes) only when extracted content changes", () => {
    const base = buildContextBlock(draftFromCss(`:root { --color-bg: #fff; }`));
    const same = buildContextBlock(draftFromCss(`:root { --color-bg: #fff; }`));
    const changed = buildContextBlock(draftFromCss(`:root { --color-bg: #000; }`));
    expect(same.contentHash).toBe(base.contentHash); // unchanged content -> warm cache
    expect(changed.contentHash).not.toBe(base.contentHash); // changed token -> invalidated
  });

  it("ignores metadata/approval changes — they must not bust the content cache", () => {
    const draft = draftFromCss(`:root { --color-bg: #fff; }`);
    const before = buildContextBlock(draft).contentHash;
    draft.metadata.dnaVersion = "7";
    draft.metadata.approvalState = "approved";
    draft.metadata.modelVersion = "v9";
    expect(buildContextBlock(draft).contentHash).toBe(before);
  });

  it("reflects identity/component changes in the hash", () => {
    const draft = draftFromCss(`:root { --color-bg: #fff; }`);
    const before = buildContextBlock(draft).contentHash;
    draft.identity.tone = fact("friendly", 0.9, "human");
    expect(buildContextBlock(draft).contentHash).not.toBe(before);
  });

  it("produces a stable sha256 (64 hex chars)", () => {
    expect(buildContextBlock(draftFromCss(`:root { --color-bg: #fff; }`)).contentHash).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
