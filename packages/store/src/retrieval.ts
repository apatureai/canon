import type {
  ComponentConvention,
  DnaException,
  DnaSnapshot,
  DnaTokens,
  Fact,
  ProductIdentity,
  RenderedAnchor,
} from "@uidna/schema";
import { getSnapshot, type ContractVersion } from "./read-api.js";
import { scrubSnapshot } from "./residency.js";
import type { SnapshotStore } from "./store.js";

/**
 * Genome-grounding RETRIEVAL surface (#27, PRD §2/§4/§7). The PRODUCER side that
 * judgment-engine #104 consumes: given a review context (the routes / components
 * / token-groups a PR touches, the diff→route output of #7), return only the
 * RELEVANT slices of the approved genome (the tokens, conventions, anchors,
 * exceptions, identity that bear on those surfaces) instead of the whole
 * snapshot. This keeps the genome the source of grounding
 * while bounding what the engine has to read.
 *
 * Retrieval is over the APPROVED, version-pinned snapshot served by the #25 read
 * contract (`getSnapshot`); a draft/in_review snapshot is NEVER retrieved (the
 * `isApproved` gate is reused, not re-implemented). The returned `dnaVersion`
 * lets the engine stamp the review. Excepted routes
 * (#24) in scope are annotated so critique does not flag intentional deviation.
 *
 * Pure + deterministic over a fixture snapshot: same query + same approved
 * snapshot → byte-identical slice. Result size is bounded by `maxAnchors` /
 * `maxComponents` so a broad query can't pull the whole genome.
 */

/** The review context to ground on: what the PR touches. All fields optional → empty matches nothing extra. */
export interface GenomeQuery {
  /** Routes in scope (the diff→route output of #7). Drives anchor + exception selection. */
  routes?: string[];
  /** Component names in scope (e.g. changed primitives). Drives convention selection. */
  components?: string[];
  /** Token groups in scope, e.g. ["color", "spacing"]. Empty/undefined → all groups. */
  tokenGroups?: (keyof DnaTokens)[];
}

/** Bounds so a broad query can't retrieve the whole genome. Deterministic truncation (sorted, then capped). */
export interface RetrieveOptions {
  /** Pin a specific approved version; default is the latest approved (read-contract semantics). */
  version?: string;
  /** Max anchors returned (route-then-ref sorted, then capped). Default 20. */
  maxAnchors?: number;
  /** Max component conventions returned (name-sorted, then capped). Default 20. */
  maxComponents?: number;
  /** Extra customer redaction patterns applied on top of the built-in secret/PII set. */
  redactPatterns?: RegExp[];
}

/** An exception in scope, surfaced so critique treats the route as intentional deviation, not drift. */
export interface AnnotatedException extends DnaException {
  /** Always true here, present so consumers can branch on it without re-deriving scope. */
  inScope: true;
}

/** The bearing slice of the genome for one review context. Additive to the read contract; never a draft. */
export interface GenomeSlice {
  contract: ContractVersion;
  repo: string;
  /** The approved version this slice was cut from; the engine stamps the review with it. */
  dnaVersion: string;
  /** Product identity always bears on judgment (small, sets tone/dos/donts), so it is carried whole. */
  identity: ProductIdentity;
  /** Tokens for the requested groups (all groups when none requested). Other groups are empty. */
  tokens: DnaTokens;
  /** Conventions whose name is in scope, name-sorted and capped. */
  components: ComponentConvention[];
  /** Anchors on the in-scope routes, sorted + capped. */
  anchors: RenderedAnchor[];
  /** Exceptions on the in-scope routes, annotated so intentional deviation isn't flagged. */
  exceptions: AnnotatedException[];
}

const DEFAULT_MAX_ANCHORS = 20;
const DEFAULT_MAX_COMPONENTS = 20;

const ALL_TOKEN_GROUPS: (keyof DnaTokens)[] = [
  "color",
  "typography",
  "spacing",
  "radii",
  "shadows",
  "breakpoints",
  "motion",
];

function emptyTokens(): DnaTokens {
  return { color: {}, typography: {}, spacing: {}, radii: {}, shadows: {}, breakpoints: {}, motion: {} };
}

