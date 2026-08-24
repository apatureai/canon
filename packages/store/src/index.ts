export {
  STORE_VERSION,
  computeDnaVersion,
  serializeForVersion,
  serializeGenomeContent,
} from "./version-identity.js";
export type { CausalStamps, LifecycleStamp } from "./version-identity.js";
export type { StoredSnapshot, SnapshotStore, CommitResult } from "./store.js";
export { commitSnapshot, inMemorySnapshotStore } from "./store.js";
export type { ReviewDecision, ReviewDecisions, ApproveResult } from "./sign-off.js";
export {
  canTransition,
  requestReview,
  rejectReview,
  applyReviewDecisions,
  approveSnapshot,
} from "./sign-off.js";
export type { ContractVersion, SnapshotResponse, GetSnapshotOptions, AuthorityStatusResolver } from "./read-api.js";
export { getSnapshot, computeSnapshotContentDigest } from "./read-api.js";
export type {
  AuthorityStatus,
  RevocationReason,
  AuthorityKey,
  AuthorityActor,
  AuthorityEvent,
  AuthorityRejectReason,
  AppendResult,
  ReadMode,
  AuthorityReadDecision,
  AuthorityStatusResponse,
  AuthorityStore,
} from "./authority.js";
export {
  AUTHORITY_CONTRACT_VERSION,
  hashAuthorityEvent,
  appendAuthorityEvent,
  resolveAuthorityStatus,
  authorizeRead,
  authorityKeyString,
  inMemoryAuthorityStore,
} from "./authority.js";
export type {
  ApatureAgentCardV1,
  CardStatus,
  CardSafety,
  CardCapability,
  CardTenancy,
  CardAuth,
  CardObservability,
} from "./agent-card.js";
export {
  AGENT_CARD_VERSION,
  buildUiDnaAgentCard,
  serializeAgentCard,
  computeAgentCardDigest,
  assertReadOnlyCard,
  UnsafeAgentCardError,
} from "./agent-card.js";
export type {
  ApprovedDnaAuthority,
  PolicyDefaultAuthority,
  PointerProfileColorToken,
  PointerProfileScale,
  PointerProfileComponentHint,
  PointerProfileTargetSize,
  PointerProfileContrast,
  PointerCompactIndexes,
  PointerLocalCheckProfile,
  GetPointerProfileOptions,
} from "./pointer-profile.js";
export {
  POINTER_LOCAL_CHECK_PROFILE_VERSION,
  UnsupportedPointerProfileVersionError,
  UnapprovedPointerProfileError,
  InvalidPointerProfileSourceError,
  serializePointerLocalCheckProfile,
  computePointerLocalCheckProfileDigest,
  projectPointerLocalCheckProfile,
  getPointerLocalCheckProfile,
} from "./pointer-profile.js";
export type { FlatToken } from "./consumer-tokens.js";
export { flattenTokens } from "./consumer-tokens.js";
export type {
  VerdictApprovalState,
  VerdictItem,
  VerdictSnapshot,
  VerdictDnaProfile,
  GetVerdictProfileOptions,
} from "./verdict-profile.js";
export {
  VERDICT_DNA_PROFILE_VERSION,
  UnsupportedVerdictProfileVersionError,
  UnapprovedVerdictProfileError,
  InvalidVerdictProfileSourceError,
  serializeVerdictDnaProfile,
  computeVerdictDnaProfileDigest,
  projectVerdictDnaProfile,
  getVerdictDnaProfile,
} from "./verdict-profile.js";
export type {
  LatticeState,
  LatticeToken,
  LatticeDnaProfile,
  GetLatticeProfileOptions,
} from "./lattice-profile.js";
export {
  LATTICE_PROJECTION_SCHEMA_VERSION,
  UnsupportedLatticeProfileVersionError,
  UnapprovedLatticeProfileError,
  InvalidLatticeProfileSourceError,
  serializeLatticeDnaProfile,
  projectLatticeDnaProfile,
  getLatticeDnaProfile,
} from "./lattice-profile.js";
export type { ChangeKind, FieldChange, SnapshotDiff } from "./diff.js";
export { diffSnapshots } from "./diff.js";
export type {
  GenomeQuery,
  RetrieveOptions,
  AnnotatedException,
  GenomeSlice,
} from "./retrieval.js";
export { retrieveGenomeSlice, retrieveRawGenomeSlice } from "./retrieval.js";
export type {
  RetentionTier,
  AccessLogger,
  AccessLogEvent,
  ResidencyPolicy,
  ResidencyOptions,
} from "./residency.js";
export { isEntitled, getResidentSnapshot, scrubSnapshot } from "./residency.js";
export type { AnnotatedDriftHint } from "./exceptions.js";
export {
  addException,
  removeException,
  isExcepted,
  annotateDriftWithExceptions,
  raisedDrift,
} from "./exceptions.js";

