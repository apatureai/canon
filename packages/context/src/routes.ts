/**
 * Diff -> route mapping (PRD §4.3). Map a PR's changed files to the affected
 * routes so only relevant pages are rendered/sampled. MVP: Next.js page-file
 * mapping (App Router `app/.../page.tsx` and Pages Router `pages/*.tsx`),
 * `layout.tsx` -> its child routes (capped), and config overrides (`always`,
 * `map`, `maxPerPr`). The measured, bounded import-graph v1.5 path lives in
 * `import-graph-routes.ts`; this module remains its deterministic fallback.
 *
 * Ported from verdict's proven `@engine/context` routes extractor
 * and extended with `layout.tsx` child-route mapping per
 * UI DNA issue #7. Pure, deterministic, no IO.
 */

export interface RouteConfig {
  /** Routes always reviewed regardless of the diff. */
  always?: string[];
  /** Explicit file -> route overrides (exact path match). */
  map?: Record<string, string>;
  /** Cap on routes reviewed per PR. */
  maxPerPr?: number;
}

const PAGE_EXT = "(?:tsx|ts|jsx|js)";

/** Max child routes a single changed `layout.tsx` contributes (issue #7: <= 3). */
const MAX_LAYOUT_CHILD_ROUTES = 3;

/** Next.js App Router: `app/.../page.ext` -> route (route groups dropped, dynamic kept). */
function appRouterRoute(path: string): string | null {
  const m = new RegExp(`(?:^|/)(?:src/)?app/(.*?)page\\.${PAGE_EXT}$`).exec(path);
  if (!m) return null;
  const segments = (m[1] ?? "").split("/").filter(Boolean);

  const kept: string[] = [];
  for (const seg of segments) {
    if (seg.startsWith("_") || seg.startsWith("@")) return null; // private / parallel slot
    if (/^\(.*\)$/.test(seg)) continue; // route group, not a path segment
    kept.push(seg);
  }
  return "/" + kept.join("/");
}

/** Next.js Pages Router: `pages/**.ext` -> route (index/_app/api excluded). */
function pagesRouterRoute(path: string): string | null {
  const m = new RegExp(`(?:^|/)(?:src/)?pages/(.*)\\.${PAGE_EXT}$`).exec(path);
  if (!m) return null;
  const segments = (m[1] ?? "").split("/");
  if (segments[0] === "api") return null;
  const base = segments[segments.length - 1] ?? "";
  if (base.startsWith("_")) return null; // _app, _document, _error

  const kept = base === "index" ? segments.slice(0, -1) : segments;
  return "/" + kept.join("/");
}

/** Map a single changed file to its route, or null if it isn't a page file. */
export function pageFileToRoute(path: string): string | null {
  const clean = path.replace(/^\.\//, "");
  return appRouterRoute(clean) ?? pagesRouterRoute(clean);
}

/** The App Router `app/.../` directory prefix of a `layout.ext`, or null if not a layout. */
function appLayoutDir(path: string): string | null {
  const clean = path.replace(/^\.\//, "");
  const m = new RegExp(`((?:^|.*?/)(?:src/)?app/.*?)layout\\.${PAGE_EXT}$`).exec(clean);
  return m ? (m[1] ?? null) : null;
}

/**
 * Map a changed App Router `layout.tsx` to the routes it wraps: the routes of
 * the page files living under the same `app/.../` directory. Deterministic
 * (sorted) and capped at `MAX_LAYOUT_CHILD_ROUTES` so a root layout edit does
 * not fan out to the whole app. `pageFiles` is the repo's known page-file list.
 */
export function layoutFileToRoutes(layoutPath: string, pageFiles: string[]): string[] {
  const dir = appLayoutDir(layoutPath);
  if (dir === null) return [];

  const childRoutes = new Set<string>();
  for (const file of pageFiles) {
    if (!file.replace(/^\.\//, "").startsWith(dir)) continue;
    const route = pageFileToRoute(file);
    if (route) childRoutes.add(route);
  }
  return [...childRoutes].sort().slice(0, MAX_LAYOUT_CHILD_ROUTES);
}

/**
 * Map a PR diff (changed file paths) to the routes to review, applying config
 * overrides, the always-list, `layout.tsx` child routes (when `pageFiles` is
 * supplied), dedupe + sort, and the per-PR cap.
 */
export function mapDiffToRoutes(
  changedFiles: string[],
  config: RouteConfig = {},
  pageFiles?: string[],
): string[] {
  const routes = new Set<string>();

  for (const file of changedFiles) {
    const override = config.map?.[file];
    if (override) {
      routes.add(override);
      continue;
    }
    const route = pageFileToRoute(file);
    if (route) {
      routes.add(route);
      continue;
    }
    if (pageFiles) for (const r of layoutFileToRoutes(file, pageFiles)) routes.add(r);
  }
  for (const route of config.always ?? []) routes.add(route);

  const sorted = [...routes].sort();
  return config.maxPerPr !== undefined ? sorted.slice(0, config.maxPerPr) : sorted;
}
