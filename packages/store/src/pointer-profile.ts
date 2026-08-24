import { createHash } from "node:crypto";
import { canonicalize } from "@apatureai/canon-context";
import { isApproved, validateSnapshot, type DnaSnapshot, type Fact, type Provenance } from "@apatureai/canon-schema";
import { getSnapshot } from "./read-api.js";
import type { SnapshotStore } from "./store.js";

/** Release-controlled Pointer read-profile version. Bump on incompatible changes. */
export const POINTER_LOCAL_CHECK_PROFILE_VERSION = "1";

export interface ApprovedDnaAuthority {
  authority: "approved_ui_dna";
  /** Canonical snapshot path that supplied the fact. */
  path: string;
  provenance?: Provenance;
  confidence?: number;
}

export interface PolicyDefaultAuthority {
  authority: "policy_default";
  /** Standards/policy identifier; never represented as a team preference. */
  policyId: string;
  policyVersion: string;
}

export interface PointerProfileColorToken {
  id: string;
  hex: string;
  source: ApprovedDnaAuthority;
}

export interface PointerProfileScale {
  id: string;
  stepsPx: number[];
  tolerancePx: number;
  source: ApprovedDnaAuthority;
}

export interface PointerProfileComponentHint {
  id: string;
  signature: string;
  name: string;
  source: ApprovedDnaAuthority;
}

export interface PointerProfileTargetSize {
  id: string;
  minWidthPx: number;
  minHeightPx: number;
  source: PolicyDefaultAuthority;
}

export interface PointerProfileContrast {
  id: string;
  minRatio: number;
  minRatioLargeText: number;
  source: PolicyDefaultAuthority;
}

export interface PointerCompactIndexes {
  colorTokens: PointerProfileColorToken[];
  spacingScale?: PointerProfileScale;
  radiusScale?: PointerProfileScale;
  typeScale?: PointerProfileScale;
  /**
   * Empty until the canonical genome carries an explicit stable component
   * signature. A hash guessed from a convention would not match rendered facts.
   */
  components: PointerProfileComponentHint[];
  targetSize: PointerProfileTargetSize;
  contrast: PointerProfileContrast;
}

export interface PointerLocalCheckProfile {
  schemaVersion: string;
  profileVersion: string;
  repo: string;
  dnaVersion: string;
  /** SHA-256 over the canonical profile with this field omitted. */
  contentDigest: string;
  compactIndexes: PointerCompactIndexes;
}

export interface GetPointerProfileOptions {
  /** Pin an immutable approved DNA version. Latest approved is the default. */
  dnaVersion?: string;
  /** Fail-closed version negotiation. Only the current version is accepted. */
  profileVersion?: string;
}

export class UnsupportedPointerProfileVersionError extends Error {
  constructor(version: string) {
    super(`unsupported Pointer local-check profile version "${version}"`);
    this.name = "UnsupportedPointerProfileVersionError";
  }
}

export class UnapprovedPointerProfileError extends Error {
  constructor() {
    super("Pointer local-check profiles may be projected only from approved UI DNA");
    this.name = "UnapprovedPointerProfileError";
  }
}

export class InvalidPointerProfileSourceError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`invalid Pointer local-check profile source: ${errors.join("; ")}`);
    this.name = "InvalidPointerProfileSourceError";
    this.errors = errors;
  }
}

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#[0-9a-f]{6}$/i;

function normalizeHex(value: string): string | null {
  if (HEX6.test(value)) return value.toLowerCase();
  const short = HEX3.exec(value);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase() : null;
}

function approvedSource(path: string, fact?: Fact<unknown>): ApprovedDnaAuthority {
  return {
    authority: "approved_ui_dna",
    path,
    ...(fact ? { provenance: fact.provenance, confidence: fact.confidence } : {}),
  };
}

