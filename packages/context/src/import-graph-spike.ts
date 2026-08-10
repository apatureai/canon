/**
 * SPIKE (#8): diff->route import-graph feasibility probe (PRD §4.3).
 *
 * Before committing to the v1.5 import-graph build (#9), we need to know whether
 * a static import graph can reliably walk from a changed component up to the
 * page(s) that render it. The hard cases are tsconfig **path aliases**,
 * **barrel files** (re-export hubs), **dynamic imports**, and **monorepo**
 * package boundaries.
 *
 * This is a deliberately small, pure, fixture-driven probe, NOT the production
 * graph builder. It resolves the import specifiers of a single source file
 * against relative paths and tsconfig `paths` aliases, and classifies each
 * specifier so we can MEASURE how often each hard case occurs. The go/no-go
 * recommendation derived from it is recorded in `import-graph-spike.md`.
 *
 * Pure, deterministic, no IO: source text and the alias table are passed in, so
 * tests never touch a real filesystem.
 */

export interface TsconfigPaths {
  /** `compilerOptions.baseUrl`, default "." */
  baseUrl?: string;
  /** `compilerOptions.paths`, e.g. { "@/*": ["src/*"] }. */
  paths?: Record<string, string[]>;
}

export type ImportKind =
  | "relative" // ./x, ../x: directly resolvable
  | "alias" // matches a tsconfig paths alias, resolvable with the alias table
  | "bare" // bare package specifier (react, @scope/pkg); external, stop the walk
  | "dynamic"; // import('...'), resolvable only if the specifier is a literal

export interface ResolvedImport {
  specifier: string;
  kind: ImportKind;
  /** Resolved module path (no extension) when statically resolvable, else null. */
  resolved: string | null;
  /** True for `import(...)` / `await import(...)` forms. */
  dynamic: boolean;
}

const STATIC_IMPORT_RE = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function isRelative(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

/** Resolve a specifier against tsconfig `paths` aliases; null if no alias matches. */
function resolveAlias(spec: string, cfg: TsconfigPaths): string | null {
  const base = cfg.baseUrl && cfg.baseUrl !== "." ? `${cfg.baseUrl.replace(/\/$/, "")}/` : "";
  for (const [pattern, targets] of Object.entries(cfg.paths ?? {})) {
    const target = targets[0];
    if (target === undefined) continue;
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1); // keep trailing slash semantics: "@/"
      if (spec.startsWith(prefix)) {
        const rest = spec.slice(prefix.length);
        return `${base}${target.slice(0, -1)}${rest}`.replace(/\/{2,}/g, "/");
      }
    } else if (spec === pattern) {
      return `${base}${target}`.replace(/\/{2,}/g, "/");
    }
  }
  return null;
}

function classify(spec: string, dynamic: boolean, cfg: TsconfigPaths): ResolvedImport {
  if (dynamic) {
    // A literal dynamic import is still resolvable; we flag it for measurement.
    const resolved = isRelative(spec) ? spec.replace(/\.[jt]sx?$/, "") : resolveAlias(spec, cfg);
    return { specifier: spec, kind: "dynamic", resolved, dynamic: true };
  }
  if (isRelative(spec)) {
    return { specifier: spec, kind: "relative", resolved: spec.replace(/\.[jt]sx?$/, ""), dynamic: false };
  }
  const alias = resolveAlias(spec, cfg);
  if (alias !== null) return { specifier: spec, kind: "alias", resolved: alias, dynamic: false };
  return { specifier: spec, kind: "bare", resolved: null, dynamic: false };
}

/**
 * Parse and classify the import specifiers of a single source file. Used by the
 * spike to measure the prevalence of each hard case across a fixture repo.
 */
export function resolveFileImports(source: string, cfg: TsconfigPaths = {}): ResolvedImport[] {
  const out: ResolvedImport[] = [];
  const seen = new Set<string>();

  const collect = (re: RegExp, dynamic: boolean): void => {
    for (const m of source.matchAll(re)) {
      const spec = m[1];
      if (spec === undefined) continue;
      const key = `${dynamic ? "d" : "s"}:${spec}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(classify(spec, dynamic, cfg));
    }
  };

  collect(DYNAMIC_IMPORT_RE, true);
  collect(STATIC_IMPORT_RE, false);
  collect(SIDE_EFFECT_IMPORT_RE, false);
  return out;
}

export interface FeasibilityReport {
  totalImports: number;
  relative: number;
  alias: number;
  bare: number;
  dynamic: number;
  /** Statically resolvable internal edges (relative + alias + literal dynamic). */
  resolvableInternal: number;
  /** Fraction of internal (non-bare) imports we can statically resolve, 0..1. */
  resolvableFraction: number;
}

/**
 * Aggregate resolved imports across a set of source files into a feasibility
 * report, the measured evidence behind the go/no-go recommendation.
 */
export function assessImportGraphFeasibility(
  files: Array<{ path: string; source: string }>,
  cfg: TsconfigPaths = {},
): FeasibilityReport {
  let relative = 0;
  let alias = 0;
  let bare = 0;
  let dynamic = 0;
  let resolvableInternal = 0;

  for (const { source } of files) {
    for (const imp of resolveFileImports(source, cfg)) {
      if (imp.kind === "relative") relative++;
      else if (imp.kind === "alias") alias++;
      else if (imp.kind === "bare") bare++;
      else dynamic++;
      if (imp.kind !== "bare" && imp.resolved !== null) resolvableInternal++;
    }
  }

  const total = relative + alias + bare + dynamic;
  const internal = total - bare;
  return {
    totalImports: total,
    relative,
    alias,
    bare,
    dynamic,
    resolvableInternal,
    resolvableFraction: internal === 0 ? 0 : resolvableInternal / internal,
  };
}
