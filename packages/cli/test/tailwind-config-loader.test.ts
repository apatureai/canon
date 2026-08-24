import { extractTailwindV3TokensFromFile } from "@apatureai/canon-context";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkerConfigLoader } from "../src/index.js";
import { makeTree } from "./helpers.js";

/**
 * The worker-backed `ConfigLoader`. These tests DO execute a config file, which
 * is the whole point of the port, but only configs written by the test itself,
 * into a throwaway directory.
 */
describe("createWorkerConfigLoader", () => {
  it("evaluates a config in a worker and resolves Tailwind's theme closures", async () => {
    const tree = makeTree({
      "tailwind.config.js": `module.exports = {
        theme: {
          extend: {
            colors: { brand: "#2f6fed" },
            boxShadow: ({ theme }) => ({ card: "0 1px 3px " + theme("colors.black") }),
          },
        },
      };`,
    });
    try {
      const loader = createWorkerConfigLoader();
      const tokens = await extractTailwindV3TokensFromFile(join(tree.root, "tailwind.config.js"), loader);
      expect(tokens.color["colors.brand"]).toEqual({
        value: "#2f6fed",
        confidence: 0.8,
        provenance: "config",
      });
      // A closure cannot cross a worker boundary, so it must have been CALLED
      // inside the worker for this value to exist at all.
      expect(tokens.shadows["boxShadow.card"]?.value).toBe("0 1px 3px #000");
      // Tailwind's own defaults come along, as they do for the project itself.
      expect(tokens.spacing["spacing.4"]?.value).toBe("1rem");
    } finally {
      tree.cleanup();
    }
  });

  it("rejects when the config throws, and the caller degrades to no tokens", async () => {
    const tree = makeTree({ "tailwind.config.js": "throw new Error('boom');" });
    try {
      const loader = createWorkerConfigLoader();
      await expect(loader.load(join(tree.root, "tailwind.config.js"))).rejects.toThrow(/boom/);
      // extractTailwindV3TokensFromFile turns that rejection into empty tokens
      // rather than taking the run down.
      const tokens = await extractTailwindV3TokensFromFile(join(tree.root, "tailwind.config.js"), loader);
      expect(Object.keys(tokens.color)).toEqual([]);
    } finally {
      tree.cleanup();
    }
  });

  it("rejects when the config never finishes, instead of hanging", async () => {
    const tree = makeTree({
      // A config that blocks the thread. The parent's timeout must fire and
      // terminate it; the 10s bound is only a backstop if that ever regresses.
      "tailwind.config.js": "const end = Date.now() + 10_000;\nwhile (Date.now() < end) {}\nmodule.exports = {};",
    });
    try {
      const loader = createWorkerConfigLoader({ timeoutMs: 250 });
      await expect(loader.load(join(tree.root, "tailwind.config.js"))).rejects.toThrow(/timed out after 250ms/);
    } finally {
      tree.cleanup();
    }
  });

  it("rejects a config file that does not exist", async () => {
    const loader = createWorkerConfigLoader();
    await expect(loader.load(join("/nonexistent-ui-dna", "tailwind.config.js"))).rejects.toThrow();
  });
});
