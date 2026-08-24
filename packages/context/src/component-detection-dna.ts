import type { ComponentConvention } from "@apatureai/canon-schema";
import { detectComponentLibraries, type PackageJsonLike } from "./component-detection.js";

/**
 * Map detected component libraries onto canonical `ComponentConvention`s
 * (PRD §5). A library detected in package.json tells us the project's component
 * primitives follow that library's conventions (its theming model, spacing
 * scale, a11y semantics), captured in `rubricAddendum` as a usage note.
 *
 * Provenance is "code" (read from package.json dependencies). Confidence is
 * moderate: a declared dependency is a strong signal the library is in use, but
 * which components and how they're styled is not verified here (the render
 * extractor + reconciler refine that in UD3). Empty when no library is detected,
 * because conventions are never invented.
 */
const DEP_PRESENCE_CONFIDENCE = 0.5;

export function extractComponentConventions(pkg: PackageJsonLike): ComponentConvention[] {
  return detectComponentLibraries(pkg).map((lib) => ({
    name: lib.id,
    variants: [],
    props: [],
    usageExamples: [lib.rubricAddendum],
    confidence: DEP_PRESENCE_CONFIDENCE,
    provenance: "code",
  }));
}
