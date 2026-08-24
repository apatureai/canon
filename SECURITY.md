# Security Policy

## Supported versions

The public `@apatureai/*` packages are published to npm starting at `v0.1.1`. **The supported
release line is the latest published version (currently `0.1.1`), plus the current `main`
branch.** Older tags are points you can cite and diff against, not maintained release lines:
fixes land on `main` and ship in the next version rather than being backported. If you are
running a fork or a vendored copy, rebase onto `main` to pick them up.

## Reporting a vulnerability

Report privately through GitHub: **Security → Advisories → Report a vulnerability** on this
repository. Private vulnerability reporting is enabled. Please do not open a public issue for a
suspected vulnerability.

Include what you would want to receive: affected file or function, the input that triggers it, what
an attacker gains, and a reproduction if you have one.

What to expect:

- **Acknowledgement within 5 business days.**
- An initial assessment (accepted, needs more information, or out of scope with a reason) within 10
  business days.
- For an accepted report, a fix on `main` and a published GitHub Security Advisory crediting you
  unless you prefer otherwise.
- Coordinated disclosure. Tell us if you have a disclosure deadline and it will be respected; 90
  days is a reasonable default.

There is no bug bounty. Credit in the advisory and in the release notes is what is on offer.

Vulnerabilities in third-party **dependencies** should go upstream to that project. If a dependency
advisory affects this repository specifically, an issue is the right place, not a private report.

## Scope

In scope: everything under `packages/*/src`, `packages/cli/worker`, `scripts/`, and the GitHub
Actions workflow.

Out of scope: findings that require an attacker to already control the machine running the CLI, and
the deliberate behaviour of `--exec-tailwind-config` described below.

## What this code does, so you can size the risk yourself

A set of pure TypeScript libraries that turn a front-end project's declared design information into
a versioned JSON snapshot (schema types, static token and brand extractors, evidence reconciliation,
an in-memory snapshot store, an eval harness), plus one command line (`@apatureai/canon`) that reads files
from disk and feeds them to those libraries.

The honest risk surface:

- **I/O is confined to one package.** Nothing in
  `@apatureai/{canon-schema,canon-context,canon-render,canon-reconcile,canon-store,canon-eval}` reads the filesystem, opens a network
  connection, spawns a child process, or reads environment variables or credentials: callers pass
  content in as strings and plain objects and get values back. `@apatureai/canon` reads files (bounded by
  depth, file count and a 2 MiB per-file ceiling) and writes only where `--out` points. There is no
  server and no daemon, and rendered evidence arrives through the `@apatureai/canon-render` input port as data
  some other system captured.
- **It parses untrusted input by design.** CSS and CSS custom properties, DTCG `tokens.json`, YAML
  config, and resolved Tailwind theme objects, all of it typically originating from somebody else's
  repository. Parsing is regex-heavy in places. If you embed the libraries in a service, treat every
  input as hostile: budget CPU and time, cap input size, and do not assume adversarial input parses
  quickly. Resolution is bounded by a resource limit that raises a `resource_limit` diagnostic, but
  that is a budget, not a proof.
- **One genuinely sharp edge: evaluating a Tailwind config.** A `tailwind.config.js` is *executable
  code*. `packages/context/src/tailwind.ts` keeps that behind an injected `ConfigLoader` port, and
  `packages/cli/src/tailwind-config-loader.ts` ships the real implementation: the config is imported
  in a `worker_threads` worker with a wall-clock timeout, and the CLI starts that worker only when
  you pass `--exec-tailwind-config`. **A worker thread is isolation, not a sandbox.** It bounds
  hangs, throws and stack overflows; it does not remove privilege. The config can still read files,
  spawn processes and open sockets as your user. Do not point `--exec-tailwind-config` at a
  repository you would not `npm install`. If you need a real boundary, run the CLI in a container.
- **Secret and PII scrubbing is pattern-based.** `packages/store/src/residency.ts` redacts
  credential- and PII-shaped strings from egress and access logs. It is defense in depth against
  accidental leakage, not a guarantee. The test suite contains deliberately synthetic
  credential-shaped fixtures (`sk-ABCDEF...`, `ghp_ABCDEF...`, `AKIAABCDEF...`) that exist to prove
  redaction works; none of them are real.

## Hardening advice

- Run extraction with the least privilege that works: a container or a CI job with a read-only
  token, not a privileged job with broad credentials.
- Leave `--exec-tailwind-config` off unless you trust the scanned repository.
- Dependencies are pinned in `pnpm-lock.yaml`. Run `pnpm audit` in your own environment, and report
  dependency issues upstream.
