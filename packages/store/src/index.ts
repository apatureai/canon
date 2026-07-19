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
export { getSnapshot } from "./read-api.js";
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
