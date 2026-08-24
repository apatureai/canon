import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { buildContextBlock, resolveTokensJson } from "@apatureai/canon-context";
import { computeDriftHints } from "@apatureai/canon-reconcile";
import { validateSnapshot } from "@apatureai/canon-schema";
import type { DnaSnapshot } from "@apatureai/canon-schema";
import { buildGenome } from "./genome.js";
import { formatContextReport, formatTokensReport } from "./format.js";
import { approveGenome, EXPORT_TARGETS, isExportTarget, projectForTarget } from "./publish.js";
import { scanProject } from "./scan.js";
import { createWorkerConfigLoader } from "./tailwind-config-loader.js";

/**
 * `ui-dna`, the command line. The libraries in this repo are pure functions
 * over strings; this is the layer that reads a disk and prints a report, and
 * it is deliberately the only layer that does either.
 *
 * `runCli` takes its argv and its output sinks as arguments and RETURNS an exit
 * code rather than calling `process.exit`, so the whole surface is testable in
 * process (`packages/cli/test/cli-tokens.test.ts` and `cli-context.test.ts` run
 * the same entry point the terminal does).
 */

export const CLI_VERSION = "0.1.1";
/** Stamped into `metadata.extractionVersion`; excluded from the content hash. */
export const EXTRACTION_VERSION = `ui-dna-cli@${CLI_VERSION}`;

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  cwd: string;
}

/** 0 success · 1 usage or IO failure · 2 `--strict` and the report was not clean. */
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_STRICT = 2;

const USAGE = `ui-dna - read a codebase's design system out of its own files

usage
  ui-dna tokens <file.json> [options]     resolve a DTCG 2025.10 token file
  ui-dna context <directory> [options]    build a design-system context block
  ui-dna approve <genome.json> [options]  promote a draft genome to approved
  ui-dna export <genome.json> --target <consumer> [options]
                                          project an approved genome into a
                                          downstream consumer's read contract

tokens options
  --json                  print the resolution as JSON instead of a report
  --strict                exit 2 when any diagnostic was raised

context options
  --json                  print the scan, genome and context block as JSON
  --out <file>            write the draft genome (DnaSnapshot) as JSON
  --repo <owner/name>     repository identity stamped into the genome
                          (default: local/<directory name>)
  --exec-tailwind-config  evaluate tailwind.config.* files. They are EXECUTABLE
                          code; they run in a worker thread with a timeout, which
                          bounds failure, not privilege. Off by default.
  --max-depth <n>         directory depth bound (default 8)
  --max-files <n>         file count bound (default 5000)
  --strict                exit 2 when any conflict or diagnostic was raised,
                          when a bound truncated the walk, or when a candidate
                          design source could not be read (a scan that did not
                          examine everything reports lower bounds, so it can
                          never pass a gate)

approve options
  --out <file>            write the approved DnaSnapshot as JSON
                          Sign-off confirms the resolved genome as-is and stamps
                          it with its content-addressed immutable dnaVersion.

export options
  --target <consumer>     which downstream contract to project into, one of:
                          ${EXPORT_TARGETS.join(", ")} (required)
  --out <file>            write the projected profile as JSON
                          The genome must be approved (run "approve" first);
                          drafts and in-review genomes are refused.

general
  -h, --help              print this help
  -v, --version           print the version

examples
  ui-dna tokens examples/sample-tokens.json
  ui-dna context examples/sample-project --out out/genome.json
  ui-dna approve out/genome.json --out out/approved.json
  ui-dna export out/approved.json --target verdict --out out/verdict.json`;

interface ParsedArgs {
  command: string | null;
  target: string | null;
  json: boolean;
  strict: boolean;
  out: string | null;
  repo: string | null;
  exportTarget: string | null;
  execTailwindConfig: boolean;
  maxDepth: number | null;
  maxFiles: number | null;
  help: boolean;
  version: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: null,
    target: null,
    json: false,
    strict: false,
    out: null,
    repo: null,
    exportTarget: null,
    execTailwindConfig: false,
    maxDepth: null,
    maxFiles: null,
    help: false,
    version: false,
  };
  const takeValue = (flag: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith("-")) throw new UsageError(`${flag} needs a value`);
    return next;
  };
  const takeNumber = (flag: string, next: string | undefined): number => {
    const value = Number(takeValue(flag, next));
    if (!Number.isInteger(value) || value <= 0) throw new UsageError(`${flag} needs a positive integer`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    switch (arg) {
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "-v":
      case "--version":
        parsed.version = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--strict":
        parsed.strict = true;
        break;
      case "--exec-tailwind-config":
        parsed.execTailwindConfig = true;
        break;
      case "--out":
        parsed.out = takeValue(arg, argv[index + 1]);
        index += 1;
        break;
      case "--repo":
        parsed.repo = takeValue(arg, argv[index + 1]);
        index += 1;
        break;
      case "--target":
        parsed.exportTarget = takeValue(arg, argv[index + 1]);
        index += 1;
        break;
      case "--max-depth":
        parsed.maxDepth = takeNumber(arg, argv[index + 1]);
        index += 1;
        break;
      case "--max-files":
        parsed.maxFiles = takeNumber(arg, argv[index + 1]);
        index += 1;
        break;
      default:
        if (arg.startsWith("-")) throw new UsageError(`unknown option ${arg}`);
        if (parsed.command === null) parsed.command = arg;
        else if (parsed.target === null) parsed.target = arg;
        else throw new UsageError(`unexpected argument ${arg}`);
    }
  }
  return parsed;
}

