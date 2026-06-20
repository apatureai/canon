# LOOP.md — self-improving build playbook (ui-dna)

Living know-how for the autonomous build loop. Read at the start of every run;
append concrete learnings at the end. Mirrors the conventions proven in
apatureai/judgment-engine and apatureai/gate.

## How to run (each fire)

1. Sync: `git fetch`, checkout `agent/build`, `git pull --ff-only`, merge
   `origin/main` (stop only if conflicts are non-trivial).
2. Read this file, `PROGRESS.md` (UD0→UD6 checklist), and the plan (`PRD.md`;
   `TRD.md`/`ARCHITECTURE.md` once the research loop has authored them — until
   then derive design from the PRD).
3. Pick the first `[ ]` in PROGRESS whose deps are `[x]`. View the issue:
   `gh issue view <N> --repo apatureai/ui-dna`. `#0` is the scaffold — create the
   GitHub issue if it does not exist, then implement it.
4. Implement per acceptance criteria, with tests. NEVER call a real model or
   launch a real browser/sandbox in tests — build against stubs / fixtures. If an
   issue genuinely needs LIVE infra (real capture, GPU, customer repos), mark it
   `[~]` and take the next unblocked one.
5. Verify green: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm lint`.
6. Flip `PROGRESS.md`, commit (plain message, **no AI attribution**), push, keep
   ONE PR `agent/build -> main` titled "Apature UI DNA build (agent)" updated with
   `Closes #<N>` lines (open a new PR if the current one is merged/closed). Don't
   merge it; leave for human review.
7. Comment 2-3 lines on the issue. Update this log before ending.

## Conventions (inherited; don't rediscover)

- **Port, don't reinvent — judgment-engine's `@engine/context` already built the
  UD1/UD2 extractors** as boundary-clean, tested pure functions (Tailwind v3
  resolveConfig, Tailwind v4 `@theme`, CSS custom properties, tokens.json,
  component detection, brand block, diff→route MVP, content-hashed context-block
  serialization). UI DNA is the canonical owner: port those modules here, keep
  their test coverage, then file a follow-up so the engine consumes ui-dna instead
  of its local copy. This is the boundary convergence the ECOSYSTEM intends — do
  not duplicate-and-diverge.
- **The DNA schema (`@uidna/schema`) is the contract.** Every extractor fills it;
  every field carries confidence + provenance (code/pixels/config/human/feedback)
  and the snapshot carries version metadata + approval state (PRD §5). Evolve the
  schema additive-only behind a schema version; downstream consumers (Gate, etc.)
  read it like the engine reads its golden wire fixture.
- **Determinism is a hard requirement (PRD §7):** same repo state → same draft
  unless model/schema/extraction version changes. Serialize with sorted keys, no
  timestamps; content-hash for cache invalidation, never wall-clock TTL.
- **Package layout:** one concern per `packages/*`, own `tsconfig.json`
  (`rootDir: src`, `outDir: dist`) added to root `references`; tests in
  `packages/*/test/**`; add new packages to the `vitest.config.ts` alias map.
- **ESM/NodeNext/verbatimModuleSyntax**; `import type` + `.js` extensions; `lint`
  is `eslint . --max-warnings=0`.
- **Prefer real in-process tests:** fixtures for configs/CSS/token files; mock
  Gate's capture engine for rendered evidence; leave real provisioning (capture
  fleet, customer repos, KMS) as `[~]` ops steps.
- **Boundary (PRD §11):** own the schema, extraction pipeline, versioning, and
  downstream read contract. Never write customer code; read-only repo access;
  consume — don't own — Gate's capture engine.

## Self-improvement log (newest first)

- 2026-06-20 (scaffold): repo scoped for the build loop. Seeded `PROGRESS.md`
  (UD0 scaffold + the 10 existing context issues #1–#10, grouped UD1/UD2; UD3–UD6
  PRD components flagged for the research loop to file) and this playbook. Key
  setup learning: the 10 open issues are the context-extraction MVP that
  judgment-engine ALREADY implemented in `@engine/context` — the first build runs
  should port those proven pure modules (fast, already tested) and establish
  ui-dna as the genome owner, rather than re-deriving. The `@uidna/schema` package
  (#0) must land first since it is the contract every extractor fills. No TRD/
  ARCHITECTURE yet — derive from the PRD until the research loop authors them.
