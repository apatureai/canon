import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { ComponentConvention, DnaTokens, Fact, ProductIdentity } from "@apatureai/canon-schema";
import type { ConfigLoader, TokenDiagnostic } from "@apatureai/canon-context";
import {
  extractBrandIdentity,
  extractComponentConventions,
  extractCssTokens,
  extractTailwindV3TokensFromFile,
  extractTailwindV4Tokens,
  extractTokensJsonWithDiagnostics,
} from "@apatureai/canon-context";

/**
 * Filesystem discovery for the `ui-dna context` command. This module, and only
 * this module, knows that a design system lives in files. `@apatureai/canon-context`
 * stays a set of pure string→facts extractors; everything here is "which bytes
 * do we hand it, and what do we call the source afterwards".
 *
 * The walk is deterministic (directory entries are sorted) and bounded (depth,
 * file count, per-file size), so pointing it at a large repository degrades by
 * truncating rather than by running away.
 */

/** Which extractor claimed a file, i.e. what kind of evidence it produced. */
export type SourceKind =
  | "dtcg-tokens"
  | "css-custom-properties"
  | "tailwind-v4-theme"
  | "tailwind-v3-config"
  | "component-libraries"
  | "brand-identity";

export interface ScannedSource {
  /** Path relative to the scan root, POSIX-separated. */
  path: string;
  kind: SourceKind;
  /** Token facts contributed by this source. */
  tokens: number;
  /** Short human note (diagnostics found, libraries detected, why it contributed nothing). */
  note: string;
}

/** One token fact and the file it came from, before reconciliation. */
export interface TokenContribution {
  group: keyof DnaTokens;
  name: string;
  fact: Fact<string>;
  source: string;
}

export interface ScanDiagnostic {
  source: string;
  diagnostic: TokenDiagnostic;
}

export interface ScanResult {
  root: string;
  /** How many files the bounded walk visited, candidate or not. */
  filesWalked: number;
  /**
   * Every candidate file that was opened and handed to an extractor, whether or
   * not it yielded a fact. A file that declares nothing is reported with
   * `tokens: 0` and a note saying so. The alternative, dropping it silently,
   * makes "no sources" indistinguishable from "the walk never found your files".
   *
   * Sorted by path then kind, so two runs over the same tree report identically.
   */
  sources: ScannedSource[];
  contributions: TokenContribution[];
  diagnostics: ScanDiagnostic[];
  identity: ProductIdentity;
  components: ComponentConvention[];
  /** Files the walk refused: unreadable, unparseable, or over the size ceiling. */
  skipped: string[];
  /**
   * True when a bound (depth/file count) stopped the walk before the end of the
   * tree. Every count in a truncated result is a LOWER BOUND: "0 conflicts"
   * means "none among the files that were reached", which is not the same claim
   * as "none in this repository". Callers that gate on this report (`--strict`)
   * must treat truncation as a failure to finish, never as a clean result.
   */
  truncated: boolean;
  /**
   * Which bounds actually stopped the walk, in the order they were first hit,
   * each with the value in force. Empty exactly when `truncated` is false.
   */
  truncationReasons: string[];
}

export interface ScanOptions {
  /**
   * Evaluate `tailwind.config.*` files. Off by default: a Tailwind config is
   * executable code. When off, configs are still reported as a source, marked
   * as not evaluated.
   */
  execTailwindConfig?: boolean;
  /** Loader used when `execTailwindConfig` is on. Tests inject a stub. */
  configLoader?: ConfigLoader;
  maxDepth?: number;
  maxFiles?: number;
  maxFileBytes?: number;
}

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_FILES = 5_000;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Directories that never hold a project's own design tokens. */
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "tmp",
]);

const TAILWIND_CONFIG = /^tailwind\.config\.(js|cjs|mjs|ts|mts|cts)$/;

const emptyIdentity = (): ProductIdentity => ({
  name: null,
  audience: null,
  tone: null,
  dos: [],
  donts: [],
});

const GROUPS: readonly (keyof DnaTokens)[] = [
  "color",
  "typography",
  "spacing",
  "radii",
  "shadows",
  "breakpoints",
  "motion",
];

