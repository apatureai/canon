import { describe, expect, it } from "vitest";
import { layoutFileToRoutes, mapDiffToRoutes, pageFileToRoute } from "../src/index.js";

describe("pageFileToRoute (App Router)", () => {
  it("maps app page files, dropping route groups and keeping dynamic segments", () => {
    expect(pageFileToRoute("app/page.tsx")).toBe("/");
    expect(pageFileToRoute("app/dashboard/page.tsx")).toBe("/dashboard");
    expect(pageFileToRoute("src/app/settings/page.tsx")).toBe("/settings");
    expect(pageFileToRoute("app/(marketing)/about/page.tsx")).toBe("/about");
    expect(pageFileToRoute("app/blog/[slug]/page.tsx")).toBe("/blog/[slug]");
  });

  it("ignores private (_) and parallel (@) segments and non-page files", () => {
    expect(pageFileToRoute("app/_components/x/page.tsx")).toBeNull();
    expect(pageFileToRoute("app/@modal/page.tsx")).toBeNull();
    expect(pageFileToRoute("components/Button.tsx")).toBeNull();
  });
});

describe("pageFileToRoute (Pages Router)", () => {
  it("maps pages files and excludes index/_app/api", () => {
    expect(pageFileToRoute("pages/index.tsx")).toBe("/");
    expect(pageFileToRoute("pages/about.tsx")).toBe("/about");
    expect(pageFileToRoute("pages/blog/[id].tsx")).toBe("/blog/[id]");
    expect(pageFileToRoute("pages/_app.tsx")).toBeNull();
    expect(pageFileToRoute("pages/api/users.ts")).toBeNull();
  });
});

describe("layoutFileToRoutes", () => {
  const pageFiles = [
    "app/dashboard/page.tsx",
    "app/dashboard/settings/page.tsx",
    "app/marketing/page.tsx",
  ];

  it("maps a layout.tsx to the routes of pages under its directory", () => {
    expect(layoutFileToRoutes("app/dashboard/layout.tsx", pageFiles)).toEqual([
      "/dashboard",
      "/dashboard/settings",
    ]);
  });

  it("caps child routes at 3 so a root layout does not fan out to the whole app", () => {
    const many = ["a", "b", "c", "d"].map((s) => `app/${s}/page.tsx`);
    expect(layoutFileToRoutes("app/layout.tsx", many)).toEqual(["/a", "/b", "/c"]);
  });

  it("returns empty for non-layout files", () => {
    expect(layoutFileToRoutes("app/dashboard/page.tsx", pageFiles)).toEqual([]);
  });
});

describe("mapDiffToRoutes", () => {
  it("maps a diff, dedupes + sorts, and honors always/map/maxPerPr", () => {
    const routes = mapDiffToRoutes(
      ["app/dashboard/page.tsx", "components/Button.tsx", "app/page.tsx", "lib/theme.ts"],
      { always: ["/health"], map: { "lib/theme.ts": "/" } },
    );
    expect(routes).toEqual(["/", "/dashboard", "/health"]); // "/" deduped from app/page + map override
  });

  it("expands a changed layout.tsx to its child routes when pageFiles is supplied", () => {
    const routes = mapDiffToRoutes(
      ["app/dashboard/layout.tsx"],
      {},
      ["app/dashboard/page.tsx", "app/dashboard/settings/page.tsx"],
    );
    expect(routes).toEqual(["/dashboard", "/dashboard/settings"]);
  });

  it("caps to max_per_pr", () => {
    const files = ["app/a/page.tsx", "app/b/page.tsx", "app/c/page.tsx"];
    expect(mapDiffToRoutes(files, { maxPerPr: 2 })).toEqual(["/a", "/b"]);
  });

  it("returns an empty list when no page files changed", () => {
    expect(mapDiffToRoutes(["README.md", "lib/util.ts"])).toEqual([]);
  });
});