export {
  computeDesignCodeDrift,
  driftFromEntries,
  DESIGN_CODE_DRIFT_VERSION,
  type TokenGroup,
  type DriftKind,
  type DriftEntry,
  type DesignCodeDrift,
} from "./drift.js";
export {
  evaluateDriftGate,
  DEFAULT_DRIFT_GATE_POLICY,
  type DriftGatePolicy,
  type DriftGateVerdict,
} from "./drift.js";

// Drift delta (PRD §4/§7): the base-vs-head diff that makes the drift gate FAIR.
// Drift entries partition into introduced / resolved / persisting, and the
// verdict gates on the INTRODUCED set only (a change never blocks on pre-existing
// design-code debt). Drift entries have a natural group+name+kind key; the key
// is a policy input for stricter matching.
export {
  diffDrift,
  defaultDriftKey,
  type DriftKey,
  type DriftDeltaOptions,
  type DriftDelta,
} from "./drift-delta.js";

// Drift remediation: the agent-actionable output of the drift gate.
// Each gated drift entry projected into a cited, eyes-not-hands fix instruction
// ("replace the hardcoded value with the design token"), partitioned blocking vs
// advisory. The drift-axis analog of the rendered-review fix spec. Composes evaluateDriftGate.
export {
  buildDriftRemediation,
  driftRemediationToAxisFixItems,
  type DriftAction,
  type DriftRemediation,
  type DriftRemediationPlan,
  type AxisFixItem,
} from "./drift-remediation.js";

// Drift gate node (agentic-SDLC graph): the drift axis as a CONDITIONAL node,
// with the fair drift verdict + routing edge (fix vs proceed) + the cited remediation
// back-edge for the introduced drift. Composes diffDrift + buildDriftRemediation.
export {
  evaluateDriftGateNode,
  type DriftGateRoute,
  type DriftGateNodePolicy,
  type DriftGateNodeResult,
} from "./drift-gate-node.js";

// Drift comment (delivery parity): the human-readable PR comment for the drift
// gate, the drift-axis sibling of the rendered-review comment. Introduced drift
// headlined by the design token it broke; pre-existing counted, not gated.
export { renderDriftComment } from "./drift-comment.js";

// Design-source drift gate: the end-to-end capability.
// Parse a design-tool DTCG export into a design genome and gate the code genome's
// drift against it (+ a fair base-vs-head delta variant). Refuses to gate a
// fundamentally malformed export (would flag everything) rather than mislead.
export {
  reviewDesignSourceDrift,
  reviewDesignSourceDriftDelta,
  BLOCKING_DESIGN_DIAGNOSTICS,
  type DesignSourceDriftOutcome,
  type DesignSourceGate,
  type InvalidDesignSource,
  type DesignSourceDriftDelta,
  type DesignSourceDriftDeltaOutcome,
} from "./design-source-drift.js";

// D2: design-source provenance enforcement. The drift gate keeps blocking
// authority only when the design export's provenance meets a verification bar;
// below it, the verdict is softened to advisory (block→warn) or refused. Takes
// the drift outcome as input (dependency inversion); only ever REMOVES authority,
// never adds a block. Pure + deterministic.
export {
  enforceDesignSourceProvenance,
  enforceDesignSourceProvenanceDelta,
  provenanceMeetsBar,
  DEFAULT_PROVENANCE_POLICY,
  type ProvenanceVerification,
  type DesignSourceProvenance,
  type DesignSourceProvenancePolicy,
  type UnverifiedDesignSource,
  type AdvisoryDesignSourceGate,
  type VerifiedDesignSourceGate,
  type ProvenancedDriftOutcome,
  type VerifiedDesignSourceDelta,
  type AdvisoryDesignSourceDelta,
  type ProvenancedDriftDeltaOutcome,
} from "./design-source-provenance.js";