/** Total facts across every canonical group. */
export function countTokens(tokens: DnaTokens): number {
  return GROUPS.reduce((sum, group) => sum + Object.keys(tokens[group]).length, 0);
}

function toContributions(tokens: DnaTokens, source: string): TokenContribution[] {
  const out: TokenContribution[] = [];
  for (const group of GROUPS) {
    for (const [name, fact] of Object.entries(tokens[group])) {
      out.push({ group, name, fact, source });
    }
  }
  return out;
}

function isTokensFile(name: string): boolean {
  return name === "tokens.json" || name === "design-tokens.json" || name.endsWith(".tokens.json");
}

function posix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

/**
 * The short reason out of a PostCSS parse failure. PostCSS labels its message
 * `<css input>` because the extractors are handed a string and never a path;
 * the walk knows the real path and prints it, so that placeholder would only
 * point the reader at a file that does not exist.
 */
function cssParseMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "reason" in error) {
    const { reason, line } = error as { reason?: unknown; line?: unknown };
    if (typeof reason === "string") {
      return typeof line === "number" ? `${reason} at line ${line}` : reason;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

interface WalkState {
  files: string[];
  /** Insertion-ordered so the report lists bounds in the order they were hit. */
  truncationReasons: Set<string>;
}

function walk(dir: string, root: string, depth: number, state: WalkState, options: Required<Pick<ScanOptions, "maxDepth" | "maxFiles">>): void {
  if (depth > options.maxDepth) {
    state.truncationReasons.add(`depth bound (--max-depth ${options.maxDepth}) reached`);
    return;
  }
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (state.files.length >= options.maxFiles) {
      state.truncationReasons.add(`file-count bound (--max-files ${options.maxFiles}) reached`);
      return;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, root, depth + 1, state, options);
    } else if (entry.isFile()) {
      state.files.push(posix(relative(root, full)));
    }
  }
}

/**
 * Read a project directory and produce every design-token fact its static
 * sources declare, each stamped with the file it came from. Contributions are
 * NOT merged here: merging is reconciliation's job, and two files disagreeing
 * about one token is a result worth reporting, not a collision to silently
 * resolve during a directory walk.
 */
