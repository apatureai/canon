# UI DNA — design and scope

Written June 2026; archived unmaintained. This is the original product spec. It
describes intent at the time of writing, including scope that was never built —
read it as the plan, not as a description of the code.

Three parts were removed for the public archive because they were commercial
rather than technical: §2 (company role / defensibility), the buyer subsection
of §3, and §9 (business success metrics). Section numbering is therefore gapped,
and a handful of source comments cite `PRD §2` or `PRD §9` and no longer resolve
to anything here.

## 1. Product Summary

Apature UI DNA extracts a canonical model of what a product is supposed to look and behave like. It turns an existing codebase and rendered app into a versioned design genome: tokens, component conventions, spacing and type distributions, color usage, brand tone, and rendered visual evidence.

UI DNA is the shared genome consumed by the other Apature components: the design review gate, the MCP review server, drift consolidation, upstream serving to agents, and continuous consulting.

## 3. Users

Primary users:

- Teams installing Apature products.
- Design-system maintainers who need the actual UI standard captured.
- Engineering teams whose codebase has implicit design rules not written down.

## 4. Scope

In scope:

- Static token extraction from Tailwind, CSS variables, token files, and package metadata.
- Component library detection and component usage graph.
- Rendered visual analysis from existing pages and screenshots.
- Reconciliation of code tokens with rendered reality.
- Human sign-off workflow for canonical decisions.
- Versioned UI DNA schema.
- API for downstream Apature products to retrieve DNA snapshots.
- Drift hints where current code already disagrees with the inferred standard.

Out of scope:

- Replacing Figma.
- Becoming a full design-token management system in v1.
- Generating new UI.
- Editing customer code.
- Declaring a messy legacy pattern canonical without team sign-off.

## 5. DNA Schema

The first schema should include:

- Product identity: name, audience, tone, explicit dos and don'ts.
- Tokens: color, type, spacing, radii, shadows, breakpoints, motion if available.
- Component conventions: canonical primitives, variants, props, and usage examples.
- Visual distributions: common spacing intervals, type scale, density, color proportions, border/radius patterns.
- Rendered anchors: screenshots or crops that demonstrate canonical patterns.
- Exceptions: routes or surfaces where the standard intentionally differs.
- Confidence and provenance per field.
- Version metadata and approval state.

Every field should say where it came from: code, rendered pixels, config, human input, or prior feedback.

## 6. MVP

MVP goal: produce a useful DNA draft for a real frontend repo in under ten minutes.

Required capabilities:

- Tailwind v3 resolved config extraction in a sandbox.
- Tailwind v4 `@theme` parsing through PostCSS.
- CSS custom property extraction.
- Component library detection for shadcn/ui, Radix, MUI, Chakra, and Mantine.
- Rendered page sampling using Gate's capture engine.
- Simple visual distribution analysis for spacing, color, typography, and radii.
- DNA draft document.
- Sign-off/edit UI or structured review file.
- Versioned export consumed by Gate.

## 7. Architecture

Major components:

- Code extractor: reads tokens and component usage.
- Render extractor: samples screenshots and DOM geometry.
- Reconciler: merges code-level and rendered evidence.
- Confidence engine: marks inferred, observed, and confirmed facts separately.
- DNA store: versioned snapshots per repo.
- Downstream API: serves snapshots to Gate, MCP Review, Entropy Engine, Source of Truth, and DNA Consultant.

UI DNA should be deterministic wherever possible. The same repository state should produce the same draft unless the model, schema, or extraction version changes.

## 8. Security And Privacy

UI DNA touches code and screenshots.

Required controls:

- Read-only repository access.
- No code writes.
- Screenshot retention is configurable per deployment.
- Provenance stored without leaking private source content into logs.
- Customer controls which routes become canonical visual anchors.
- Enterprise path supports self-hosted extraction and model inference.

## 10. Open Risks

- Legacy UIs contain inconsistent patterns; extraction can canonize bad drift.
- Framework and styling diversity makes static analysis hard.
- Rendered reality may disagree with design tokens.
- Teams may not want to spend time approving a DNA draft.
- The schema can become too broad unless it is tied to downstream product needs.

## 11. Repository Boundary

This repo owns the UI DNA schema, extraction pipeline, versioning, and downstream read contract. It is the shared asset repo, not a customer-facing review surface by itself.
