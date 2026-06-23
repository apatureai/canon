import type { Conflict, ComponentConvention } from "@uidna/schema";
import type { CaptureEvidence, GeometryNode } from "@uidna/render";
import {
  AGREEMENT_REINFORCE,
  clampConfidence,
  DISAGREEMENT_DEGRADE,
  MAX_REINFORCED_CONFIDENCE,
  MIN_DEGRADED_CONFIDENCE,
} from "./thresholds.js";

/**
 * Component reconciliation (#20). Component detection (#5) emits
 * `ComponentConvention`s at confidence 0.5 ("dep present but usage unverified").
 * This refines that against observed rendered/DOM evidence: a library actually
 * USED on rendered routes is CONFIRMED (reinforced confidence, provenance lifted
 * toward "pixels", observed selectors enriched into usageExamples); a declared-
 * but-unused dep is DEGRADED and a `Conflict` recorded.
 *
 * Usage is detected by matching the library's DOM signature (selector/role
 * fragments) against the CaptureEvidence geometry. Pure + deterministic; output
 * validates against `@uidna/schema`.
 */
export interface ReconcileComponentsResult {
  components: ComponentConvention[];
  conflicts: Conflict[];
}

/**
 * DOM-signature fragments per detected library id (lowercased substring match
 * over `selector + role`). shadcn/Radix are primitive-driven, so their ARIA
 * roles (button/dialog/popover/menu/...) are the strongest usage signal; the
 * styled libraries carry class-name prefixes.
 */
const USAGE_SIGNATURES: Record<string, string[]> = {
  "shadcn/ui": ["data-radix", "data-state", "button", "dialog", "popover", "menu", "tooltip"],
  radix: ["data-radix", "data-state", "button", "dialog", "popover", "menu", "tooltip"],
  mui: ["mui", "css-"], // emotion/MUI class prefixes
  chakra: ["chakra-", "css-"],
  mantine: ["mantine-", "m-"],
};

function signatureFor(name: string): string[] {
  return USAGE_SIGNATURES[name] ?? [name.toLowerCase()];
}

/** Geometry nodes whose selector/role contains any of the library's signature fragments. */
function observedNodes(name: string, geometry: GeometryNode[]): GeometryNode[] {
  const sig = signatureFor(name);
  return geometry.filter((n) => {
    const hay = `${n.selector} ${n.role ?? ""}`.toLowerCase();
    return sig.some((frag) => hay.includes(frag));
  });
}

function allGeometry(evidence: CaptureEvidence): GeometryNode[] {
  return evidence.captures.flatMap((c) => c.geometry);
}

/** Distinct roles observed for a library, sorted — enriches the convention. */
function observedRoles(nodes: GeometryNode[]): string[] {
  const roles = new Set<string>();
  for (const n of nodes) if (n.role) roles.add(n.role);
  return [...roles].sort();
}

export function reconcileComponents(
  detected: ComponentConvention[],
  evidence: CaptureEvidence,
): ReconcileComponentsResult {
  const geometry = allGeometry(evidence);
  const components: ComponentConvention[] = [];
  const conflicts: Conflict[] = [];

  for (const conv of detected) {
    const field = `components.${conv.name}`;
    const nodes = observedNodes(conv.name, geometry);

    if (nodes.length > 0) {
      // CONFIRMED on rendered routes: reinforce confidence, lift provenance to
      // pixels (observed), enrich variants/usageExamples with observed roles.
      const headroom = MAX_REINFORCED_CONFIDENCE - conv.confidence;
      const confidence = clampConfidence(conv.confidence + headroom * AGREEMENT_REINFORCE);
      const roles = observedRoles(nodes);
      components.push({
        ...conv,
        provenance: "pixels",
        confidence,
        variants: [...new Set([...conv.variants, ...roles])].sort(),
        usageExamples: [
          ...conv.usageExamples,
          `observed on ${nodes.length} rendered element(s)`,
        ],
      });
    } else {
      // Declared dep with no observed usage: degrade, keep, record a conflict.
      const confidence = Math.max(
        MIN_DEGRADED_CONFIDENCE,
        conv.confidence * (1 - DISAGREEMENT_DEGRADE),
      );
      components.push({ ...conv, confidence });
      conflicts.push({
        field,
        candidates: [{ value: conv.name, provenance: conv.provenance, confidence: conv.confidence }],
        winner: conv.provenance,
        confidenceDelta: confidence - conv.confidence,
      });
    }
  }

  return { components, conflicts };
}