export async function scanProject(root: string, options: ScanOptions = {}): Promise<ScanResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  const state: WalkState = { files: [], truncationReasons: new Set() };
  walk(root, root, 0, state, { maxDepth, maxFiles });

  const sources: ScannedSource[] = [];
  const contributions: TokenContribution[] = [];
  const diagnostics: ScanDiagnostic[] = [];
  const skipped: string[] = [];
  let identity = emptyIdentity();
  let components: ComponentConvention[] = [];

  const read = (relPath: string): string | null => {
    const full = join(root, relPath);
    try {
      if (statSync(full).size > maxFileBytes) {
        skipped.push(`${relPath} (larger than ${maxFileBytes} bytes)`);
        return null;
      }
      return readFileSync(full, "utf8");
    } catch {
      skipped.push(`${relPath} (unreadable)`);
      return null;
    }
  };

  for (const file of state.files) {
    const name = file.slice(file.lastIndexOf("/") + 1);
    const atRoot = !file.includes("/");

    if (file.endsWith(".css")) {
      const css = read(file);
      if (css === null) continue;
      // The extractors are pure PostCSS parses, and PostCSS THROWS on malformed
      // CSS. Parsing outside the walk let one unclosed brace anywhere in a tree
      // abort the whole scan with `failed: <css input>:2:1: Unclosed block` -
      // no report at all, and not even the name of the offending file. A
      // stylesheet we cannot parse is a stylesheet we did not read, which is
      // the same situation as an unparseable JSON document: record it as
      // skipped and keep walking.
      let theme: ReturnType<typeof extractTailwindV4Tokens> | null = null;
      let cssTokens;
      try {
        // The text test is only a cheap filter to skip a PostCSS parse. Whether a
        // `@theme` BLOCK exists is decided by the parser: the string also occurs
        // in comments, and "@theme block" is a claim about the reader's file.
        if (css.includes("@theme")) theme = extractTailwindV4Tokens(css);
        cssTokens = extractCssTokens(css);
      } catch (error) {
        skipped.push(`${file} (unparseable CSS: ${cssParseMessage(error)})`);
        continue;
      }
      let claimed = false;
      if (theme?.hasTheme) {
        const facts = toContributions(theme.tokens, file);
        contributions.push(...facts);
        sources.push({
          path: file,
          kind: "tailwind-v4-theme",
          tokens: facts.length,
          note: facts.length > 0 ? "@theme block" : "@theme block declaring no canonical tokens",
        });
        claimed = true;
      }
      const cssFacts = toContributions(cssTokens, file);
      if (cssFacts.length > 0) {
        contributions.push(...cssFacts);
        sources.push({
          path: file,
          kind: "css-custom-properties",
          tokens: cssFacts.length,
          note: ":root / theme scopes",
        });
      } else if (!claimed) {
        // Read, parsed, and it declared nothing. Report it anyway: a stylesheet
        // that styles entirely with utility classes is a legitimate result, and
        // silence here reads as "the walk never saw your file".
        sources.push({
          path: file,
          kind: "css-custom-properties",
          tokens: 0,
          note: "no custom properties in :root/html or a theme scope",
        });
      }
      continue;
    }

    if (isTokensFile(name)) {
      const raw = read(file);
      if (raw === null) continue;
      let doc: unknown;
      try {
        doc = JSON.parse(raw);
      } catch {
        skipped.push(`${file} (invalid JSON)`);
        continue;
      }
      const result = extractTokensJsonWithDiagnostics(doc);
      const facts = toContributions(result.tokens, file);
      contributions.push(...facts);
      for (const diagnostic of result.diagnostics) diagnostics.push({ source: file, diagnostic });
      sources.push({
        path: file,
        kind: "dtcg-tokens",
        tokens: facts.length,
        note: result.diagnostics.length === 0 ? "no diagnostics" : `${result.diagnostics.length} diagnostic(s)`,
      });
      continue;
    }

    if (TAILWIND_CONFIG.test(name)) {
      if (!options.execTailwindConfig) {
        sources.push({
          path: file,
          kind: "tailwind-v3-config",
          tokens: 0,
          note: "not evaluated (pass --exec-tailwind-config)",
        });
        continue;
      }
      const loader = options.configLoader;
      if (!loader) {
        sources.push({ path: file, kind: "tailwind-v3-config", tokens: 0, note: "no config loader supplied" });
        continue;
      }
      const tokens = await extractTailwindV3TokensFromFile(join(root, file), loader);
      const facts = toContributions(tokens, file);
      contributions.push(...facts);
      sources.push({
        path: file,
        kind: "tailwind-v3-config",
        tokens: facts.length,
        note: facts.length > 0 ? "evaluated in worker" : "evaluated in worker, no tokens resolved",
      });
      continue;
    }

    if (atRoot && name === "package.json") {
      const raw = read(file);
      if (raw === null) continue;
      let pkg: unknown;
      try {
        pkg = JSON.parse(raw);
      } catch {
        skipped.push(`${file} (invalid JSON)`);
        continue;
      }
      components = extractComponentConventions(pkg as Parameters<typeof extractComponentConventions>[0]);
      sources.push({
        path: file,
        kind: "component-libraries",
        tokens: 0,
        note:
          components.length > 0
            ? `${components.length} library: ${components.map((c) => c.name).join(", ")}`
            : "no recognised component library (shadcn/ui, radix, mui, chakra, mantine)",
      });
      continue;
    }

    if (atRoot && (name === ".designreview.yml" || name === ".designreview.yaml")) {
      const raw = read(file);
      if (raw === null) continue;
      identity = extractBrandIdentity(raw);
      const stated = [
        identity.tone ? "tone" : null,
        identity.audience ? "audience" : null,
        identity.dos.length > 0 ? `${identity.dos.length} do` : null,
        identity.donts.length > 0 ? `${identity.donts.length} don't` : null,
      ].filter((part): part is string => part !== null);
      sources.push({
        path: file,
        kind: "brand-identity",
        tokens: 0,
        note: stated.length > 0 ? stated.join(", ") : "no brand block",
      });
    }
  }

  sources.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));

  return {
    root,
    filesWalked: state.files.length,
    sources,
    contributions,
    diagnostics,
    identity,
    components,
    skipped,
    truncated: state.truncationReasons.size > 0,
    truncationReasons: [...state.truncationReasons],
  };
}
