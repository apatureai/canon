import { describe, expect, it } from "vitest";
import { assessImportGraphFeasibility, resolveFileImports } from "../src/index.js";

const cfg = { baseUrl: ".", paths: { "@/*": ["src/*"], "@ui": ["src/components/ui/index.ts"] } };

describe("resolveFileImports", () => {
  it("classifies relative, alias, and bare specifiers", () => {
    const src = `
      import { Button } from "./Button";
      import { Card } from "../ui/Card";
      import { cn } from "@/lib/utils";
      import ui from "@ui";
      import React from "react";
      import { Dialog } from "@radix-ui/react-dialog";
    `;
    const byKind = Object.fromEntries(resolveFileImports(src, cfg).map((i) => [i.specifier, i]));
    expect(byKind["./Button"]?.kind).toBe("relative");
    expect(byKind["../ui/Card"]?.resolved).toBe("../ui/Card");
    expect(byKind["@/lib/utils"]?.kind).toBe("alias");
    expect(byKind["@/lib/utils"]?.resolved).toBe("src/lib/utils");
    expect(byKind["@ui"]?.resolved).toBe("src/components/ui/index.ts");
    expect(byKind["react"]?.kind).toBe("bare");
    expect(byKind["@radix-ui/react-dialog"]?.kind).toBe("bare");
  });

  it("flags dynamic imports and still resolves a literal specifier", () => {
    const src = `const Mod = await import("@/features/chart");`;
    const [imp] = resolveFileImports(src, cfg);
    expect(imp?.kind).toBe("dynamic");
    expect(imp?.dynamic).toBe(true);
    expect(imp?.resolved).toBe("src/features/chart");
  });

  it("handles re-export (barrel) specifiers as ordinary edges", () => {
    const src = `export { Button } from "./Button";\nexport * from "./Card";`;
    const specs = resolveFileImports(src, cfg).map((i) => i.specifier).sort();
    expect(specs).toEqual(["./Button", "./Card"]);
  });
});

describe("assessImportGraphFeasibility", () => {
  it("aggregates the prevalence of each hard case and a resolvable fraction", () => {
    const report = assessImportGraphFeasibility(
      [
        { path: "a.tsx", source: `import { B } from "./B";\nimport { C } from "@/lib/C";` },
        { path: "b.tsx", source: `import React from "react";\nconst d = await import("./D");` },
      ],
      cfg,
    );
    expect(report.totalImports).toBe(4);
    expect(report.relative).toBe(1);
    expect(report.alias).toBe(1);
    expect(report.bare).toBe(1);
    expect(report.dynamic).toBe(1);
    // 3 internal (relative + alias + dynamic), all resolvable -> 1.0
    expect(report.resolvableInternal).toBe(3);
    expect(report.resolvableFraction).toBe(1);
  });

  it("is deterministic and empty for no files", () => {
    const empty = assessImportGraphFeasibility([], cfg);
    expect(empty.totalImports).toBe(0);
    expect(empty.resolvableFraction).toBe(0);
  });
});
