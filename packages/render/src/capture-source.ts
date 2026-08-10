import type { CaptureEvidence, RouteCapture } from "./capture-evidence.js";

/**
 * `CaptureSource` is the injected port that yields `CaptureEvidence`. Production
 * wires the verdict capture adapter behind this interface; tests inject
 * a stub fixture. ui-dna code depends only on this seam, so capture stays in the
 * engine and this repo stays pure/deterministic (PRD §7): **no browser or
 * network lives here**.
 */
export interface CaptureSource {
  /**
   * Fetch the rendered evidence for a repo snapshot. `routes` is the set of
   * affected routes (from the diff->route mapper); the source returns evidence
   * for the routes it has captured.
   */
  capture(routes: string[]): Promise<CaptureEvidence>;
}

/**
 * A stub `CaptureSource` backed by a fixed `CaptureEvidence` fixture, the
 * test/dev seam so UD3 modules can be exercised with no live capture. Returns
 * only the captures whose route is in the requested set (or all, if `routes` is
 * empty), so tests can assert route filtering deterministically.
 */
export function fixtureCaptureSource(evidence: CaptureEvidence): CaptureSource {
  return {
    capture(routes: string[]): Promise<CaptureEvidence> {
      const wanted = new Set(routes);
      const captures: RouteCapture[] =
        wanted.size === 0
          ? evidence.captures
          : evidence.captures.filter((c) => wanted.has(c.route));
      return Promise.resolve({ ...evidence, captures });
    },
  };
}