/** Tokens narrowed to the requested groups; each group's entries kept whole (key-sorted, deterministic). */
function sliceTokens(tokens: DnaTokens, groups: (keyof DnaTokens)[]): DnaTokens {
  const out = emptyTokens();
  for (const group of groups) {
    const entries = Object.entries(tokens[group]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    out[group] = Object.fromEntries(entries) as Record<string, Fact<string>>;
  }
  return out;
}

/** Conventions whose name is in the scope set, name-sorted then capped. */
function sliceComponents(
  components: ComponentConvention[],
  names: Set<string>,
  cap: number,
): ComponentConvention[] {
  return components
    .filter((c) => names.has(c.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, cap);
}

/** Anchors on an in-scope route, route-then-ref sorted then capped. */
function sliceAnchors(anchors: RenderedAnchor[], routes: Set<string>, cap: number): RenderedAnchor[] {
  return anchors
    .filter((a) => routes.has(a.route))
    .sort((a, b) =>
      a.route !== b.route ? (a.route < b.route ? -1 : 1) : a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0,
    )
    .slice(0, cap);
}

/** Exceptions on an in-scope route, route-sorted and annotated `inScope`. */
function sliceExceptions(exceptions: DnaException[], routes: Set<string>): AnnotatedException[] {
  return exceptions
    .filter((e) => routes.has(e.route))
    .sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0))
    .map((e) => ({ ...e, inScope: true as const }));
}

function buildSlice(
  contract: ContractVersion,
  repo: string,
  dnaVersion: string,
  snapshot: DnaSnapshot,
  query: GenomeQuery,
  opts: RetrieveOptions,
): GenomeSlice {
  const routes = new Set(query.routes ?? []);
  const componentNames = new Set(query.components ?? []);
  const groups = query.tokenGroups && query.tokenGroups.length > 0 ? query.tokenGroups : ALL_TOKEN_GROUPS;

  return {
    contract,
    repo,
    dnaVersion,
    identity: snapshot.identity,
    tokens: sliceTokens(snapshot.tokens, groups),
    components: sliceComponents(snapshot.components, componentNames, opts.maxComponents ?? DEFAULT_MAX_COMPONENTS),
    anchors: sliceAnchors(snapshot.anchors, routes, opts.maxAnchors ?? DEFAULT_MAX_ANCHORS),
    exceptions: sliceExceptions(snapshot.exceptions, routes),
  };
}

/** Shared core: read approved snapshot, optionally scrub it, then cut the slice. */
async function retrieve(
  store: SnapshotStore,
  repo: string,
  query: GenomeQuery,
  opts: RetrieveOptions,
  scrub: boolean,
): Promise<GenomeSlice | null> {
  const response = await getSnapshot(store, repo, { version: opts.version });
  if (!response) return null; // no approved snapshot; never serve a draft
  const snapshot = scrub ? scrubSnapshot(response.snapshot, opts.redactPatterns) : response.snapshot;
  return buildSlice(response.contract, response.repo, response.dnaVersion, snapshot, query, opts);
}

/**
 * Retrieve the bearing slice of a repo's APPROVED genome for one review context,
 * SCRUBBED by default, the engine-facing grounding surface. The slice is cut
 * from a secret/PII-scrubbed copy of the approved snapshot, so the genome never
 * reaches the model carrying secrets (the trust boundary, PRD §8). Reads the
 * latest approved snapshot (or the pinned approved `version`) through the #25
 * read contract; returns null when no approved snapshot matches, so a draft is
 * never served. Deterministic + bounded.
 *
 * For a genuinely trust-internal raw path, use `retrieveRawGenomeSlice`.
 */
export async function retrieveGenomeSlice(
  store: SnapshotStore,
  repo: string,
  query: GenomeQuery,
  opts: RetrieveOptions = {},
): Promise<GenomeSlice | null> {
  return retrieve(store, repo, query, opts, true);
}

/**
 * Explicit trust-INTERNAL raw retrieval: the same approved, version-pinned slice
 * but WITHOUT secret/PII scrubbing. Use only inside the trust boundary (never on
 * a path that reaches a model). The `isApproved` gate still applies, so a draft is
 * never served. The default engine-facing surface is `retrieveGenomeSlice`.
 */
export async function retrieveRawGenomeSlice(
  store: SnapshotStore,
  repo: string,
  query: GenomeQuery,
  opts: RetrieveOptions = {},
): Promise<GenomeSlice | null> {
  return retrieve(store, repo, query, opts, false);
}
