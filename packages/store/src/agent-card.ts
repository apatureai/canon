import { SCHEMA_VERSION } from "@uidna/schema";
import { createHash } from "node:crypto";
import { STORE_VERSION } from "./version-identity.js";

/**
 * ui-dna A2A capability descriptor (#29; core #105 / INTEROP.md §2, ADR-001).
 *
 * Publishes ui-dna's `ApatureAgentCardV1` so sibling Apature surfaces (today the
 * DNA Consultant orchestrating Gate/Entropy/SoT) can DISCOVER and call the
 * genome read/grounding contract as an agent capability — without inventing a
 * second wire path to the genome (ADR-001 one-contract rule).
 *
 * The card is a DESCRIPTOR, not a permission grant, and not a runtime service:
 * per core's static-registry model it advertises the EXISTING contracts —
 *   - genome snapshot read  → `getSnapshot` / `SnapshotResponse` (read-api.ts)
 *   - genome-slice grounding → `retrieveGenomeSlice` / `GenomeSlice` (retrieval.ts)
 * — and stamps the same `@uidna/schema` + `@uidna/store` versions those
 * contracts already speak. It carries ZERO new capability.
 *
 * Status is `draft-unapproved`: core CAPABILITY-REGISTRY.md records ui-dna as
 * "Next candidate after contract promotion" with no approved card yet, so this
 * artifact exists for the eventual registration review to approve or reject —
 * it is build-later/gated, tracking (not duplicating) core #105's spec.
 */

export const AGENT_CARD_VERSION = "ApatureAgentCardV1" as const;

/** Registry status vocabulary (core INTEROP.md §3). ui-dna is `draft-unapproved`. */
export type CardStatus = "draft-unapproved" | "approved" | "deprecated";

/** Explicit safety declarations (INTEROP.md §2). ui-dna's A2A surface is read-only. */
export interface CardSafety {
  no_write: boolean;
  read_only_browser: boolean;
  no_model_calls: boolean;
}

/**
 * A named capability the card advertises. Each points at an EXISTING contract by
 * its input/output type names + speaks the stamped versions — no new wire path.
 */
export interface CardCapability {
  /** Named intent type, e.g. `genome.snapshot.read`. */
  intent: string;
  description: string;
  /** Input contract type advertised (an existing `@uidna` contract). */
  input: string;
  /** Output contract type advertised (an existing `@uidna` contract). */
  output: string;
  /** ui-dna A2A composition is strictly read-only. */
  access: "read_only";
}

export interface CardTenancy {
  scope: "global" | "per_tenant" | "per_deployment";
  /** ui-dna serves residency-scoped snapshots (see residency.ts). */
  residencyAware: boolean;
}

export interface CardAuth {
  /** Accepted token audience/resource. */
  audience: string;
  requiredScopes: readonly string[];
  delegationRequired: boolean;
}

export interface CardObservability {
  traceParentPropagation: boolean;
  minSpanAttributes: readonly string[];
}

/**
 * ui-dna's `ApatureAgentCardV1`, narrowed to Apature's product boundaries
 * (INTEROP.md §2: identity, endpoint binding, capabilities, contract versions,
 * tenancy, auth, safety, observability, signature).
 */
export interface ApatureAgentCardV1 {
  schemaVersion: typeof AGENT_CARD_VERSION;
  status: CardStatus;
  /** Whether this card is registered in the core static registry. False until approved. */
  registered: boolean;
  surface: "ui-dna";
  repo: string;
  issuer: string;
  cardVersion: string;
  environment: string;
  /** The exact contract versions this card's capabilities speak. */
  contractVersions: { schema: string; store: string };
  capabilities: readonly CardCapability[];
  tenancy: CardTenancy;
  auth: CardAuth;
  safety: CardSafety;
  observability: CardObservability;
  /** Claims ui-dna must NOT make as a callable surface (core CAPABILITY-REGISTRY.md). */
  forbidden: readonly string[];
  /** JWS signature (static-registry model). Absent until the card is signed for registration. */
  signature?: string;
}

/**
 * The forbidden-claim set from core CAPABILITY-REGISTRY.md for ui-dna: it may
 * publish approved genome/snapshot reads, but never these.
 */
const UI_DNA_FORBIDDEN = Object.freeze([
  "untrusted repo execution",
  "rendered capture",
  "raw artifact custody",
  "model calls",
  "eval promotion",
]);

/**
 * Build ui-dna's descriptor. Capabilities are typed against the existing read
 * (`SnapshotResponse`) and grounding (`GenomeSlice`) contracts; versions come
 * from the same constants those contracts stamp — the card can never drift from
 * the contract it advertises.
 */
export function buildUiDnaAgentCard(): ApatureAgentCardV1 {
  return {
    schemaVersion: AGENT_CARD_VERSION,
    status: "draft-unapproved",
    registered: false,
    surface: "ui-dna",
    repo: "apatureai/ui-dna",
    issuer: "apatureai/core",
    cardVersion: "1",
    environment: "unbound",
    contractVersions: { schema: SCHEMA_VERSION, store: STORE_VERSION },
    capabilities: [
      {
        intent: "genome.snapshot.read",
        description: "Read the versioned, APPROVED DnaSnapshot for a repo (latest approved or a pinned dnaVersion).",
        input: "GetSnapshotOptions",
        output: "SnapshotResponse",
        access: "read_only",
      },
      {
        intent: "genome.grounding.retrieve",
        description: "Retrieve grounding genome slices for judgment-engine critique.",
        input: "GenomeQuery",
        output: "GenomeSlice",
        access: "read_only",
      },
    ],
    tenancy: { scope: "per_tenant", residencyAware: true },
    auth: { audience: "apature://ui-dna", requiredScopes: ["genome:read"], delegationRequired: true },
    safety: { no_write: true, read_only_browser: true, no_model_calls: true },
    observability: { traceParentPropagation: true, minSpanAttributes: ["surface", "intent", "dnaVersion", "tenant"] },
    forbidden: UI_DNA_FORBIDDEN,
  };
}

/** RFC 8785-style canonical JSON (sorted keys) so the card digest is byte-stable. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/** Canonical serialization of a card (the exact bytes the registry digests + signs). */
export function serializeAgentCard(card: ApatureAgentCardV1): string {
  return canonicalize(card);
}

/** The `card_digest` a core registry entry pins (INTEROP.md §3). */
export function computeAgentCardDigest(card: ApatureAgentCardV1): string {
  return `sha256:${createHash("sha256").update(serializeAgentCard(card)).digest("hex")}`;
}

export class UnsafeAgentCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeAgentCardError";
  }
}

/**
 * Fail closed if a card violates ui-dna's registry safety class: every
 * capability must be read-only and the no-write / no-model-calls safety flags
 * must hold. Guards against a future edit accidentally advertising a write path
 * or model call the registry forbids.
 */
export function assertReadOnlyCard(card: ApatureAgentCardV1): ApatureAgentCardV1 {
  if (!card.safety.no_write) throw new UnsafeAgentCardError("ui-dna card must declare no_write");
  if (!card.safety.no_model_calls) throw new UnsafeAgentCardError("ui-dna card must declare no_model_calls");
  for (const cap of card.capabilities) {
    if (cap.access !== "read_only") {
      throw new UnsafeAgentCardError(`capability "${cap.intent}" must be read_only — ui-dna advertises no write path`);
    }
  }
  return card;
}
