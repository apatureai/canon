import type { Conflict, DnaTokens, Fact } from "@uidna/schema";
import type { ContextBlock, TokensJsonResolution } from "@uidna/context";
import { projectTokenValue } from "@uidna/context";
import type { DriftHint } from "@uidna/reconcile";
import type { ScanDiagnostic, ScannedSource } from "./scan.js";
import { tokenCountsByGroup } from "./genome.js";

/**
 * Terminal rendering. Kept pure (data in, string out) so the report a reader
 * sees is exactly what the tests assert on.
 */

const pad = (text: string, width: number): string => (text.length >= width ? text : text + " ".repeat(width - text.length));

const widest = (items: string[], cap = 44): number => Math.min(cap, items.reduce((max, item) => Math.max(max, item.length), 0));

/**
 * Composite values (a shadow, a typography object) serialize to long JSON. The
 * REPORT elides them at a fixed width so the table stays readable; `--json`
 * prints the exact resolved value and is what a consumer should parse.
 */
const MAX_VALUE_WIDTH = 64;

function elide(value: string): string {
  return value.length <= MAX_VALUE_WIDTH ? value : `${value.slice(0, MAX_VALUE_WIDTH - 3)}... (--json for the exact value)`;
}

function derivationSummary(steps: { kind: string; to: string }[]): string {
  if (steps.length === 0) return "";
  return `<- ${steps.map((step) => step.to).join(" <- ")}`;
}

/** The `ui-dna tokens` report: what resolved, and what refused to resolve. */
export function formatTokensReport(resolution: TokensJsonResolution, sourceLabel: string): string {
  const lines: string[] = [];
  lines.push(`ui-dna tokens - ${sourceLabel}`);
  lines.push(`profile        DTCG Format Module ${resolution.profile.formatModule}`);
  lines.push(
    `               aliases=${resolution.profile.aliases} $ref=${resolution.profile.jsonPointer} $extends=${resolution.profile.groupExtends}`,
  );
  lines.push("");
  lines.push(`resolved tokens (${resolution.tokens.length})`);
  if (resolution.tokens.length === 0) {
    lines.push("  (none)");
  } else {
    const nameWidth = widest(resolution.tokens.map((token) => token.name));
    const typeWidth = widest(resolution.tokens.map((token) => token.type ?? "untyped"), 14);
    for (const token of resolution.tokens) {
      const value = elide(projectTokenValue(token.value, token.type));
      const trail = derivationSummary(token.derivation);
      lines.push(
        `  ${pad(token.name, nameWidth)}  ${pad(token.type ?? "untyped", typeWidth)}  ${value}${trail ? `  ${trail}` : ""}`,
      );
    }
  }
  lines.push("");
  lines.push(`diagnostics (${resolution.diagnostics.length})`);
  if (resolution.diagnostics.length === 0) {
    lines.push("  (none)");
  } else {
    const codeWidth = widest(resolution.diagnostics.map((d) => d.code), 30);
    for (const diagnostic of resolution.diagnostics) {
      lines.push(`  ${pad(diagnostic.code, codeWidth)}  ${diagnostic.path || "(document)"}  ${diagnostic.message}`);
    }
    lines.push("");
    lines.push("  A diagnostic means the token was ABSTAINED, not guessed: it is absent from the");
    lines.push("  resolved list above rather than promoted with its reference syntax as a value.");
  }
  return lines.join("\n");
}

export interface ContextReportInput {
  root: string;
  filesWalked: number;
  sources: ScannedSource[];
  tokens: DnaTokens;
  conflicts: Conflict[];
  conflictSources: Record<string, string[]>;
  driftHints: DriftHint[];
  diagnostics: ScanDiagnostic[];
  skipped: string[];
  truncated: boolean;
  contextBlock: ContextBlock;
  identityStated: number;
  componentLibraries: string[];
  outFile: string | null;
}

function formatConflict(
  conflict: Conflict,
  sources: string[],
  resolved: Fact<string> | undefined,
): string[] {
  const lines: string[] = [];
  const resolvedText = resolved
    ? `resolved "${resolved.value}" (${resolved.provenance}, confidence ${resolved.confidence.toFixed(2)})`
    : "resolved (unavailable)";
  lines.push(`  ${conflict.field}  ${resolvedText}`);
  conflict.candidates.forEach((candidate, index) => {
    const source = sources[index] ?? "(unknown source)";
    lines.push(
      `      "${candidate.value}"  ${candidate.provenance} ${candidate.confidence.toFixed(2)}  ${source}`,
    );
  });
  lines.push(`      confidence delta ${conflict.confidenceDelta >= 0 ? "+" : ""}${conflict.confidenceDelta.toFixed(2)}`);
  return lines;
}

function lookupResolved(tokens: DnaTokens, field: string): Fact<string> | undefined {
  const parts = field.split(".");
  const group = parts[1] as keyof DnaTokens | undefined;
  const name = parts.slice(2).join(".");
  if (!group || !(group in tokens)) return undefined;
  return (tokens[group] as Record<string, Fact<string>>)[name];
}

/** How many "read it, it declared nothing" CSS rows the table prints before rolling up. */
const EMPTY_CSS_ROWS_SHOWN = 8;

const isEmptyCss = (source: ScannedSource): boolean =>
  source.kind === "css-custom-properties" && source.tokens === 0;

