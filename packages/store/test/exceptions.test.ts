import { emptyDraft } from "@apatureai/canon-schema";
import type { DriftHint } from "@apatureai/canon-reconcile";
import { describe, expect, it } from "vitest";
import {
  addException,
  annotateDriftWithExceptions,
  isExcepted,
  raisedDrift,
  removeException,
} from "../src/index.js";

function hint(field: string, route?: string): DriftHint {
  return {
    field,
    standardValue: "x",
    standardProvenance: "config",
    driftingValue: "y",
    driftingProvenance: "pixels",
    confidence: 0.3,
    message: `${field} drift`,
    route,
  };
}

describe("addException / removeException", () => {
  it("adds, dedupes by route, and keeps deterministic (sorted) order", () => {
    let snap = emptyDraft("apatureai", "canon", "x");
    snap = addException(snap, "/pricing", "marketing page, off-brand on purpose");
    snap = addException(snap, "/", "home");
    snap = addException(snap, "/pricing", "updated reason"); // replace, not duplicate
    expect(snap.exceptions.map((e) => e.route)).toEqual(["/", "/pricing"]); // sorted, deduped
    expect(snap.exceptions.find((e) => e.route === "/pricing")?.reason).toBe("updated reason");
  });

  it("removes by route without mutating the input", () => {
    const base = addException(emptyDraft("apatureai", "canon", "x"), "/admin", "internal tool");
    const removed = removeException(base, "/admin");
    expect(isExcepted(removed, "/admin")).toBe(false);
    expect(isExcepted(base, "/admin")).toBe(true); // input untouched
  });
});

describe("drift suppression on excepted routes", () => {
  it("suppresses + annotates a drift hint on an excepted route", () => {
    const snap = addException(emptyDraft("apatureai", "canon", "x"), "/promo", "seasonal campaign");
    const [annotated] = annotateDriftWithExceptions(snap, [hint("color", "/promo")]);
    expect(annotated?.suppressed).toBe(true);
    expect(annotated?.exceptionReason).toBe("seasonal campaign");
  });

  it("does not suppress drift on non-excepted routes or repo-wide (routeless) hints", () => {
    const snap = addException(emptyDraft("apatureai", "canon", "x"), "/promo", "campaign");
    const annotated = annotateDriftWithExceptions(snap, [hint("color", "/dashboard"), hint("tokens.color.x")]);
    expect(annotated.every((h) => !h.suppressed)).toBe(true);
  });

  it("raisedDrift drops only the excepted-route hints, deterministically", () => {
    const snap = addException(emptyDraft("apatureai", "canon", "x"), "/promo", "campaign");
    const raised = raisedDrift(snap, [hint("a", "/promo"), hint("b", "/dashboard"), hint("c")]);
    expect(raised.map((h) => h.field)).toEqual(["b", "c"]);
  });
});
