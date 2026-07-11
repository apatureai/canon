import type { DnaSnapshot, Fact, Provenance } from "@uidna/schema";
import { serializeGenomeContent } from "./version-identity.js";

/**
 * Version-to-version genome change detection (#26, PRD §4/§7). `diffSnapshots`
 * computes a structured, deterministic changeset between two immutable snapshot
 * versions — what changed in the genome (added/removed/changed facts across
 * tokens, components, identity, exceptions, distributions). Feeds Entropy Engine
 * (drift consolidation) and the Consultant (carry-forward), and gives reviewers
 * a "what changed since the approved version" view.
 *
 * Distinct from #21 drift hints (code-vs-standard WITHIN one snapshot). Pure, no
 * IO. Metadata-only bumps are distinguishable from genome-content changes via
 * the #22 content/identity split (`serializeGenomeContent`).
 */

export type ChangeKind = "added" | "removed" | "changed";

/** One field-level change with old/new value + confidence + provenance deltas. */
export interface FieldChange {
  /** Dotted field id, e.g. "tokens.color.--brand" or "exceptions./promo". */
  field: string;
  kind: ChangeKind;
  oldValue: string | null;
  newValue: string | null;
  oldConfidence: number | null;
  newConfidence: number | null;
  oldProvenance: Provenance | null;
  newProvenance: Provenance | null;
}

export interface SnapshotDiff {
  changes: FieldChange[];
  /** True when the resolved genome content is identical (only metadata stamps differ). */
  metadataOnly: boolean;
}

type FactMap = Record<string, Fact<string>>;

function factChange(field: string, a: Fact<string> | undefined, b: Fact<string> | undefined): FieldChange | null {
  if (!a && !b) return null;
  if (a && !b) {
    return { field, kind: "removed", oldValue: a.value, newValue: null, oldConfidence: a.confidence, newConfidence: null, oldProvenance: a.provenance, newProvenance: null };
  }
  if (!a && b) {
    return { field, kind: "added", oldValue: null, newValue: b.value, oldConfidence: null, newConfidence: b.confidence, oldProvenance: null, newProvenance: b.provenance };
  }
  const fa = a as Fact<string>;
  const fb = b as Fact<string>;
  if (fa.value === fb.value && fa.confidence === fb.confidence && fa.provenance === fb.provenance) return null;
  return { field, kind: "changed", oldValue: fa.value, newValue: fb.value, oldConfidence: fa.confidence, newConfidence: fb.confidence, oldProvenance: fa.provenance, newProvenance: fb.provenance };
}

function diffFactMaps(prefix: string, a: FactMap, b: FactMap, out: FieldChange[]): void {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const change = factChange(`${prefix}.${key}`, a[key], b[key]);
    if (change) out.push(change);
  }
}

function diffTokens(a: DnaSnapshot, b: DnaSnapshot, out: FieldChange[]): void {
  for (const group of Object.keys(a.tokens) as (keyof DnaSnapshot["tokens"])[]) {
    diffFactMaps(`tokens.${group}`, a.tokens[group], b.tokens[group], out);
  }
}

function diffIdentity(a: DnaSnapshot, b: DnaSnapshot, out: FieldChange[]): void {
  for (const k of ["name", "audience", "tone"] as const) {
    const change = factChange(`identity.${k}`, a.identity[k] ?? undefined, b.identity[k] ?? undefined);
    if (change) out.push(change);
  }
}

function diffExceptions(a: DnaSnapshot, b: DnaSnapshot, out: FieldChange[]): void {
  const am = new Map(a.exceptions.map((e) => [e.route, e.reason]));
  const bm = new Map(b.exceptions.map((e) => [e.route, e.reason]));
  for (const route of new Set([...am.keys(), ...bm.keys()])) {
    const ar = am.get(route);
    const br = bm.get(route);
    if (ar === br) continue;
    out.push({
      field: `exceptions.${route}`,
      kind: ar === undefined ? "added" : br === undefined ? "removed" : "changed",
      oldValue: ar ?? null,
      newValue: br ?? null,
      oldConfidence: null,
      newConfidence: null,
      oldProvenance: null,
      newProvenance: null,
    });
  }
}

function diffComponents(a: DnaSnapshot, b: DnaSnapshot, out: FieldChange[]): void {
  const am = new Map(a.components.map((c) => [c.name, c]));
  const bm = new Map(b.components.map((c) => [c.name, c]));
  for (const name of new Set([...am.keys(), ...bm.keys()])) {
    const ca = am.get(name);
    const cb = bm.get(name);
    if (!ca && !cb) continue;
    const af = ca ? { value: name, confidence: ca.confidence, provenance: ca.provenance } : undefined;
    const bf = cb ? { value: name, confidence: cb.confidence, provenance: cb.provenance } : undefined;
    const change = factChange(`components.${name}`, af, bf);
    if (change) out.push(change);
  }
}

/** A non-fact scalar change (distributions carry no confidence/provenance). */
function scalarChange(field: string, a: string | null, b: string | null): FieldChange | null {
  if (a === b) return null;
  return {
    field,
    kind: a === null ? "added" : b === null ? "removed" : "changed",
    oldValue: a,
    newValue: b,
    oldConfidence: null,
    newConfidence: null,
    oldProvenance: null,
    newProvenance: null,
  };
}

function diffDistributions(a: DnaSnapshot, b: DnaSnapshot, out: FieldChange[]): void {
  const da = a.distributions;
  const db = b.distributions;

  // Numeric-array signals: the ordered array IS the value (a reordering is a change).
  for (const k of ["spacingIntervals", "typeScale", "radiusPatterns"] as const) {
    const change = scalarChange(`distributions.${k}`, JSON.stringify(da[k]), JSON.stringify(db[k]));
    if (change) out.push(change);
  }

  // density: a nullable scalar.
  const density = scalarChange(
    "distributions.density",
    da.density === null ? null : String(da.density),
    db.density === null ? null : String(db.density),
  );
  if (density) out.push(density);

  // colorProportions: per-color proportion, keyed like a fact map (add/remove/change).
  for (const color of new Set([...Object.keys(da.colorProportions), ...Object.keys(db.colorProportions)])) {
    const av = da.colorProportions[color];
    const bv = db.colorProportions[color];
    const change = scalarChange(
      `distributions.colorProportions.${color}`,
      av === undefined ? null : String(av),
      bv === undefined ? null : String(bv),
    );
    if (change) out.push(change);
  }
}

/**
 * Diff two snapshots into a deterministic, field-sorted changeset. `metadataOnly`
 * is true when the resolved genome content is byte-identical (only metadata
 * version/approval stamps differ) — reusing the #22 content/identity split.
 */
export function diffSnapshots(a: DnaSnapshot, b: DnaSnapshot): SnapshotDiff {
  const changes: FieldChange[] = [];
  diffTokens(a, b, changes);
  diffComponents(a, b, changes);
  diffIdentity(a, b, changes);
  diffExceptions(a, b, changes);
  diffDistributions(a, b, changes);

  changes.sort((x, y) => (x.field < y.field ? -1 : x.field > y.field ? 1 : 0));

  // Genome-content identity (no metadata) -> distinguishes metadata-only bumps.
  const metadataOnly = serializeGenomeContent(a) === serializeGenomeContent(b) && changes.length === 0;
  return { changes, metadataOnly };
}
