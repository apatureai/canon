/**
 * Canonical UI DNA schema (PRD §5). The versioned design genome a repo is
 * extracted into: product identity, tokens, component conventions, visual
 * distributions, rendered anchors, and exceptions. EVERY inferred field carries
 * its **confidence** and **provenance** (where it came from) so downstream
 * products (Gate, MCP Review, Entropy Engine, Source of Truth, DNA Consultant)
 * can weight it and surface it for human sign-off. That traceability is the
 * moat, not the extraction itself.
 *
 * `SCHEMA_VERSION` is bumped on any breaking change; the schema evolves
 * additive-only within a version so downstream consumers read it like a stable
 * contract (the way Gate reads the engine's golden wire fixture).
 */
export const SCHEMA_VERSION = "1";

/** Where a fact came from (PRD §5: "code, rendered pixels, config, human, or feedback"). */
export type Provenance = "code" | "pixels" | "config" | "human" | "feedback";

/** A single extracted fact with its confidence (0..1) and provenance. */
export interface Fact<T> {
  value: T;
  /** 0..1; how sure the extractor is. Human-confirmed facts are 1. */
  confidence: number;
  provenance: Provenance;
}

/**
 * A recorded reconciliation conflict (PRD §5/§7): two or more evidence sources
 * disagreed on one logical field, and the reconciler kept the higher-trust
 * value while surfacing the disagreement for sign-off / drift. The trail is the
 * moat: downstream can show "code says X, pixels say Y" instead of silently
 * picking one. Additive to the schema; produced by `@uidna/reconcile`.
 */
export interface Conflict {
  /** Logical field this conflict is about, e.g. "tokens.color.--brand". */
  field: string;
  /** Every candidate value + its provenance + confidence that was considered. */
  candidates: { value: string; provenance: Provenance; confidence: number }[];
  /** Provenance of the candidate whose VALUE won. */
  winner: Provenance;
  /**
   * Change in resolved confidence vs the winning candidate alone: positive when
   * agreement reinforced it, negative when disagreement degraded it.
   */
  confidenceDelta: number;
}

/** Approval lifecycle for a snapshot (PRD §4: human sign-off workflow). */
export type ApprovalState = "draft" | "in_review" | "approved";

/** Product identity (PRD §5): name, audience, tone, explicit dos/don'ts. */
export interface ProductIdentity {
  name: Fact<string> | null;
  audience: Fact<string> | null;
  tone: Fact<string> | null;
  dos: Fact<string>[];
  donts: Fact<string>[];
}

/** Design tokens (PRD §5). Each token value is a confidence/provenance-stamped fact. */
export interface DnaTokens {
  color: Record<string, Fact<string>>;
  typography: Record<string, Fact<string>>;
  spacing: Record<string, Fact<string>>;
  radii: Record<string, Fact<string>>;
  shadows: Record<string, Fact<string>>;
  breakpoints: Record<string, Fact<string>>;
  /** Motion tokens when available (PRD §5: "motion if available"). */
  motion: Record<string, Fact<string>>;
}

/** A canonical component convention: primitive, variants, props, usage examples. */
export interface ComponentConvention {
  name: string;
  variants: string[];
  props: string[];
  usageExamples: string[];
  confidence: number;
  provenance: Provenance;
}

/** Observed visual distributions (PRD §5): common spacing/type/density/color/radius patterns. */
export interface VisualDistributions {
  spacingIntervals: number[];
  typeScale: number[];
  /** Proportional color usage, e.g. { "#0a0a0a": 0.42 }. */
  colorProportions: Record<string, number>;
  radiusPatterns: number[];
  /** Content density signal (e.g. elements per viewport), when computed. */
  density: number | null;
}

/** A rendered anchor: a screenshot/crop demonstrating a canonical pattern. */
export interface RenderedAnchor {
  /** Object-storage reference to the screenshot/crop (bytes are NOT stored here). */
  ref: string;
  route: string;
  description: string;
  provenance: Provenance;
}

/** A surface where the standard intentionally differs (PRD §5: exceptions). */
export interface DnaException {
  route: string;
  reason: string;
}

export interface DnaMetadata {
  schemaVersion: string;
  /**
   * Immutable stored-record version. Bumps when the genome, causal extraction
   * stamps, or approval lifecycle state changes.
   */
  dnaVersion: string;
  /** Extraction-pipeline version that produced it (determinism stamp, PRD §7). */
  extractionVersion: string;
  /** Model version used for rendered/visual inference, when any. */
  modelVersion: string | null;
  approvalState: ApprovalState;
}

/** A full versioned UI DNA snapshot for one repository. */
export interface DnaSnapshot {
  repository: { owner: string; name: string };
  identity: ProductIdentity;
  tokens: DnaTokens;
  components: ComponentConvention[];
  distributions: VisualDistributions;
  anchors: RenderedAnchor[];
  exceptions: DnaException[];
  metadata: DnaMetadata;
}
