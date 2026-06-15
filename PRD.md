# Apature UI DNA - Product Requirements Document

Created: 2026-06-15
Source: extracted from `apature-systems/core` PRD as of 2026-06-15.

## 1. Product Summary

Apature UI DNA extracts a canonical model of what a product is supposed to look and behave like. It turns an existing codebase and rendered app into a versioned design genome: tokens, component conventions, spacing and type distributions, color usage, brand tone, and rendered visual evidence.

UI DNA is the shared asset beneath Gate, MCP Review, Entropy Engine, Source of Truth, and DNA Consultant.

## 2. Company Role

The company is not defended by calling a vision model. It is defended by owning per-team design judgment data and the canonical UI DNA that judgment is grounded against.

UI DNA turns onboarding from "please write a brand block" into "we extracted your product's actual design language; confirm or correct it."

This asset compounds:

- Gate judges PRs against it.
- MCP Review rechecks fixes against it.
- Entropy Engine consolidates drift toward it.
- Source of Truth serves it upstream to agents.
- DNA Consultant carries it forward continuously.

## 3. Users And Buyers

Primary users:

- Teams installing Apature products.
- Design-system maintainers who need the actual UI standard captured.
- Engineering teams whose codebase has implicit design rules not written down.

Buyer:

- Indirect in v1, bundled with Gate.
- Direct in enterprise onboarding once the extraction and sign-off workflow is strong enough.

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
- Screenshot retention follows the customer's Apature tier.
- Provenance stored without leaking private source content into logs.
- Customer controls which routes become canonical visual anchors.
- Enterprise path supports self-hosted extraction and model inference.

## 9. Success Metrics

Activation:

- Percentage of Gate installs that produce a DNA draft.
- Time from install to approved DNA.

Quality:

- Team acceptance rate of extracted DNA fields.
- Number of manual edits required before sign-off.
- Reduction in generic brand configuration needed.

Downstream value:

- Gate precision improvement with DNA enabled.
- Entropy findings accepted.
- Source of Truth queries answered from approved DNA.

## 10. Open Risks

- Legacy UIs contain inconsistent patterns; extraction can canonize bad drift.
- Framework and styling diversity makes static analysis hard.
- Rendered reality may disagree with design tokens.
- Teams may not want to spend time approving a DNA draft.
- The schema can become too broad unless it is tied to downstream product needs.

## 11. Repository Boundary

This repo owns the UI DNA schema, extraction pipeline, versioning, and downstream read contract. It is the shared asset repo, not a customer-facing review surface by itself.