function colorTokens(snapshot: DnaSnapshot): PointerProfileColorToken[] {
  return Object.entries(snapshot.tokens.color)
    .flatMap(([name, fact]) => {
      const hex = normalizeHex(fact.value);
      return hex
        ? [{ id: `tokens.color.${name}`, hex, source: approvedSource(`tokens.color.${name}`, fact) }]
        : [];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function scale(id: string, values: number[]): PointerProfileScale | undefined {
  const stepsPx = [...new Set(values.filter((n) => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b);
  if (stepsPx.length === 0) return undefined;
  return { id, stepsPx, tolerancePx: 0.5, source: approvedSource(id) };
}

function compactIndexes(snapshot: DnaSnapshot): PointerCompactIndexes {
  const spacingScale = scale("distributions.spacingIntervals", snapshot.distributions.spacingIntervals);
  const radiusScale = scale("distributions.radiusPatterns", snapshot.distributions.radiusPatterns);
  const typeScale = scale("distributions.typeScale", snapshot.distributions.typeScale);
  return {
    colorTokens: colorTokens(snapshot),
    ...(spacingScale ? { spacingScale } : {}),
    ...(radiusScale ? { radiusScale } : {}),
    ...(typeScale ? { typeScale } : {}),
    // ComponentConvention has no stable rendered signature. Do not invent one.
    components: [],
    // These are explicit product-policy defaults, not claimed team preferences.
    targetSize: {
      id: "policy.wcag-2.2-aa.target-size",
      minWidthPx: 24,
      minHeightPx: 24,
      source: { authority: "policy_default", policyId: "WCAG-SC-2.5.8", policyVersion: "2.2" },
    },
    contrast: {
      id: "policy.wcag-2.2-aa.contrast",
      minRatio: 4.5,
      minRatioLargeText: 3,
      source: { authority: "policy_default", policyId: "WCAG-SC-1.4.3", policyVersion: "2.2" },
    },
  };
}

type UnsignedPointerProfile = Omit<PointerLocalCheckProfile, "contentDigest">;

/** Canonical bytes Pointer verifies before using any cited rule. */
export function serializePointerLocalCheckProfile(profile: UnsignedPointerProfile): string {
  return JSON.stringify(canonicalize(profile));
}

export function computePointerLocalCheckProfileDigest(profile: UnsignedPointerProfile): string {
  return `sha256:${createHash("sha256").update(serializePointerLocalCheckProfile(profile)).digest("hex")}`;
}

/** Pure projection from one approved immutable snapshot. */
export function projectPointerLocalCheckProfile(
  snapshot: DnaSnapshot,
  repo: string,
  dnaVersion: string,
): PointerLocalCheckProfile {
  if (!isApproved(snapshot)) throw new UnapprovedPointerProfileError();
  const errors: string[] = [];
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) errors.push(...validation.errors);
  const snapshotRepo = `${snapshot.repository.owner}/${snapshot.repository.name}`;
  if (repo !== snapshotRepo) errors.push(`repo "${repo}" does not match snapshot repository "${snapshotRepo}"`);
  if (dnaVersion !== snapshot.metadata.dnaVersion) {
    errors.push(`dnaVersion "${dnaVersion}" does not match snapshot version "${snapshot.metadata.dnaVersion}"`);
  }
  if (errors.length > 0) throw new InvalidPointerProfileSourceError(errors);
  const unsigned: UnsignedPointerProfile = {
    schemaVersion: snapshot.metadata.schemaVersion,
    profileVersion: POINTER_LOCAL_CHECK_PROFILE_VERSION,
    repo,
    dnaVersion,
    compactIndexes: compactIndexes(snapshot),
  };
  return { ...unsigned, contentDigest: computePointerLocalCheckProfileDigest(unsigned) };
}

/**
 * Publish the latest (or pinned) approved genome as Pointer's local-check read
 * profile. Draft/in-review records never project because `getSnapshot` owns the
 * approval gate. Unsupported profile versions fail closed.
 */
export async function getPointerLocalCheckProfile(
  store: SnapshotStore,
  repo: string,
  opts: GetPointerProfileOptions = {},
): Promise<PointerLocalCheckProfile | null> {
  const requested = opts.profileVersion ?? POINTER_LOCAL_CHECK_PROFILE_VERSION;
  if (requested !== POINTER_LOCAL_CHECK_PROFILE_VERSION) {
    throw new UnsupportedPointerProfileVersionError(requested);
  }
  const response = await getSnapshot(store, repo, { version: opts.dnaVersion });
  if (!response) return null;
  return projectPointerLocalCheckProfile(response.snapshot, response.repo, response.dnaVersion);
}
