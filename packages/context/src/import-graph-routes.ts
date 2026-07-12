/**
 * Bounded diff -> route import graph (PRD §4.3, issue #9).
 *
 * This is a reverse dependency walk over caller-supplied source text. It does
 * not read the repository or execute customer code. Relative imports and
 * tsconfig path aliases become internal edges; bare package imports and
 * non-code assets stop the walk. The graph is deliberately bounded to five
 * hops and five routes, with shortest graph distance winning.
 *
 * The v1.5 path is capability-honest: if fewer than 90% of discovered internal
 * code imports resolve to supplied files, or graph construction fails, callers
 * receive the existing page-file/config mapping and an explicit fallback
 * reason instead of a misleading partial graph result.
 */

import { posix } from "node:path";
import {
  resolveFileImports,
  type ResolvedImport,
  type TsconfigPaths,
} from "./import-graph-spike.js";
import {
  mapDiffToRoutes,
  pageFileToRoute,
  type RouteConfig,
} from "./routes.js";

const HARD_MAX_DEPTH = 5;
const HARD_MAX_ROUTES = 5;
const DEFAULT_MIN_RESOLVABLE_FRACTION = 0.9;
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"] as const;
const ASSET_EXTENSIONS = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".json",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

export interface ImportGraphSourceFile {
  /** Repository-relative path. */
  path: string;
  /** Source text; no filesystem access occurs inside the graph builder. */
  source: string;
}

export interface ImportGraphRouteOptions {
  tsconfig?: TsconfigPaths;
  /** May lower, but never raise, the hard five-hop traversal ceiling. */
  maxDepth?: number;
  /** May lower, but never raise, the hard five-route result ceiling. */
  maxRoutes?: number;
  /** Defaults to the measured-need gate's 0.90 internal-edge threshold. */
  minResolvableFraction?: number;
}

export type ImportGraphFallbackReason =
  | "low_resolvability"
  | "no_graph_routes"
  | "resolution_failed";

export interface ImportGraphDiagnostics {
  totalInternalImports: number;
  resolvedInternalImports: number;
  resolvableFraction: number;
  maxDepth: number;
  maxRoutes: number;
}

export type ImportGraphRouteResult =
  | {
      mode: "import_graph";
      routes: string[];
      diagnostics: ImportGraphDiagnostics;
    }
  | {
      mode: "mvp_fallback";
      reason: ImportGraphFallbackReason;
      routes: string[];
      diagnostics: ImportGraphDiagnostics;
    };

function boundedInteger(value: number | undefined, fallback: number, ceiling: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(ceiling, Math.floor(value)));
}

function boundedFraction(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MIN_RESOLVABLE_FRACTION;
  return Math.max(0, Math.min(1, value));
}

function normalizeRepoPath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (normalized === "." || normalized === "" || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`path escapes or does not identify a repository file: ${path}`);
  }
  return normalized.replace(/^\/+/, "");
}

