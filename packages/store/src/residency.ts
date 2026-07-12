import type { DnaSnapshot, Fact, ProductIdentity, RenderedAnchor } from "@uidna/schema";
import { computeSnapshotContentDigest, getSnapshot, type SnapshotResponse } from "./read-api.js";
import type { SnapshotStore } from "./store.js";

/**
 * Genome residency / security policy layer (#30, PRD §8). A PURE policy layer
 * over the #25 read contract that enforces the genome's privacy guardrails
 * before a snapshot leaves the store:
 *
 * - READ-ONLY: the layer only reads (`getSnapshot`) and returns a deep-cloned,
 *   scrubbed snapshot — there is NO write path back into the store, and the
 *   served copy is a clone so a consumer can't mutate the immutable version
 *   (a test asserts mutating the served snapshot doesn't touch the store).
 * - TENANT-SCOPING: a tenant may only read repos it's entitled to; a request
 *   for an unentitled repo is denied (null) regardless of approval state.
 * - SCRUBBING: secrets/PII matched in served Fact values, identity strings, and
 *   anchor descriptions are redacted before serving (no private source content
 *   leaves; anchors already store only object-storage `ref`s, not bytes).
 * - RETENTION: anchor `ref`s + capture evidence are bound to the customer's
 *   tier — the free/default tier serves NO anchor refs (0 retention); paid
 *   tiers serve them within the window. Consistent with engine #51 retention.
 * - ROUTE ALLOW/DENY: the customer's anchor-eligibility list (#17) is honored
 *   end-to-end — a served anchor on a denied route is dropped.
 * - PROVENANCE LOGGING: an injected logger records WHO read WHAT version
 *   without leaking private source content (only repo + version + counts).
 *
 * Self-hosted extraction seam: this layer takes an injected `SnapshotStore`
 * port and a `ResidencyPolicy` value — no managed-only assumptions — so the
 * same enforcement runs in-VPC against a self-hosted store (mirrors engine #79).
 */

/** Retention tier for screenshot/anchor evidence (PRD §8: retention follows the customer tier). */
export type RetentionTier = "none" | "retained";

/** A redacting access-log sink. Receives only non-sensitive metadata — never source content. */
export type AccessLogger = (event: AccessLogEvent) => void;

/** What an access produced — safe to log (no fact values, selectors, or source). */
export interface AccessLogEvent {
  tenantId: string;
  repo: string;
  /** "served" once a snapshot was returned, "denied" when policy blocked it. */
  outcome: "served" | "denied";
  /** Present only when served. */
  dnaVersion?: string;
  /** Reason for a denial (no source content). */
  reason?: "not_entitled" | "no_approved_snapshot";
  /** Count of anchors served after retention/allow-deny (not their refs). */
  anchorCount?: number;
  /** Count of fact values redacted by scrubbing (not the values). */
  redactedCount?: number;
}

/** The per-customer residency policy applied to every read. Pure data; no IO. */
export interface ResidencyPolicy {
  tenantId: string;
  /** Repos this tenant may read ("owner/name"). A read outside this set is denied. */
  entitledRepos: string[];
  /** Anchor/capture retention tier. "none" (default) serves no anchor refs. */
  retention: RetentionTier;
  /** If set, only anchors on these routes are eligible (allow-list, #17). */
  allowRoutes?: string[];
  /** Routes whose anchors are never served (deny-list, applied after allow). */
  denyRoutes?: string[];
  /**
   * Extra redaction patterns (in addition to the built-in secret/PII set).
   * Matches in fact/identity/description strings are replaced with the marker.
   */
  redactPatterns?: RegExp[];
}

export interface ResidencyOptions {
  /** Pin a specific approved version; default is the latest approved. */
  version?: string;
  /** Optional access-log sink; receives redacted metadata only. */
  log?: AccessLogger;
}

const REDACTION_MARKER = "[redacted]";

/**
 * Built-in secret/PII signatures redacted from every served string. Conservative
 * and deterministic — common token/key prefixes, bearer headers, emails, and
 * private-key blocks. Customer policies can add more via `redactPatterns`.
 */
const BUILTIN_REDACTIONS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{16,}\b/g, // OpenAI-style secret keys
  /\bghp_[A-Za-z0-9]{20,}\b/g, // GitHub personal tokens
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, // bearer auth headers
  /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g, // PEM private keys
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // emails (PII)
];

interface Scrubber {
  /** Redact a string; returns the scrubbed string and whether anything changed. */
  scrub(value: string): { value: string; redacted: boolean };
}

