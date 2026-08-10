/**
 * Canonical colour value: the single shared colour canonicalizer used across
 * ui-dna (issue #97). Both the design↔code drift gate (`@uidna/store`, for strict
 * value equality) and token reconciliation (`@uidna/reconcile`, for matching a
 * rendered colour to a declared token) need "are these two colour strings the
 * same colour?", and they must agree. It therefore lives here, in the leaf package
 * both depend on, rather than as two divergent copies.
 *
 * It canonicalizes hex (3/4/6/8-digit) and comma-form `rgb()/rgba()` to a single
 * `#rrggbbaa` form (lowercase, opaque alpha `ff`), so equal spellings compare
 * equal: `#FFF` = `#ffffff` = `#ffffffff` = `rgb(255,255,255)` = `rgba(255,255,255,1)`,
 * and `rgba(0,0,0,.5)` = `#00000080`. Returns null for anything it does not
 * recognize (`hsl()`, named colours, the modern space syntax) so callers fall
 * back to their own handling: no false equivalence, no unit/colour-space guessing.
 */

/** A `0-100%` or `0-255` colour channel → a byte, or null if out of range / malformed. */
function channelToByte(raw: string): number | null {
  const s = raw.trim();
  if (s.endsWith("%")) {
    const p = Number(s.slice(0, -1));
    return Number.isFinite(p) && p >= 0 && p <= 100 ? Math.round((p / 100) * 255) : null;
  }
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 255 ? n : null;
}

/** A `0-1` float or `0-100%` alpha → a byte, or null if out of range / malformed. */
function alphaToByte(raw: string): number | null {
  const s = raw.trim();
  if (s.endsWith("%")) {
    const p = Number(s.slice(0, -1));
    return Number.isFinite(p) && p >= 0 && p <= 100 ? Math.round((p / 100) * 255) : null;
  }
  const a = Number(s);
  return Number.isFinite(a) && a >= 0 && a <= 1 ? Math.round(a * 255) : null;
}

/**
 * Canonicalize a colour to a single `#rrggbbaa` form, or null if unrecognized.
 * See the module doc for the exact equivalences and scope boundary.
 */
export function canonicalColor(value: string): string | null {
  const hexMatch = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  const hexCaptured = hexMatch?.[1];
  if (hexCaptured !== undefined) {
    let hex = hexCaptured.toLowerCase();
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
    if (hex.length === 6) hex += "ff"; // no alpha ⇒ fully opaque
    return `#${hex}`;
  }

  const rgbMatch = /^rgba?\(([^)]+)\)$/i.exec(value);
  const rgbBody = rgbMatch?.[1];
  if (rgbBody !== undefined) {
    const parts = rgbBody.split(",");
    if (parts.length !== 3 && parts.length !== 4) return null;
    const r = channelToByte(parts[0] ?? "");
    const g = channelToByte(parts[1] ?? "");
    const b = channelToByte(parts[2] ?? "");
    const a = parts.length === 4 ? alphaToByte(parts[3] ?? "") : 255;
    if (r === null || g === null || b === null || a === null) return null;
    const hx = (n: number): string => n.toString(16).padStart(2, "0");
    return `#${hx(r)}${hx(g)}${hx(b)}${hx(a)}`;
  }

  return null;
}