function absolute(cwd: string, target: string): string {
  return isAbsolute(target) ? target : resolve(cwd, target);
}

function splitRepo(repo: string | null, fallbackName: string): { owner: string; name: string } {
  if (repo === null) return { owner: "local", name: fallbackName };
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new UsageError(`--repo expects owner/name, got "${repo}"`);
  return { owner, name };
}

function runTokens(args: ParsedArgs, io: CliIo): number {
  if (args.target === null) throw new UsageError("tokens needs a path to a token file");
  const path = absolute(io.cwd, args.target);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    io.err(`cannot read ${args.target}`);
    return EXIT_ERROR;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    io.err(`${args.target} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_ERROR;
  }

  const resolution = resolveTokensJson(doc);
  io.out(args.json ? JSON.stringify(resolution, null, 2) : formatTokensReport(resolution, args.target));
  return args.strict && resolution.diagnostics.length > 0 ? EXIT_STRICT : EXIT_OK;
}

async function runContext(args: ParsedArgs, io: CliIo): Promise<number> {
  if (args.target === null) throw new UsageError("context needs a path to a project directory");
  const root = absolute(io.cwd, args.target);
  try {
    if (!statSync(root).isDirectory()) {
      io.err(`${args.target} is not a directory`);
      return EXIT_ERROR;
    }
  } catch {
    io.err(`cannot read directory ${args.target}`);
    return EXIT_ERROR;
  }

  const repo = splitRepo(args.repo, basename(root));
  const scan = await scanProject(root, {
    execTailwindConfig: args.execTailwindConfig,
    configLoader: args.execTailwindConfig ? createWorkerConfigLoader() : undefined,
    ...(args.maxDepth !== null ? { maxDepth: args.maxDepth } : {}),
    ...(args.maxFiles !== null ? { maxFiles: args.maxFiles } : {}),
  });

  const genome = buildGenome(scan, { ...repo, extractionVersion: EXTRACTION_VERSION });
  const validation = validateSnapshot(genome.snapshot);
  if (!validation.ok) {
    for (const error of validation.errors) io.err(`invalid genome: ${error}`);
    return EXIT_ERROR;
  }
  const contextBlock = buildContextBlock(genome.snapshot);
  const driftHints = computeDriftHints(genome.conflicts);

  let outFile: string | null = null;
  if (args.out !== null) {
    const target = absolute(io.cwd, args.out);
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(genome.snapshot, null, 2)}\n`, "utf8");
      outFile = args.out;
    } catch (error) {
      io.err(`cannot write ${args.out}: ${error instanceof Error ? error.message : String(error)}`);
      return EXIT_ERROR;
    }
  }

  const identityStated =
    (scan.identity.tone ? 1 : 0) +
    (scan.identity.audience ? 1 : 0) +
    (scan.identity.name ? 1 : 0) +
    scan.identity.dos.length +
    scan.identity.donts.length;

  if (args.json) {
    io.out(
      JSON.stringify(
        {
          root: args.target,
          filesWalked: scan.filesWalked,
          sources: scan.sources,
          conflicts: genome.conflicts,
          conflictSources: genome.conflictSources,
          driftHints,
          diagnostics: scan.diagnostics,
          skipped: scan.skipped,
          truncated: scan.truncated,
          truncationReasons: scan.truncationReasons,
          contextBlock,
          snapshot: genome.snapshot,
        },
        null,
        2,
      ),
    );
  } else {
    io.out(
      formatContextReport({
        root: args.target,
        filesWalked: scan.filesWalked,
        sources: scan.sources,
        tokens: genome.snapshot.tokens,
        conflicts: genome.conflicts,
        conflictSources: genome.conflictSources,
        driftHints,
        diagnostics: scan.diagnostics,
        skipped: scan.skipped,
        truncated: scan.truncated,
        truncationReasons: scan.truncationReasons,
        contextBlock,
        identityStated,
        componentLibraries: genome.snapshot.components.map((component) => component.name),
        outFile,
      }),
    );
  }

  // A gate that passes because the walk ran out of budget is not a gate. A
  // truncated scan reports lower bounds, so "0 conflicts, 0 diagnostics" is
  // "none found before I stopped looking" and cannot stand in for "clean".
  if (args.strict && scan.truncated) {
    io.err(
      `--strict: the walk did not finish (${scan.truncationReasons.join("; ")}), so this report ` +
        `is a lower bound over ${scan.filesWalked} file${scan.filesWalked === 1 ? "" : "s"}, not a clean result. ` +
        "Raise --max-files / --max-depth and run again.",
    );
    return EXIT_STRICT;
  }

  // The same argument, one hole further in. A candidate design source the walk
  // found and could not parse was never handed to a resolver, so it raised no
  // diagnostic and joined no conflict. "conflicts (0), token diagnostics (0)"
  // then means "none among the files I could read", and a repository whose only
  // token file was malformed used to pass this gate with a clean bill of health.
  if (args.strict && scan.skipped.length > 0) {
    const count = scan.skipped.length;
    io.err(
      `--strict: ${count} candidate design source${count === 1 ? "" : "s"} could not be read ` +
        `(${scan.skipped.join("; ")}), so this report is a lower bound over the sources that were ` +
        "parsed, not a clean result. Fix or exclude them and run again.",
    );
    return EXIT_STRICT;
  }

  const clean = genome.conflicts.length === 0 && scan.diagnostics.length === 0;
  return args.strict && !clean ? EXIT_STRICT : EXIT_OK;
}

