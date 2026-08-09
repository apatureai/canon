import type { Conflict, DnaSnapshot, DnaTokens, Fact } from "@uidna/schema";
import { emptyDraft } from "@uidna/schema";
import { reconcileField } from "@uidna/reconcile";
import type { ScanResult, TokenContribution } from "./scan.js";

/**
 * Turn a directory scan into a draft genome.
 *
 * When two files declare the same token (a `@theme` block and a `:root` block
 * both defining `--color-brand`, say), this is where the repo's precedence
 * ladder earns its keep: `reconcileField` resolves the VALUE by provenance
 * (config > code > pixels; a human sign-off tops both) while computing
 * confidence separately, so agreement between independent files reinforces a
 * fact and disagreement keeps the winning value but records a `Conflict`
 * naming every candidate. Nothing is silently dropped.
 */

export interface ResolvedTokens {
  tokens: DnaTokens;
  conflicts: Conflict[];
  /** Files that contributed a candidate to each conflicted field, in scan order. */
  conflictSources: Record<string, string[]>;
}

const GROUPS: readonly (keyof DnaTokens)[] = [
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

/** Reconcile every same-named contribution into one resolved fact per token. */
export function reconcileContributions(contributions: TokenContribution[]): ResolvedTokens {
  const byField = new Map<string, TokenContribution[]>();
  for (const contribution of contributions) {
    const field = `tokens.${contribution.group}.${contribution.name}`;
    const bucket = byField.get(field);
    if (bucket) bucket.push(contribution);
    else byField.set(field, [contribution]);
  }

  const tokens = emptyTokens();
  const conflicts: Conflict[] = [];
  const conflictSources: Record<string, string[]> = {};

  for (const field of [...byField.keys()].sort()) {
    const bucket = byField.get(field) as TokenContribution[];
    const first = bucket[0] as TokenContribution;
    const result = reconcileField<string>(
      field,
      bucket.map((c) => c.fact),
    );
    (tokens[first.group] as Record<string, Fact<string>>)[first.name] = result.resolved;
    if (result.conflicts.length > 0) {
      conflicts.push(...result.conflicts);
      conflictSources[field] = bucket.map((c) => c.source);
    }
  }

  return { tokens, conflicts, conflictSources };
}

export interface SnapshotIdentity {
  owner: string;
  name: string;
  extractionVersion: string;
}

export interface BuiltGenome extends ResolvedTokens {
  snapshot: DnaSnapshot;
}

/**
 * Assemble the draft `DnaSnapshot`. It stays a DRAFT: the store contract
 * (`getSnapshot`) never serves a genome that no human has signed off, and a
 * directory walk is not a sign-off.
 */
export function buildGenome(scan: ScanResult, identity: SnapshotIdentity): BuiltGenome {
  const resolved = reconcileContributions(scan.contributions);
  const snapshot = emptyDraft(identity.owner, identity.name, identity.extractionVersion);
  snapshot.identity = scan.identity;
  snapshot.tokens = resolved.tokens;
  snapshot.components = scan.components;
  return { ...resolved, snapshot };
}

/** Facts per canonical group, in schema order. */
export function tokenCountsByGroup(tokens: DnaTokens): { group: keyof DnaTokens; count: number }[] {
  return GROUPS.map((group) => ({ group, count: Object.keys(tokens[group]).length }));
}
