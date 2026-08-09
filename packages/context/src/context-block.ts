import { createHash } from "node:crypto";
import type { DnaSnapshot } from "@uidna/schema";

/**
 * Deterministic context-block assembly + content-hash cache invalidation
 * (PRD §5, §6.6, §7). The extracted UI DNA content is serialized
 * deterministically — recursively sorted keys, no timestamps, sorted arrays —
 * so the same repo state produces a byte-identical block across PRs. The cache
 * is keyed on the SHA-256 of that serialization (NOT a wall-clock TTL), so a
 * downstream snapshot is recomputed only when the repo's tokens/brand/components
 * actually change.
 *
 * Ported from judgment-engine's proven `@engine/context` context-block builder
 * and adapted to serialize the canonical `DnaSnapshot`
 * content. Bump `CONTEXT_VERSION` when the serialization format changes; it is
 * part of the hashed payload, so a format change busts every cache entry.
 */
export const CONTEXT_VERSION = "1";

export interface ContextBlock {
  contextVersion: string;
  /** sha256 of the serialized block — the cache key / invalidation token. */
  contentHash: string;
  /** Deterministic, byte-stable serialization of the extracted DNA content. */
  serialized: string;
}

/**
 * Recursively canonicalize a value so serialization is order-independent: object
 * keys are sorted, AND arrays are sorted by the stable stringification of their
 * (already-canonicalized) elements. The extracted-content arrays here
 * (components, anchors, exceptions, identity dos/donts, distribution sequences)
 * are sets of facts, not positional data, so two snapshots that differ only in
 * array order are semantically equal and must hash identically (#14) — extractor
 * order today is stable, but the hash no longer depends on that.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .sort((a, b) => {
        const sa = JSON.stringify(a);
        const sb = JSON.stringify(b);
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic, byte-stable serialization of a snapshot's EXTRACTED CONTENT.
 *
 * Deliberately excludes `metadata` (schema/dna/extraction/model versions +
 * approval state): those are lifecycle stamps, not extracted content, and must
 * not perturb the content hash — otherwise bumping `dnaVersion` or approving a
 * snapshot would spuriously bust the cache. The `contextVersion` (format stamp)
 * IS included, so a serialization-format change busts every entry.
 */
export function serializeContextBlock(snapshot: DnaSnapshot): string {
  const canonical = {
    contextVersion: CONTEXT_VERSION,
    repository: snapshot.repository,
    identity: snapshot.identity,
    tokens: snapshot.tokens,
    components: snapshot.components,
    distributions: snapshot.distributions,
    anchors: snapshot.anchors,
    exceptions: snapshot.exceptions,
  };
  return JSON.stringify(canonicalize(canonical));
}

/** Assemble the context block + its content hash (cache key) + version stamp. */
export function buildContextBlock(snapshot: DnaSnapshot): ContextBlock {
  const serialized = serializeContextBlock(snapshot);
  const contentHash = createHash("sha256").update(serialized).digest("hex");
  return { contextVersion: CONTEXT_VERSION, contentHash, serialized };
}
