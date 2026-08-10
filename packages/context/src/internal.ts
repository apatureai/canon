/**
 * Small helpers shared across the context extractors.
 *
 * `isRecord` (a plain-object guard) and `CONFIG_CONFIDENCE` (the confidence
 * assigned to config-provenance tokens) were each copy-pasted, byte-identical,
 * into two extractor modules. Config-provenance confidence in particular must
 * agree between the Tailwind-config and tokens.json extractors, so it is
 * single-sourced here. The other per-provenance confidences (code/theme/human/
 * dep-presence) are each used by exactly one extractor and deliberately stay
 * local to it; only the genuinely-shared values live here.
 */

/** True for a plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Confidence for a token whose provenance is a build/config file (Tailwind
 * config, tokens.json): author-declared, a notch below human sign-off.
 */
export const CONFIG_CONFIDENCE = 0.8;
