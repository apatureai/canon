import type { DnaTokens } from "@uidna/schema";

/**
 * Design↔code drift (PRD §5/§7; the DTCG "single source of truth so design and
 * code cannot drift" thesis).
 *
 * `diffSnapshots` answers "what CHANGED between two versions of the same genome"
 * (symmetric, for versioning). This is a different, product-meaningful question:
 * where has the CODE genome drifted from the DESIGN genome, treating **design as
 * the source of truth**. It is the primitive behind the design-system drift
 * gate — the axis a code-only reviewer cannot see: a PR that hardcodes a value
 * the design system already defines, or invents a token the design never
 * sanctioned.
 *
 * Pure and deterministic, and deliberately decoupled from HOW each genome was
 * sourced: the caller supplies the design tokens (e.g. from the designer's
 * Figma DTCG export) and the code tokens (extracted from the repo) as two
 * inputs, so this needs no new provenance model and no Figma-format coupling.
 */

export const DESIGN_CODE_DRIFT_VERSION = "design-code-drift/1" as const;

/** The token groups compared, in stable order. */
export type TokenGroup = keyof DnaTokens;

const TOKEN_GROUPS: readonly TokenGroup[] = [
  "color",
  "typography",
  "spacing",
  "radii",
  "shadows",
  "breakpoints",
  "motion",
];

/**
 * How one token diverges (design is authoritative):
 *  - `value_mismatch`: both define the token, with different values (code drifted).
 *  - `missing_in_code`: the design defines the token; the code does not use it.
 *  - `undocumented_in_design`: the code defines a token the design never sanctioned.
 */
export type DriftKind = "value_mismatch" | "missing_in_code" | "undocumented_in_design";

export interface DriftEntry {
  group: TokenGroup;
  name: string;
  kind: DriftKind;
  /** The design's (authoritative) value — present for `value_mismatch` and `missing_in_code`. */
  design?: string;
  /** The code's value — present for `value_mismatch` and `undocumented_in_design`. */
  code?: string;
}

export interface DesignCodeDrift {
  driftModelVersion: typeof DESIGN_CODE_DRIFT_VERSION;
  /** Every divergent token, ordered by group then token name (stable). */
  entries: DriftEntry[];
  summary: {
    /** Tokens present in both with an equal value — no drift. */
    aligned: number;
    valueMismatch: number;
    missingInCode: number;
    undocumentedInDesign: number;
  };
  /** True when the code genome fully conforms to the design genome (no entries). */
  conformant: boolean;
}

/**
 * Compute where the code genome has drifted from the design genome. Asymmetric
 * (design is the source of truth) and deterministic: the same two token sets
 * always yield the same report, with entries in a stable group-then-name order.
 */
export function computeDesignCodeDrift(design: DnaTokens, code: DnaTokens): DesignCodeDrift {
  const entries: DriftEntry[] = [];
  let aligned = 0;

  for (const group of TOKEN_GROUPS) {
    const designGroup = design[group];
    const codeGroup = code[group];
    const names = [...new Set([...Object.keys(designGroup), ...Object.keys(codeGroup)])].sort();

    for (const name of names) {
      const designValue = designGroup[name]?.value;
      const codeValue = codeGroup[name]?.value;

      if (designValue !== undefined && codeValue !== undefined) {
        if (designValue === codeValue) aligned += 1;
        else entries.push({ group, name, kind: "value_mismatch", design: designValue, code: codeValue });
      } else if (designValue !== undefined) {
        entries.push({ group, name, kind: "missing_in_code", design: designValue });
      } else if (codeValue !== undefined) {
        entries.push({ group, name, kind: "undocumented_in_design", code: codeValue });
      }
    }
  }

  const count = (kind: DriftKind): number => entries.reduce((n, e) => (e.kind === kind ? n + 1 : n), 0);
  return {
    driftModelVersion: DESIGN_CODE_DRIFT_VERSION,
    entries,
    summary: {
      aligned,
      valueMismatch: count("value_mismatch"),
      missingInCode: count("missing_in_code"),
      undocumentedInDesign: count("undocumented_in_design"),
    },
    conformant: entries.length === 0,
  };
}

/**
 * Wrap a bare drift-entry list as a `DesignCodeDrift` (recomputing the summary)
 * so a subset of entries — e.g. the drift a change introduced — can be scored by
 * the gate / remediation. `aligned` is 0 by construction (only divergent entries).
 */
export function driftFromEntries(entries: DriftEntry[]): DesignCodeDrift {
  const count = (k: DriftKind): number => entries.reduce((n, e) => (e.kind === k ? n + 1 : n), 0);
  return {
    driftModelVersion: DESIGN_CODE_DRIFT_VERSION,
    entries,
    summary: {
      aligned: 0,
      valueMismatch: count("value_mismatch"),
      missingInCode: count("missing_in_code"),
      undocumentedInDesign: count("undocumented_in_design"),
    },
    conformant: entries.length === 0,
  };
}

// --- drift policy gate --------------------------------------------------------

/**
 * Which drift kinds block a PR vs. only warn. This is Apature's NEUTRAL GATE
 * applied to design-system drift: the CI-blocking behavior, configurable per
 * team. A kind in neither list is ignored (surfaced in the report, not gated).
 */
export interface DriftGatePolicy {
  block: readonly DriftKind[];
  warn: readonly DriftKind[];
}

/**
 * The default policy: a value that drifted off an existing design token BLOCKS
 * (the code contradicts the source of truth); a token defined in design but
 * unused, or a token the code invented, WARN (informative, not a contradiction).
 */
export const DEFAULT_DRIFT_GATE_POLICY: DriftGatePolicy = {
  block: ["value_mismatch"],
  warn: ["missing_in_code", "undocumented_in_design"],
};

export interface DriftGateVerdict {
  /** `block` if any blocking entry, else `warn` if any warning, else `pass`. */
  decision: "block" | "warn" | "pass";
  blocking: DriftEntry[];
  warnings: DriftEntry[];
  /** Entries whose kind is in neither policy list — reported, not gated. */
  ignored: DriftEntry[];
}

/**
 * Evaluate the drift gate over a drift report. Pure and deterministic: partitions
 * the report's entries by the policy and returns the overall decision. Fully
 * conformant input passes; a policy that lists a kind in both `block` and `warn`
 * treats it as blocking (the stricter wins, fail-safe).
 */
export function evaluateDriftGate(
  drift: DesignCodeDrift,
  policy: DriftGatePolicy = DEFAULT_DRIFT_GATE_POLICY,
): DriftGateVerdict {
  const blockSet = new Set(policy.block);
  const warnSet = new Set(policy.warn);
  const blocking: DriftEntry[] = [];
  const warnings: DriftEntry[] = [];
  const ignored: DriftEntry[] = [];

  for (const entry of drift.entries) {
    if (blockSet.has(entry.kind)) blocking.push(entry);
    else if (warnSet.has(entry.kind)) warnings.push(entry);
    else ignored.push(entry);
  }

  const decision: DriftGateVerdict["decision"] = blocking.length > 0 ? "block" : warnings.length > 0 ? "warn" : "pass";
  return { decision, blocking, warnings, ignored };
}