/** The `ui-dna context` report: sources found, facts resolved, disagreements kept. */
export function formatContextReport(input: ContextReportInput): string {
  const lines: string[] = [];
  lines.push(`ui-dna context - ${input.root}`);
  lines.push("");

  lines.push(`sources (${input.sources.length} of ${input.filesWalked} files walked)`);
  if (input.sources.length === 0) {
    // Say only what the walk actually established. Every candidate file that was
    // opened is listed above with its token count, so an empty table means the
    // walk found no candidate file at all - not that a file yielded nothing.
    lines.push(
      `  (none: walked ${input.filesWalked} file${input.filesWalked === 1 ? "" : "s"} and none of them was a`,
    );
    lines.push("   .css, tokens.json/*.tokens.json, tailwind.config.*, root package.json or root .designreview.yml.");
    lines.push("   Check the path, and note that node_modules/dist/build/out and friends are never entered.)");
  } else {
    // A CSS-modules repo can hold hundreds of stylesheets that declare no
    // custom properties. They stay in the DATA (`--json` lists every one), but
    // the terminal table shows a bounded sample and then counts the rest.
    let shownEmptyCss = 0;
    const rows = input.sources.filter(
      (source) => !isEmptyCss(source) || (shownEmptyCss += 1) <= EMPTY_CSS_ROWS_SHOWN,
    );
    const hiddenEmptyCss = input.sources.length - rows.length;
    const pathWidth = widest(rows.map((source) => source.path));
    const kindWidth = widest(rows.map((source) => source.kind), 24);
    for (const source of rows) {
      const tokens = source.tokens > 0 ? `${source.tokens} tokens` : "-";
      lines.push(`  ${pad(source.path, pathWidth)}  ${pad(source.kind, kindWidth)}  ${pad(tokens, 10)}  ${source.note}`);
    }
    if (hiddenEmptyCss > 0) {
      lines.push(
        `  ... and ${hiddenEmptyCss} more .css file${hiddenEmptyCss === 1 ? "" : "s"} read that declared no custom properties (--json lists them all)`,
      );
    }
  }
  lines.push("");

  const counts = tokenCountsByGroup(input.tokens);
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  lines.push(`resolved tokens (${total})`);
  for (const { group, count } of counts) lines.push(`  ${pad(group, 12)}  ${count}`);
  if (total === 0 && input.sources.length > 0) {
    // The files were read; they declared nothing. Say what "declared" means here
    // rather than leaving a bare 0 that reads like a failed scan. Only a
    // DECLARATION site counts: utility classes and rendered output are not one.
    lines.push("  (none declared. ui-dna reads tokens a repository states outright: a :root/html/.dark/");
    lines.push("   [data-theme] custom-property block, a Tailwind v4 @theme block, a DTCG or Style");
    lines.push("   Dictionary token file, or a Tailwind v3 config with --exec-tailwind-config. It does");
    lines.push("   not infer a scale from utility classes or from rendered output, so it abstains here");
    lines.push("   instead of guessing. Each source above states what it contributed.)");
  }
  lines.push("");

  lines.push(`identity facts (${input.identityStated})`);
  lines.push(`component libraries (${input.componentLibraries.length})${input.componentLibraries.length > 0 ? `  ${input.componentLibraries.join(", ")}` : ""}`);
  lines.push("");

  lines.push(`conflicts (${input.conflicts.length})`);
  if (input.conflicts.length === 0) {
    lines.push("  (none: no two sources declared the same token with different values)");
  } else {
    for (const conflict of input.conflicts) {
      lines.push(
        ...formatConflict(conflict, input.conflictSources[conflict.field] ?? [], lookupResolved(input.tokens, conflict.field)),
      );
    }
  }
  lines.push("");

  lines.push(`drift hints (${input.driftHints.length})`);
  if (input.driftHints.length === 0) lines.push("  (none)");
  else for (const hint of input.driftHints) lines.push(`  ${hint.message}`);
  lines.push("");

  lines.push(`token diagnostics (${input.diagnostics.length})`);
  if (input.diagnostics.length === 0) lines.push("  (none)");
  else {
    for (const entry of input.diagnostics) {
      lines.push(`  ${entry.source}  ${entry.diagnostic.code}  ${entry.diagnostic.path || "(document)"}  ${entry.diagnostic.message}`);
    }
  }

  if (input.skipped.length > 0) {
    lines.push("");
    lines.push(`skipped files (${input.skipped.length})`);
    for (const entry of input.skipped) lines.push(`  ${entry}`);
  }
  if (input.truncated) {
    lines.push("");
    lines.push("walk truncated by a depth or file-count bound; raise --max-files / --max-depth to see the rest");
  }

  lines.push("");
  lines.push("context block");
  lines.push(`  contextVersion  ${input.contextBlock.contextVersion}`);
  lines.push(`  contentHash     sha256:${input.contextBlock.contentHash}`);
  lines.push(`  bytes           ${Buffer.byteLength(input.contextBlock.serialized, "utf8")}`);
  lines.push("  the hash is content-addressed: identical sources produce an identical hash, and");
  lines.push("  approving or re-versioning the genome does not change it.");
  if (input.outFile) {
    lines.push("");
    lines.push(`wrote draft genome  ${input.outFile}`);
  }
  return lines.join("\n");
}
