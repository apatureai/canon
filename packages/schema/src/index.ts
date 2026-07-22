export { SCHEMA_VERSION } from "./dna.js";
export type {
  Provenance,
  Fact,
  Conflict,
  ApprovalState,
  ProductIdentity,
  DnaTokens,
  ComponentConvention,
  VisualDistributions,
  RenderedAnchor,
  DnaException,
  DnaMetadata,
  DnaSnapshot,
} from "./dna.js";
export { fact, emptyDraft, isApproved, validateSnapshot } from "./validate.js";
export type { ValidationResult } from "./validate.js";
// #97: the single shared colour canonicalizer (RFC-ish #rrggbbaa) used by both
// the drift gate (@uidna/store) and reconciliation (@uidna/reconcile) so they
// agree on "same colour?".
export { canonicalColor } from "./color-value.js";
