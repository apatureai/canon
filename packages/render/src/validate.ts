import type {
  CaptureEvidence,
  ComputedStyleFact,
  GeometryNode,
  RouteCapture,
} from "./capture-evidence.js";

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function checkRect(path: string, rect: unknown, errors: string[]): void {
  if (!isRecord(rect)) {
    errors.push(`${path}: rect must be an object`);
    return;
  }
  for (const k of ["x", "y", "width", "height"] as const) {
    if (typeof rect[k] !== "number" || !Number.isFinite(rect[k])) {
      errors.push(`${path}.${k}: must be a finite number`);
    }
  }
}

function checkGeometry(path: string, node: GeometryNode, errors: string[]): void {
  if (typeof node.selector !== "string" || node.selector === "") {
    errors.push(`${path}.selector: must be a non-empty string`);
  }
  if (node.role !== null && typeof node.role !== "string") {
    errors.push(`${path}.role: must be a string or null`);
  }
  checkRect(path, node.rect, errors);
}

function checkComputedStyle(path: string, fact: ComputedStyleFact, errors: string[]): void {
  if (typeof fact.check !== "string" || fact.check === "") errors.push(`${path}.check: must be a non-empty string`);
  if (typeof fact.selector !== "string" || fact.selector === "") errors.push(`${path}.selector: must be a non-empty string`);
  if (typeof fact.value !== "string") errors.push(`${path}.value: must be a string`);
  if (typeof fact.violation !== "boolean") errors.push(`${path}.violation: must be a boolean`);
}

function checkCapture(path: string, capture: RouteCapture, errors: string[]): void {
  if (typeof capture.route !== "string" || capture.route === "") {
    errors.push(`${path}.route: must be a non-empty string`);
  }
  if (typeof capture.screenshotRef !== "string" || capture.screenshotRef === "") {
    errors.push(`${path}.screenshotRef: must be a non-empty object-storage ref`);
  }
  const vp = capture.viewport;
  if (!isRecord(vp) || typeof vp.width !== "number" || typeof vp.height !== "number" || typeof vp.deviceScaleFactor !== "number") {
    errors.push(`${path}.viewport: must have numeric width/height/deviceScaleFactor`);
  }
  if (!Array.isArray(capture.geometry)) errors.push(`${path}.geometry: must be an array`);
  else capture.geometry.forEach((n, i) => checkGeometry(`${path}.geometry[${i}]`, n, errors));
  if (!Array.isArray(capture.computedStyle)) errors.push(`${path}.computedStyle: must be an array`);
  else capture.computedStyle.forEach((f, i) => checkComputedStyle(`${path}.computedStyle[${i}]`, f, errors));
  if (capture.phash !== null) {
    if (!isRecord(capture.phash) || typeof capture.phash.hash !== "string" || typeof capture.phash.bits !== "number") {
      errors.push(`${path}.phash: must be { hash: string, bits: number } or null`);
    }
  }
}

/**
 * Validate a `CaptureEvidence` bundle's structural invariants — used by the
 * round-trip test to confirm a fixture parses + validates with NO live capture.
 * Pure; the contract grows alongside the UD3 reconciler.
 */
export function validateCaptureEvidence(evidence: CaptureEvidence): ValidationResult {
  const errors: string[] = [];
  if (typeof evidence.captureVersion !== "string" || evidence.captureVersion === "") {
    errors.push("captureVersion: must be a non-empty string");
  }
  if (typeof evidence.engineCaptureVersion !== "string" || evidence.engineCaptureVersion === "") {
    errors.push("engineCaptureVersion: must be a non-empty string");
  }
  if (evidence.provenance !== "pixels") {
    errors.push(`provenance: rendered evidence must be "pixels" (got "${String(evidence.provenance)}")`);
  }
  if (!Array.isArray(evidence.captures)) errors.push("captures: must be an array");
  else evidence.captures.forEach((c, i) => checkCapture(`captures[${i}]`, c, errors));

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
