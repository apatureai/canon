/**
 * The library path, end to end, in one file: extract → reconcile → drift →
 * version → sign off → serve. Run it from the repository root AFTER `pnpm build`:
 *
 *   node examples/library-example.ts
 *
 * The `@uidna/*` specifiers resolve here because the repository root declares
 * the workspace packages as dependencies. Outside this repository the packages
 * were never published to npm, so rewrite each `@uidna/x` to a path into
 * `packages/x/dist` (or vendor the source you want).
 */
import { emptyDraft } from "@uidna/schema";
import { extractCssTokens } from "@uidna/context";
import { computeVisualDistributions, sampleCaptureEvidence } from "@uidna/render";
import { reconcileTokens, computeDriftHints } from "@uidna/reconcile";
import {
  inMemorySnapshotStore, commitSnapshot, requestReview, approveSnapshot, getSnapshot,
} from "@uidna/store";

const draft = emptyDraft("acme", "web", "extractor@1");
draft.tokens = extractCssTokens(":root { --color-brand: #0a0a0a; --spacing-gap: 8px; }");
draft.distributions = computeVisualDistributions(sampleCaptureEvidence());

const { tokens, conflicts } = reconcileTokens(draft.tokens, draft.distributions);
draft.tokens = tokens;
console.log(computeDriftHints(conflicts).map((hint) => hint.message));

const store = inMemorySnapshotStore();
const { stored } = await commitSnapshot(store, draft);          // immutable draft version

// Reading before sign-off returns null: a draft genome is never served downstream.
console.log("before approval:", await getSnapshot(store, "acme/web"));

await approveSnapshot(store, requestReview(stored.snapshot));   // new immutable approved version

const served = await getSnapshot(store, "acme/web");
console.log("after approval: ", served?.contract, served?.contentDigest.slice(0, 14));
// served: { contract: { schemaVersion: "1", storeVersion: "2" },
//           repo, dnaVersion, contentDigest: "sha256:…", snapshot }
