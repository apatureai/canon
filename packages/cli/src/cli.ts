import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { buildContextBlock, resolveTokensJson } from "@uidna/context";
import { computeDriftHints } from "@uidna/reconcile";
import { validateSnapshot } from "@uidna/schema";
import { buildGenome } from "./genome.js";
import { formatContextReport, formatTokensReport } from "./format.js";
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

export const CLI_VERSION = "0.0.0";
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
  --strict                exit 2 when any conflict or diagnostic was raised

general
  -h, --help              print this help
  -v, --version           print the version

examples
  ui-dna tokens examples/sample-tokens.json
  ui-dna context examples/sample-project --out out/genome.json`;

interface ParsedArgs {
  command: string | null;
  target: string | null;
  json: boolean;
  strict: boolean;
  out: string | null;
  repo: string | null;
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
        contextBlock,
        identityStated,
        componentLibraries: genome.snapshot.components.map((component) => component.name),
        outFile,
      }),
    );
  }

  const clean = genome.conflicts.length === 0 && scan.diagnostics.length === 0;
  return args.strict && !clean ? EXIT_STRICT : EXIT_OK;
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
