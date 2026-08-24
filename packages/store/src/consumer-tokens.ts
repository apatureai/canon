import type { DnaSnapshot, DnaTokens, Fact, Provenance } from "@apatureai/canon-schema";

/**
 * Shared token flattening for the downstream consumer projections
 * (`verdict-profile`, `lattice-profile`). The canonical `DnaTokens` splits a
 * repo's tokens across seven typed groups; every consumer that reads tokens
 * wants the same thing: one flat, stably-ordered list of `(field_id, category,
 * fact)` rows. Keeping that fold in ONE place means two consumers can never
 * drift on how a group maps to a category name or on row order.
 */

/** A canonical token group name and the category label consumers read it as. */
const TOKEN_CATEGORIES: readonly { group: keyof DnaTokens; category: string }[] = [
  { group: "color", category: "color" },
  { group: "typography", category: "typography" },
  { group: "spacing", category: "spacing" },
  { group: "radii", category: "radius" },
  { group: "shadows", category: "shadow" },
  { group: "breakpoints", category: "breakpoint" },
  { group: "motion", category: "motion" },
];

/** One flattened token row: its dotted field id, category, value, and stamped fact. */
export interface FlatToken {
  /** Dotted field id, e.g. `tokens.color.--brand`. Stable across consumers. */
  fieldId: string;
  /** Consumer-facing category label (color, spacing, radius, ...). */
  category: string;
  value: string;
  confidence: number;
  provenance: Provenance;
}

/**
 * Flatten a snapshot's tokens into one deterministically ordered list: groups in
 * `TOKEN_CATEGORIES` order, keys sorted within each group. The order is a wire
 * property downstream digests depend on, so it must not change with insertion
 * order.
 */
export function flattenTokens(snapshot: DnaSnapshot): FlatToken[] {
  const rows: FlatToken[] = [];
  for (const { group, category } of TOKEN_CATEGORIES) {
    const container = snapshot.tokens[group] as Record<string, Fact<string>>;
    for (const key of Object.keys(container).sort((a, b) => a.localeCompare(b))) {
      const f = container[key] as Fact<string>;
      rows.push({
        fieldId: `tokens.${group}.${key}`,
        category,
        value: f.value,
        confidence: f.confidence,
        provenance: f.provenance,
      });
    }
  }
  return rows;
}
