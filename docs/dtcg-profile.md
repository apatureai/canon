Part of [canon](../README.md). Moved from the README on 2026-08-24; anchors preserved.

### The DTCG profile

`resolveTokensJson` implements the stable Design Tokens Community Group
[Format Module 2025.10](https://www.designtokens.org/TR/2025.10/format/) profile:

- exact JSON token values, inherited types, chained curly aliases, same-document RFC 6901 `$ref`
  including property-level references, `$root`, and group `$extends`;
- deterministic alias and extension derivation chains, byte-stable key/token/diagnostic ordering;
- fail-closed diagnostics for unresolved, circular, type-invalid, malformed, external and
  over-budget references;
- classic Style Dictionary `value` nodes remain an explicit compatibility path; they carry
  `type: null` when undeclared and are not described as DTCG-conformant.

The [Resolver Module](https://www.designtokens.org/TR/2025.10/resolver/) (sets, modifiers,
`resolutionOrder`, filesystem and remote sources) is disabled: a resolver document returns
`unsupported_resolver_module` and an external `$ref` returns `unsupported_external_reference`.
Enabling either needs an injected, sandboxed, allowlisted loader and a versioned profile change,
which is a roadmap item ([Roadmap item 6](roadmap.md)).

Resolved composite values stay structured. `projectTokenValue` is the named lossy string projection:
colors prefer their preserved `hex`, dimensions and durations preserve value plus unit, other
composites use stable JSON. Invalid reference syntax is never projected into a `Fact`.

Conformance and adversarial goldens in `packages/context/test/fixtures` cover the final 2025.10
examples and the required failure taxonomy.
