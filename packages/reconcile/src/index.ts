export type { ReconcileResult } from "./reconcile-field.js";
export { reconcileField } from "./reconcile-field.js";
export {
  VALUE_PRECEDENCE,
  HUMAN_RESOLVED_CONFIDENCE,
  AGREEMENT_REINFORCE,
  MAX_REINFORCED_CONFIDENCE,
  DISAGREEMENT_DEGRADE,
  MIN_DEGRADED_CONFIDENCE,
  clampConfidence,
} from "./thresholds.js";
