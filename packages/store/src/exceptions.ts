import type { DnaException, DnaSnapshot } from "@uidna/schema";
import type { DriftHint } from "@uidna/reconcile";

/**
 * Exceptions handling (#24, PRD §4/§5): first-class `DnaException`s — routes/
 * surfaces where the standard INTENTIONALLY differs. An exception is a
 * human-declared carve-out captured during sign-off (provenance is implicitly
 * human; only an approved snapshot should carry them). Distinct from drift
 * (#21, unintended): a drift hint on an EXCEPTED route is suppressed/annotated,
 * not raised, so downstream (Gate) doesn't flag intentional deviation.
 *
 * Exceptions are deduped by route and kept in deterministic (route-sorted)
 * order so they serialize byte-stably into the versioned snapshot.
 */

function sortExceptions(exceptions: DnaException[]): DnaException[] {
  return [...exceptions].sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
}

/** Add (or replace, by route) an exception. Returns a new snapshot; input untouched. */
export function addException(snapshot: DnaSnapshot, route: string, reason: string): DnaSnapshot {
  const without = snapshot.exceptions.filter((e) => e.route !== route);
  return { ...snapshot, exceptions: sortExceptions([...without, { route, reason }]) };
}

/** Remove an exception by route. Returns a new snapshot; input untouched. */
export function removeException(snapshot: DnaSnapshot, route: string): DnaSnapshot {
  return { ...snapshot, exceptions: sortExceptions(snapshot.exceptions.filter((e) => e.route !== route)) };
}

/** Whether a route is an approved exception on this snapshot. */
export function isExcepted(snapshot: DnaSnapshot, route: string): boolean {
  return snapshot.exceptions.some((e) => e.route === route);
}

/** A drift hint annotated as suppressed because its route is an approved exception. */
export interface AnnotatedDriftHint extends DriftHint {
  /** True when the hint falls on an excepted route (intentional deviation, not drift). */
  suppressed: boolean;
  /** The exception reason, when suppressed. */
  exceptionReason?: string;
}

/**
 * Annotate drift hints against the snapshot's exceptions: a hint whose `route`
 * is an approved exception is marked `suppressed` (with the reason), not raised.
 * Hints without a route, or on non-excepted routes, pass through unsuppressed.
 * Deterministic (preserves input order). The split lets callers either drop
 * suppressed hints or surface them as "known intentional deviation".
 */
export function annotateDriftWithExceptions(
  snapshot: DnaSnapshot,
  hints: DriftHint[],
): AnnotatedDriftHint[] {
  const byRoute = new Map(snapshot.exceptions.map((e) => [e.route, e.reason]));
  return hints.map((hint) => {
    const reason = hint.route !== undefined ? byRoute.get(hint.route) : undefined;
    return reason !== undefined
      ? { ...hint, suppressed: true, exceptionReason: reason }
      : { ...hint, suppressed: false };
  });
}

/** Drift hints that should actually be raised (excepted-route drift removed). */
export function raisedDrift(snapshot: DnaSnapshot, hints: DriftHint[]): DriftHint[] {
  return annotateDriftWithExceptions(snapshot, hints).filter((h) => !h.suppressed);
}
