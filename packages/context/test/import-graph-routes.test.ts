import { describe, expect, it } from "vitest";
import {
  mapDiffToRoutesWithImportGraph,
  type ImportGraphSourceFile,
} from "../src/index.js";

const tsconfig = { baseUrl: ".", paths: { "@/*": ["src/*"] } };

describe("mapDiffToRoutesWithImportGraph", () => {
  it("resolves tsconfig aliases from a changed component to importing pages", () => {
    const files: ImportGraphSourceFile[] = [
      { path: "src/components/Button.tsx", source: "export const Button = () => null;" },
      {
        path: "src/app/dashboard/page.tsx",
        source: 'import { Button } from "@/components/Button"; export default Button;',
      },
    ];

    const result = mapDiffToRoutesWithImportGraph(
      ["src/components/Button.tsx"],
      files,
      {},
      { tsconfig },
    );

    expect(result.mode).toBe("import_graph");
    expect(result.routes).toEqual(["/dashboard"]);
    expect(result.diagnostics).toMatchObject({
      totalInternalImports: 1,
      resolvedInternalImports: 1,
      resolvableFraction: 1,
    });
  });

  it("ranks routes by shortest graph distance and caps the result at five", () => {
    const indirectPages = ["alpha", "beta", "gamma", "omega"].map((route) => ({
      path: `src/app/${route}/page.tsx`,
      source: 'import { Button } from "@/components"; export default Button;',
    }));
    const files: ImportGraphSourceFile[] = [
      { path: "src/components/Button.tsx", source: "export const Button = () => null;" },
      { path: "src/components/index.ts", source: 'export { Button } from "./Button";' },
      {
        path: "src/app/direct-z/page.tsx",
        source: 'import { Button } from "@/components/Button"; export default Button;',
      },
      {
        path: "src/app/direct-a/page.tsx",
        source: 'import { Button } from "@/components/Button"; export default Button;',
      },
      ...indirectPages,
    ];

    const result = mapDiffToRoutesWithImportGraph(
      ["src/components/Button.tsx"],
      files,
      {},
      { tsconfig, maxRoutes: 99, maxDepth: 99 },
    );

    expect(result.mode).toBe("import_graph");
    expect(result.routes).toEqual([
      "/direct-a",
      "/direct-z",
      "/alpha",
      "/beta",
      "/gamma",
    ]);
    expect(result.diagnostics.maxRoutes).toBe(5);
    expect(result.diagnostics.maxDepth).toBe(5);
  });

  it("walks relative barrel imports and honors a lower configured route cap", () => {
    const files: ImportGraphSourceFile[] = [
      { path: "src/ui/Button.tsx", source: "export const Button = () => null;" },
      { path: "src/ui/index.ts", source: 'export { Button } from "./Button";' },
      { path: "src/app/b/page.tsx", source: 'import { Button } from "../../ui";' },
      { path: "src/app/a/page.tsx", source: 'import { Button } from "../../ui";' },
    ];

    const result = mapDiffToRoutesWithImportGraph(
      ["src/ui/Button.tsx"],
      files,
      { maxPerPr: 1 },
    );

    expect(result.mode).toBe("import_graph");
    expect(result.routes).toEqual(["/a"]);
    expect(result.diagnostics.maxRoutes).toBe(1);
  });

  it("falls back to the MVP mapping when internal imports resolve below the threshold", () => {
    const files: ImportGraphSourceFile[] = [
      {
        path: "src/app/page.tsx",
        source: 'import { Missing } from "@/missing/Component"; export default Missing;',
      },
    ];

    const result = mapDiffToRoutesWithImportGraph(
      ["src/app/page.tsx"],
      files,
      {},
      { tsconfig },
    );

    expect(result).toMatchObject({
      mode: "mvp_fallback",
      reason: "low_resolvability",
      routes: ["/"],
      diagnostics: { totalInternalImports: 1, resolvedInternalImports: 0 },
    });
  });

  it("falls back without graph claims when no internal code edges exist", () => {
    const files: ImportGraphSourceFile[] = [
      { path: "src/components/Button.tsx", source: 'import React from "react";' },
      { path: "src/app/page.tsx", source: 'import React from "react";' },
    ];

    const result = mapDiffToRoutesWithImportGraph(["src/components/Button.tsx"], files);
    expect(result).toMatchObject({ mode: "mvp_fallback", reason: "no_graph_routes", routes: [] });
  });

  it("falls back deterministically if normalized source paths collide", () => {
    const files: ImportGraphSourceFile[] = [
      { path: "src/app/page.tsx", source: "export default null;" },
      { path: "./src/app/page.tsx", source: "export default null;" },
    ];

    const result = mapDiffToRoutesWithImportGraph(["src/app/page.tsx"], files);
    expect(result).toMatchObject({
      mode: "mvp_fallback",
      reason: "resolution_failed",
      routes: ["/"],
    });
  });

  it("ignores non-code asset imports instead of treating them as graph failures", () => {
    const files: ImportGraphSourceFile[] = [
      { path: "src/components/Button.tsx", source: 'import "./button.css"; export const Button = 1;' },
      {
        path: "src/app/page.tsx",
        source: 'import { Button } from "@/components/Button"; export default Button;',
      },
    ];

    const result = mapDiffToRoutesWithImportGraph(
      ["src/components/Button.tsx"],
      files,
      {},
      { tsconfig },
    );
    expect(result.mode).toBe("import_graph");
    expect(result.routes).toEqual(["/"]);
    expect(result.diagnostics.resolvableFraction).toBe(1);
  });

  it("resolves dotted module basenames instead of mistaking them for assets", () => {
    const files: ImportGraphSourceFile[] = [
      { path: "src/components/Button.client.tsx", source: "export const Button = 1;" },
      {
        path: "src/app/page.tsx",
        source: 'import { Button } from "@/components/Button.client"; export default Button;',
      },
    ];

    const result = mapDiffToRoutesWithImportGraph(
      ["src/components/Button.client.tsx"],
      files,
      {},
      { tsconfig },
    );
    expect(result.mode).toBe("import_graph");
    expect(result.routes).toEqual(["/"]);
  });
});