function hasNonCodeExtension(specifier: string): boolean {
  const clean = specifier.split(/[?#]/, 1)[0] ?? specifier;
  const ext = posix.extname(clean).toLowerCase();
  return ASSET_EXTENSIONS.has(ext);
}

function moduleCandidates(path: string): string[] {
  const normalized = normalizeRepoPath(path);
  const ext = posix.extname(normalized).toLowerCase();
  if (CODE_EXTENSIONS.includes(ext as (typeof CODE_EXTENSIONS)[number])) return [normalized];
  return [
    normalized,
    ...CODE_EXTENSIONS.map((candidateExt) => `${normalized}${candidateExt}`),
    ...CODE_EXTENSIONS.map((candidateExt) => `${normalized}/index${candidateExt}`),
  ];
}

function resolveTarget(
  importer: string,
  imported: ResolvedImport,
  files: ReadonlyMap<string, ImportGraphSourceFile>,
): string | null {
  if (imported.resolved === null || hasNonCodeExtension(imported.specifier)) return null;
  const unresolved = imported.specifier.startsWith(".")
    ? posix.join(posix.dirname(importer), imported.resolved)
    : imported.resolved;
  for (const candidate of moduleCandidates(unresolved)) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

function diagnostics(
  totalInternalImports: number,
  resolvedInternalImports: number,
  maxDepth: number,
  maxRoutes: number,
): ImportGraphDiagnostics {
  return {
    totalInternalImports,
    resolvedInternalImports,
    resolvableFraction:
      totalInternalImports === 0 ? 0 : resolvedInternalImports / totalInternalImports,
    maxDepth,
    maxRoutes,
  };
}

/**
 * Map changed components/modules to importing page routes.
 *
 * Ranking is `(shortest import distance, route lexical order)`. Existing MVP
 * hits (changed page/layout, explicit map, `always`) have distance zero. The
 * returned route list never exceeds five entries, even if `config.maxPerPr` or
 * `options.maxRoutes` asks for more.
 */
export function mapDiffToRoutesWithImportGraph(
  changedFiles: string[],
  sourceFiles: ImportGraphSourceFile[],
  config: RouteConfig = {},
  options: ImportGraphRouteOptions = {},
): ImportGraphRouteResult {
  const maxDepth = boundedInteger(options.maxDepth, HARD_MAX_DEPTH, HARD_MAX_DEPTH);
  const configuredMax = config.maxPerPr ?? HARD_MAX_ROUTES;
  const maxRoutes = Math.min(
    boundedInteger(options.maxRoutes, HARD_MAX_ROUTES, HARD_MAX_ROUTES),
    boundedInteger(configuredMax, HARD_MAX_ROUTES, HARD_MAX_ROUTES),
  );
  const minimum = boundedFraction(options.minResolvableFraction);

  let fallbackRoutes: string[] = [];
  let totalInternalImports = 0;
  let resolvedInternalImports = 0;

  try {
    // Establish the fail-safe result before graph normalization. If later graph
    // construction fails (for example duplicate canonical paths), the caller
    // still receives the existing page-file/config behavior.
    const rawPageFiles = sourceFiles
      .map((file) => file.path)
      .filter((path) => pageFileToRoute(path) !== null);
    const uncappedConfig: RouteConfig = { always: config.always, map: config.map };
    fallbackRoutes = mapDiffToRoutes(changedFiles, uncappedConfig, rawPageFiles).slice(0, maxRoutes);

    const files = new Map<string, ImportGraphSourceFile>();
    for (const file of sourceFiles) {
      const path = normalizeRepoPath(file.path);
      if (files.has(path)) throw new Error(`duplicate normalized source path: ${path}`);
      files.set(path, { path, source: file.source });
    }

    const pageFiles = [...files.keys()].filter((path) => pageFileToRoute(path) !== null);
    fallbackRoutes = mapDiffToRoutes(changedFiles, uncappedConfig, pageFiles).slice(0, maxRoutes);

    const reverse = new Map<string, Set<string>>();
    for (const [importer, file] of files) {
      for (const imported of resolveFileImports(file.source, options.tsconfig)) {
        if (imported.kind === "bare" || hasNonCodeExtension(imported.specifier)) continue;
        totalInternalImports++;
        const target = resolveTarget(importer, imported, files);
        if (target === null) continue;
        resolvedInternalImports++;
        const importers = reverse.get(target) ?? new Set<string>();
        importers.add(importer);
        reverse.set(target, importers);
      }
    }

    const measured = diagnostics(
      totalInternalImports,
      resolvedInternalImports,
      maxDepth,
      maxRoutes,
    );
    if (totalInternalImports === 0) {
      return { mode: "mvp_fallback", reason: "no_graph_routes", routes: fallbackRoutes, diagnostics: measured };
    }
    if (measured.resolvableFraction < minimum) {
      return { mode: "mvp_fallback", reason: "low_resolvability", routes: fallbackRoutes, diagnostics: measured };
    }

    const routeDistances = new Map<string, number>();
    for (const route of fallbackRoutes) routeDistances.set(route, 0);
    let recoveredGraphRoute = false;

    for (const changedFile of changedFiles) {
      const start = normalizeRepoPath(changedFile);
      if (!files.has(start)) continue;
      const queue: Array<{ path: string; distance: number }> = [{ path: start, distance: 0 }];
      const seen = new Map<string, number>([[start, 0]]);

      for (let cursor = 0; cursor < queue.length; cursor++) {
        const current = queue[cursor];
        if (current === undefined || current.distance >= maxDepth) continue;
        const importers = [...(reverse.get(current.path) ?? [])].sort();
        for (const importer of importers) {
          const distance = current.distance + 1;
          const previous = seen.get(importer);
          if (previous !== undefined && previous <= distance) continue;
          seen.set(importer, distance);
          queue.push({ path: importer, distance });

          const route = pageFileToRoute(importer);
          if (route === null) continue;
          const oldDistance = routeDistances.get(route);
          if (oldDistance === undefined || distance < oldDistance) routeDistances.set(route, distance);
          if (!fallbackRoutes.includes(route)) recoveredGraphRoute = true;
        }
      }
    }

    if (!recoveredGraphRoute) {
      return { mode: "mvp_fallback", reason: "no_graph_routes", routes: fallbackRoutes, diagnostics: measured };
    }

    const routes = [...routeDistances]
      .sort(([routeA, distanceA], [routeB, distanceB]) => distanceA - distanceB || routeA.localeCompare(routeB))
      .slice(0, maxRoutes)
      .map(([route]) => route);
    return { mode: "import_graph", routes, diagnostics: measured };
  } catch {
    return {
      mode: "mvp_fallback",
      reason: "resolution_failed",
      routes: fallbackRoutes,
      diagnostics: diagnostics(totalInternalImports, resolvedInternalImports, maxDepth, maxRoutes),
    };
  }
}