function makeScrubber(extra: RegExp[] = []): Scrubber {
  const patterns = [...BUILTIN_REDACTIONS, ...extra];
  return {
    scrub(value: string) {
      let out = value;
      for (const p of patterns) {
        // Reset lastIndex so a shared /g regex is reusable across calls.
        p.lastIndex = 0;
        out = out.replace(p, REDACTION_MARKER);
      }
      return { value: out, redacted: out !== value };
    },
  };
}

/**
 * Scrub a string Fact into a fresh (always-cloned) Fact, counting a redaction
 * when the value changed. Always cloning keeps the served snapshot a true deep
 * copy — a consumer can mutate it without ever reaching the frozen store object.
 */
function scrubFact(f: Fact<string>, s: Scrubber, count: { n: number }): Fact<string> {
  const { value, redacted } = s.scrub(f.value);
  if (redacted) count.n++;
  return { ...f, value };
}

function scrubFactOrNull(f: Fact<string> | null, s: Scrubber, count: { n: number }): Fact<string> | null {
  return f === null ? null : scrubFact(f, s, count);
}

/** Scrub a bare string (identifier or prose), counting a redaction when it changed. */
function scrubString(value: string, s: Scrubber, count: { n: number }): string {
  const { value: scrubbed, redacted } = s.scrub(value);
  if (redacted) count.n++;
  return scrubbed;
}

/** Scrub the KEYS of a numeric map (e.g. colorProportions hex keys), values kept. */
function scrubKeys(rec: Record<string, number>, s: Scrubber, count: { n: number }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)) out[scrubString(k, s, count)] = v;
  return out;
}

/**
 * Scrub a token record's VALUES *and KEYS*: a token NAME (e.g. `--leak-sk-...`)
 * is served verbatim downstream, so a secret pattern in the key must be redacted
 * too. Keys are re-collated after scrubbing (a collision after redaction keeps
 * the last entry — deterministic over `Object.entries` order).
 */
function scrubRecord(
  rec: Record<string, Fact<string>>,
  s: Scrubber,
  count: { n: number },
): Record<string, Fact<string>> {
  const out: Record<string, Fact<string>> = {};
  for (const [k, f] of Object.entries(rec)) {
    out[scrubString(k, s, count)] = scrubFact(f, s, count);
  }
  return out;
}

function scrubIdentity(id: ProductIdentity, s: Scrubber, count: { n: number }): ProductIdentity {
  return {
    name: scrubFactOrNull(id.name, s, count),
    audience: scrubFactOrNull(id.audience, s, count),
    tone: scrubFactOrNull(id.tone, s, count),
    dos: id.dos.map((f) => scrubFact(f, s, count)),
    donts: id.donts.map((f) => scrubFact(f, s, count)),
  };
}

/** Scrub an anchor's description (every other field is an opaque ref/route). */
function scrubAnchor(a: RenderedAnchor, s: Scrubber, count: { n: number }): RenderedAnchor {
  return { ...a, route: scrubString(a.route, s, count), description: scrubString(a.description, s, count) };
}

/** Retention + allow/deny applied to anchors (descriptions are scrubbed by the field scrub). */
function retainAnchors(anchors: RenderedAnchor[], policy: ResidencyPolicy): RenderedAnchor[] {
  if (policy.retention === "none") return []; // 0-retention tier serves no anchor refs
  return anchors.filter((a) => {
    if (policy.allowRoutes && !policy.allowRoutes.includes(a.route)) return false;
    if (policy.denyRoutes && policy.denyRoutes.includes(a.route)) return false;
    return true;
  });
}

/**
 * Field-level scrub of a whole snapshot into a deep-cloned, secret/PII-free copy
 * — EVERY served-verbatim field (token keys + values, identity strings, component
 * name/variants/props/usageExamples, anchor route/description, exception
 * route/reason) is run through the scrubber. Tenant/retention/route policy is
 * NOT applied here (that's residency-specific); this is the shared trust-boundary
 * scrub both `getResidentSnapshot` and the engine-facing retrieval compose over.
 */