/** Read and parse a genome JSON file into a DnaSnapshot, or return an error message. */
function readGenome(args: ParsedArgs, io: CliIo): { snapshot: DnaSnapshot } | { error: string } {
  const path = absolute(io.cwd, args.target as string);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { error: `cannot read ${args.target}` };
  }
  try {
    return { snapshot: JSON.parse(raw) as DnaSnapshot };
  } catch (error) {
    return { error: `${args.target} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Serialize a JSON payload to `--out` (when given) or stdout. */
function emit(payload: unknown, args: ParsedArgs, io: CliIo): number {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (args.out === null) {
    io.out(text.trimEnd());
    return EXIT_OK;
  }
  const target = absolute(io.cwd, args.out);
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, "utf8");
  } catch (error) {
    io.err(`cannot write ${args.out}: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

async function runApprove(args: ParsedArgs, io: CliIo): Promise<number> {
  if (args.target === null) throw new UsageError("approve needs a path to a genome file");
  const read = readGenome(args, io);
  if ("error" in read) {
    io.err(read.error);
    return EXIT_ERROR;
  }
  let approved: DnaSnapshot;
  try {
    approved = await approveGenome(read.snapshot);
  } catch (error) {
    io.err(`cannot approve ${args.target}: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_ERROR;
  }
  return emit(approved, args, io);
}

async function runExport(args: ParsedArgs, io: CliIo): Promise<number> {
  if (args.target === null) throw new UsageError("export needs a path to a genome file");
  const consumer = args.exportTarget;
  if (consumer === null) {
    throw new UsageError(`export needs --target <consumer>, one of: ${EXPORT_TARGETS.join(", ")}`);
  }
  if (!isExportTarget(consumer)) {
    throw new UsageError(`unknown --target "${consumer}", expected one of: ${EXPORT_TARGETS.join(", ")}`);
  }
  const read = readGenome(args, io);
  if ("error" in read) {
    io.err(read.error);
    return EXIT_ERROR;
  }
  let profile: unknown;
  try {
    profile = projectForTarget(read.snapshot, consumer);
  } catch (error) {
    io.err(`cannot export ${args.target} to ${consumer}: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_ERROR;
  }
  return emit(profile, args, io);
}

/** Run one invocation. Returns the process exit code; never calls process.exit. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.err(error instanceof UsageError ? error.message : String(error));
    io.err(USAGE);
    return EXIT_ERROR;
  }

  if (args.version) {
    io.out(CLI_VERSION);
    return EXIT_OK;
  }
  if (args.help || args.command === null) {
    io.out(USAGE);
    return args.command === null && !args.help ? EXIT_ERROR : EXIT_OK;
  }

  try {
    switch (args.command) {
      case "tokens":
        return runTokens(args, io);
      case "context":
        return await runContext(args, io);
      case "approve":
        return await runApprove(args, io);
      case "export":
        return await runExport(args, io);
      default:
        io.err(`unknown command "${args.command}"`);
        io.err(USAGE);
        return EXIT_ERROR;
    }
  } catch (error) {
    io.err(error instanceof UsageError ? error.message : `failed: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof UsageError) io.err(USAGE);
    return EXIT_ERROR;
  }
}
