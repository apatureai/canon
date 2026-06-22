import type { ProductIdentity } from "@uidna/schema";
import { fact } from "@uidna/schema";
import { extractBrandBlock } from "./brand.js";

/**
 * Map a `.designreview.yml` brand block onto the canonical `ProductIdentity`
 * (PRD §5), stamping every field as a `Fact<string>` with provenance "human" —
 * a person authored this block, the strongest provenance short of explicit
 * sign-off, so it earns high confidence (still < 1; 1.0 is reserved for a
 * human-*confirmed* DNA fact during sign-off).
 *
 * When no brand block is present (or it is empty/invalid) the identity is left
 * empty — the brand dimension is suppressed, never invented (PRD §5.2).
 */
const HUMAN_AUTHORED_CONFIDENCE = 0.9;

function emptyIdentity(): ProductIdentity {
  return { name: null, audience: null, tone: null, dos: [], donts: [] };
}

/**
 * Extract product identity from a `.designreview.yml`. The brand `description`
 * is free-text intent, not a product name, so `name` is left for a dedicated
 * source (package.json / repo name) — tone, audience, and the do/don't rules map
 * directly. Deterministic: same YAML in → same identity out.
 */
export function extractBrandIdentity(designReviewYml: string): ProductIdentity {
  const identity = emptyIdentity();
  const brand = extractBrandBlock(designReviewYml);
  if (!brand) return identity;

  if (brand.tone) identity.tone = fact(brand.tone, HUMAN_AUTHORED_CONFIDENCE, "human");
  if (brand.audience) identity.audience = fact(brand.audience, HUMAN_AUTHORED_CONFIDENCE, "human");
  identity.dos = brand.do.map((d) => fact(d, HUMAN_AUTHORED_CONFIDENCE, "human"));
  identity.donts = brand.dont.map((d) => fact(d, HUMAN_AUTHORED_CONFIDENCE, "human"));

  return identity;
}
