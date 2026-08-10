import {
  SCHEMA_VERSION,
  type DnaSnapshot,
  type Fact,
  type Provenance,
} from "./dna.js";

/** Construct a confidence/provenance-stamped fact. Clamps confidence to [0,1]. */
export function fact<T>(value: T, confidence: number, provenance: Provenance): Fact<T> {
  const c = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
  return { value, confidence: c, provenance };
}

/** An empty draft snapshot for a repo; extractors fill it field by field. */
export function emptyDraft(owner: string, name: string, extractionVersion: string): DnaSnapshot {
  return {
    repository: { owner, name },
    identity: { name: null, audience: null, tone: null, dos: [], donts: [] },
    tokens: { color: {}, typography: {}, spacing: {}, radii: {}, shadows: {}, breakpoints: {}, motion: {} },
    components: [],
    distributions: { spacingIntervals: [], typeScale: [], colorProportions: {}, radiusPatterns: [], density: null },
    anchors: [],
    exceptions: [],
    metadata: {
      schemaVersion: SCHEMA_VERSION,
      dnaVersion: "0",
      extractionVersion,
      modelVersion: null,
      approvalState: "draft",
    },
  };
}

/** A snapshot is usable downstream only once a human has approved it (PRD §4). */
export function isApproved(snapshot: DnaSnapshot): boolean {
  return snapshot.metadata.approvalState === "approved";
}

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const PROVENANCES: ReadonlySet<Provenance> = new Set(["code", "pixels", "config", "human", "feedback"]);

function checkFact(path: string, f: Fact<unknown>, errors: string[]): void {
  if (typeof f.confidence !== "number" || f.confidence < 0 || f.confidence > 1) {
    errors.push(`${path}: confidence must be in [0,1]`);
  }
  if (!PROVENANCES.has(f.provenance)) errors.push(`${path}: invalid provenance "${String(f.provenance)}"`);
}

/** A distribution measurement (px gap, font size, radius, proportion) must be a finite, non-negative number. */
function checkNonNegative(path: string, n: unknown, errors: string[]): void {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    errors.push(`${path}: must be a finite number >= 0`);
  }
}

/**
 * Validate a snapshot's structural invariants: schema version, approval state,
 * and that every stamped fact has a legal confidence + provenance. Pure; the
 * full field-by-field contract grows with the extractors (UD1+).
 */
export function validateSnapshot(snapshot: DnaSnapshot): ValidationResult {
  const errors: string[] = [];
  if (snapshot.metadata.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`unsupported schemaVersion "${snapshot.metadata.schemaVersion}" (expected "${SCHEMA_VERSION}")`);
  }
  if (!["draft", "in_review", "approved"].includes(snapshot.metadata.approvalState)) {
    errors.push(`invalid approvalState "${snapshot.metadata.approvalState}"`);
  }

  const id = snapshot.identity;
  for (const [k, f] of [["name", id.name], ["audience", id.audience], ["tone", id.tone]] as const) {
    if (f) checkFact(`identity.${k}`, f, errors);
  }
  id.dos.forEach((f, i) => checkFact(`identity.dos[${i}]`, f, errors));
  id.donts.forEach((f, i) => checkFact(`identity.donts[${i}]`, f, errors));

  for (const group of ["color", "typography", "spacing", "radii", "shadows", "breakpoints", "motion"] as const) {
    for (const [token, f] of Object.entries(snapshot.tokens[group])) {
      checkFact(`tokens.${group}.${token}`, f, errors);
    }
  }
  snapshot.components.forEach((c, i) => {
    if (typeof c.confidence !== "number" || c.confidence < 0 || c.confidence > 1) {
      errors.push(`components[${i}]: confidence must be in [0,1]`);
    }
    if (!PROVENANCES.has(c.provenance)) errors.push(`components[${i}]: invalid provenance`);
  });

  // Rendered anchors carry a provenance (always "pixels" from the render extractor,
  // but a hand-built or wire-decoded snapshot could carry a bad one).
  snapshot.anchors.forEach((a, i) => {
    if (!PROVENANCES.has(a.provenance)) errors.push(`anchors[${i}]: invalid provenance "${String(a.provenance)}"`);
  });

  // Visual distributions are numeric observations (PRD §5): measurements are
  // finite and non-negative, and color proportions are proportions in [0,1].
  const d = snapshot.distributions;
  d.spacingIntervals.forEach((n, i) => checkNonNegative(`distributions.spacingIntervals[${i}]`, n, errors));
  d.typeScale.forEach((n, i) => checkNonNegative(`distributions.typeScale[${i}]`, n, errors));
  d.radiusPatterns.forEach((n, i) => checkNonNegative(`distributions.radiusPatterns[${i}]`, n, errors));
  for (const [k, v] of Object.entries(d.colorProportions)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
      errors.push(`distributions.colorProportions["${k}"]: must be a proportion in [0,1]`);
    }
  }
  if (d.density !== null) checkNonNegative("distributions.density", d.density, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
