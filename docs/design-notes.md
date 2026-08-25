Part of [canon](../README.md). Moved from the README on 2026-08-24; anchors preserved.

## Who this is for

- **Design-token tooling authors** (Style Dictionary, Terrazzo, Tokens Studio, Figma variable sync,
  and anything else that has to load somebody else's `tokens.json`): a reference implementation of
  the DTCG Format Module 2025.10 resolution rules, with a diagnostic taxonomy for every way a
  document can fail, and a corpus benchmark that tells you what real-world token files actually
  look like.
- **Design-system maintainers** who want to know, mechanically, where their tokens are declared,
  where two files disagree, and whether the answer changed between two commits.
- **People building tools that need a machine-readable description of a repo's design system**,
  including agent tooling: the output is stable JSON with a content hash, and identical inputs
  always produce identical bytes.

## Why it is interesting

**Abstention is a feature.** A resolver that meets a circular alias, an unresolvable reference or a
malformed dimension has two options: guess, or refuse. `ui-dna` refuses, drops the token from the
resolved set, and emits one of 11 diagnostic codes naming the exact token and reason. Nothing is
silently promoted with its reference syntax as a value.

**Sources that disagree are the normal case.** Real repositories declare `--color-brand` in
`styles.css` and again in a `@theme` block with a different value. `reconcileField` resolves the
value by provenance precedence (`human > config > code > pixels`) and computes confidence
*separately*: agreement between independent sources reinforces it, disagreement keeps the winning
value but degrades its confidence in proportion to the dissent, and every candidate that lost is
still in the report. Every weight lives in one file (`packages/reconcile/src/thresholds.ts`) so
`@apatureai/canon-eval` can measure the ladder against labeled fixtures instead of leaving it as taste.

**Determinism is a hard constraint.** Serialization sorts keys and arrays recursively and contains
no timestamps; caches invalidate by content hash, never by wall clock. The same repository state
produces a byte-identical snapshot and the same `sha256:` context hash on every machine.

**A citable datapoint about the ecosystem.** `pnpm eval:dtcg-corpus` fetches 20 public token files
from GitHub by immutable blob SHA and resolves them under the strict 2025.10 profile. Last run
(2026-08-18, Node 24.14.0): **1,629 token-shaped nodes yielded 384 strict-profile tokens and 1,223
diagnostics**, so roughly 24% of what is out there in the wild satisfies the 2025.10 profile
without complaint. Ten of the 20 files resolved zero tokens; exactly one resolved with zero
diagnostics. Every one of those five numbers is printed by the command and reproducible on your
machine ([how](development.md)). Most of the rest use pre-2025 scalar `$value` shapes or split aliases across files.
That is compatibility evidence, not an accuracy score, and it is the number to argue with if you
think the profile is too strict.