function scrubSnapshotWith(
  snapshot: DnaSnapshot,
  s: Scrubber,
): { snapshot: DnaSnapshot; redactedCount: number } {
  const count = { n: 0 };
  const scrubbed: DnaSnapshot = {
    // repository.owner/name is the caller-supplied lookup id (structurally non-
    // secret) — scrubbed too so the "zero secret-pattern egress in ANY served
    // field" guarantee is literal.
    repository: {
      owner: scrubString(snapshot.repository.owner, s, count),
      name: scrubString(snapshot.repository.name, s, count),
    },
    identity: scrubIdentity(snapshot.identity, s, count),
    tokens: {
      color: scrubRecord(snapshot.tokens.color, s, count),
      typography: scrubRecord(snapshot.tokens.typography, s, count),
      spacing: scrubRecord(snapshot.tokens.spacing, s, count),
      radii: scrubRecord(snapshot.tokens.radii, s, count),
      shadows: scrubRecord(snapshot.tokens.shadows, s, count),
      breakpoints: scrubRecord(snapshot.tokens.breakpoints, s, count),
      motion: scrubRecord(snapshot.tokens.motion, s, count),
    },
    components: snapshot.components.map((c) => ({
      ...c,
      // A component NAME / variant / prop / usage example is served verbatim, so
      // a secret pattern in any of them must be scrubbed (not just usageExamples).
      name: scrubString(c.name, s, count),
      variants: c.variants.map((v) => scrubString(v, s, count)),
      props: c.props.map((p) => scrubString(p, s, count)),
      usageExamples: c.usageExamples.map((u) => scrubString(u, s, count)),
    })),
    distributions: {
      ...snapshot.distributions,
      spacingIntervals: [...snapshot.distributions.spacingIntervals],
      typeScale: [...snapshot.distributions.typeScale],
      // colorProportions KEYS (hex-color strings) are served verbatim — scrub
      // them too so the zero-egress guarantee covers every served string.
      colorProportions: scrubKeys(snapshot.distributions.colorProportions, s, count),
      radiusPatterns: [...snapshot.distributions.radiusPatterns],
    },
    anchors: snapshot.anchors.map((a) => scrubAnchor(a, s, count)),
    // An exception route/reason is served verbatim — scrub both.
    exceptions: snapshot.exceptions.map((e) => ({
      route: scrubString(e.route, s, count),
      reason: scrubString(e.reason, s, count),
    })),
    metadata: { ...snapshot.metadata },
  };
  return { snapshot: scrubbed, redactedCount: count.n };
}

/**
 * Public field-level scrub: deep-clone a snapshot with every served-verbatim
 * field stripped of secret/PII patterns (built-in set + optional `extraPatterns`).
 * Tenant/retention/route policy is the caller's concern. The engine-facing
 * retrieval surface composes this so the genome never reaches a model unscrubbed.
 */
export function scrubSnapshot(snapshot: DnaSnapshot, extraPatterns: RegExp[] = []): DnaSnapshot {
  return scrubSnapshotWith(snapshot, makeScrubber(extraPatterns)).snapshot;
}

/** Deep-clone + scrub + apply tenant retention/allow-deny into a served copy. */
function toResidentSnapshot(
  snapshot: DnaSnapshot,
  policy: ResidencyPolicy,
  s: Scrubber,
): { snapshot: DnaSnapshot; redactedCount: number } {
  const { snapshot: scrubbed, redactedCount } = scrubSnapshotWith(snapshot, s);
  // Retention/allow-deny over the already-scrubbed anchors (filter only — never unredacts).
  return { snapshot: { ...scrubbed, anchors: retainAnchors(scrubbed.anchors, policy) }, redactedCount };
}

/** Whether a tenant is entitled to read a repo. The only access gate besides approval. */
export function isEntitled(policy: ResidencyPolicy, repo: string): boolean {
  return policy.entitledRepos.includes(repo);
}

/**
 * Read a repo's approved snapshot under a residency policy: enforces tenant
 * entitlement, then scrubs secrets/PII, applies anchor retention + route
 * allow/deny, and returns a deep-cloned (store-safe) `SnapshotResponse`. Returns
 * null when the tenant isn't entitled or no approved snapshot exists — a draft
 * is never served (the read contract's `isApproved` gate still applies). Logs
 * redacted access metadata when a `log` sink is given. No write path exists.
 */
export async function getResidentSnapshot(
  store: SnapshotStore,
  policy: ResidencyPolicy,
  repo: string,
  opts: ResidencyOptions = {},
): Promise<SnapshotResponse | null> {
  if (!isEntitled(policy, repo)) {
    opts.log?.({ tenantId: policy.tenantId, repo, outcome: "denied", reason: "not_entitled" });
    return null;
  }

  const response = await getSnapshot(store, repo, { version: opts.version });
  if (!response) {
    opts.log?.({ tenantId: policy.tenantId, repo, outcome: "denied", reason: "no_approved_snapshot" });
    return null;
  }

  const scrubber = makeScrubber(policy.redactPatterns);
  const { snapshot, redactedCount } = toResidentSnapshot(response.snapshot, policy, scrubber);

  opts.log?.({
    tenantId: policy.tenantId,
    repo,
    outcome: "served",
    dnaVersion: response.dnaVersion,
    anchorCount: snapshot.anchors.length,
    redactedCount,
  });

  return {
    contract: response.contract,
    repo: response.repo,
    dnaVersion: response.dnaVersion,
    contentDigest: computeSnapshotContentDigest(snapshot),
    snapshot,
  };
}
