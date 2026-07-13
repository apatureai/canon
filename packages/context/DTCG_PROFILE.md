# DTCG support profile

Status: Format Module 2025.10 aliases/references; bounded Resolver compatibility.

`resolveTokensJson` implements the stable Design Tokens Community Group Format Module 2025.10 profile used by UI-DNA extraction:

- exact JSON token values, inherited types, chained curly aliases, same-document RFC 6901 `$ref`, property-level references, `$root`, and group `$extends`;
- deterministic alias/extension derivation chains and byte-stable key/token/diagnostic ordering;
- fail-closed diagnostics for unresolved/circular/type-invalid references, malformed structures, external sources, and resource ceilings;
- classic Style Dictionary `value` nodes remain an explicit compatibility path. They carry `type: null` when undeclared and are not described as DTCG-conformant.

The Resolver Module's sets, modifiers, `resolutionOrder`, filesystem sources, and remote sources are disabled. A Resolver document returns `unsupported_resolver_module`; an external `$ref` returns `unsupported_external_reference`. Adding those capabilities requires an injected sandboxed allowlisted loader and a versioned profile change.

Resolved composite values stay structured. `projectTokenValue` is the named legacy/UI-DNA string projection: colors prefer their preserved `hex`, dimensions and durations preserve value+unit, and other composite types use stable JSON. Invalid reference syntax is never projected to a `Fact`.

## Frozen evidence

The conformance and adversarial goldens in `test/fixtures` cover the final 2025.10 examples and required failure taxonomy. `pnpm eval:dtcg-corpus` additionally fetches 20 public design-token files by immutable Git blob SHA from `dtcg-real-corpus.json`; it requires network access and is intentionally outside default CI.

Baseline recorded July 12, 2026 on Node 25.2.1:

- 20/20 blobs fetched and parsed; repeated output was byte-identical.
- repeated-run p95 resolution time: 2.11-3.15 ms; peak process heap: 17.15-17.54 MiB (ceilings: 100 ms / 64 MiB).
- 1,629 raw token-shaped nodes; 384 strict-profile tokens emitted; 1,223 diagnostics.

The last line is compatibility evidence, not an accuracy score. Most sampled repositories use pre-2025 scalar `$value` shapes or split aliases across files; the old parser would stringify/promote those shapes, while the 2025.10 profile deliberately abstains unless the value is valid and all same-document references resolve. Official same-document conformance and adversarial cases are the correctness gate.

Normative sources: [Format Module 2025.10](https://www.designtokens.org/TR/2025.10/format/) and [Resolver Module 2025.10](https://www.designtokens.org/TR/2025.10/resolver/), both final reports dated October 28, 2025.
