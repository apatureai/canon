# Security Policy

## Status: archived and unmaintained

This repository is a public archive of a product that was wound down. It is **not maintained and
receives no security support**:

- No security patches will be issued.
- No security advisories will be published.
- Dependencies will not be updated, even for known CVEs. Automated dependency updates have been
  turned off; the pinned versions in `pnpm-lock.yaml` were current in mid-2026 and will age.
- There is no bug bounty, and no reward of any kind is offered.

No package here was ever published to a registry: every workspace package is `private: true` at
version `0.0.0`. There is no released artifact for anyone to be exposed to transitively. The only
way to be affected by this code is to deliberately vendor or fork it.

## Reporting a vulnerability anyway

If you find something and want it on the record, open a private report through GitHub:
**Security → Advisories → Report a vulnerability** on this repository.

Please be realistic about what happens next. There is no response SLA, no triage rotation, and no
committed fix. A credible report will most likely result in a note added to this file or the
README so that people who fork the code know what they are inheriting, not a patch. Do not use a
private report as a way to hold a finding for embargo; you are free to disclose publicly whenever
you like.

Do not report vulnerabilities in the *dependencies* listed in `pnpm-lock.yaml`. See "If you run
this" below, and report those upstream.

## What this code actually does (so you can size the risk yourself)

This repo is a set of pure TypeScript libraries that turn a frontend project's design information
into a versioned "design genome" (schema types, static token/brand extractors, evidence
reconciliation, an immutable snapshot store, an eval harness), plus one command line
(`@uidna/cli`) that reads files from disk and feeds them to those libraries.

The honest risk surface, verified by reading `packages/*/src`:

- **I/O is confined to one package.** Nothing in `@uidna/{schema,context,render,reconcile,store,eval}`
  reads the filesystem, opens a network connection, spawns a child process, or reads environment
  variables or credentials: callers pass content in as strings and plain objects and get values
  back. `@uidna/cli` reads files (bounded by depth, file count and a 2 MiB per-file ceiling) and
  writes only where `--out` points. There is no server and no daemon, and rendered evidence still
  arrives through the `@uidna/render` input port as data some other system captured.
- **It parses untrusted input by design.** CSS and CSS custom properties, DTCG `tokens.json`,
  YAML config, and resolved Tailwind theme objects, all of it originating from somebody else's
  repository. Parsing is regex-heavy in places. Treat every input as hostile: budget CPU/time,
  cap input size, and do not assume adversarial input parses quickly.
- **One genuinely sharp edge: evaluating a Tailwind config.** A `tailwind.config.js` is
  *executable code*. `packages/context/src/tailwind.ts` keeps that behind an injected
  `ConfigLoader` port, and `packages/cli/src/tailwind-config-loader.ts` ships a real
  implementation: the config is imported in a `worker_threads` worker with a wall-clock timeout,
  and the CLI starts that worker only when you pass `--exec-tailwind-config`. **A worker thread is
  isolation, not a sandbox.** It bounds hangs, throws and stack overflows; it does not remove
  privilege. The config can still read files, spawn processes and open sockets as your user. Do
  not point `--exec-tailwind-config` at a repository you would not `npm install`. If you need a
  real boundary, run the whole CLI in a container.
- **Secret/PII scrubbing is pattern-based.** `packages/store/src/residency.ts` redacts
  credential- and PII-shaped strings from egress and access logs. It is defense in depth against
  accidental leakage, not a guarantee. The test suite contains deliberately synthetic
  credential-shaped fixtures (`sk-ABCDEF…`, `ghp_ABCDEF…`, `AKIAABCDEF…`) that exist to prove
  redaction works; none of them are real.

## If you run this

- Do not point it at production credentials, private repositories, or customer data without
  reviewing the code paths you actually call. It is unreviewed, unsupported software with no one
  behind it.
- Run extraction in an isolated environment (container or sandboxed worker), not in a privileged
  CI job with broad tokens.
- **Audit before you use it.** The lockfile pins versions that were current in 2026 and will age
  badly. Run `pnpm audit` on your own fork and update dependencies yourself; nobody here will do
  it for you.
