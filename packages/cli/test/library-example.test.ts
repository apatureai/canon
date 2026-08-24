import { describe, expect, it, vi } from "vitest";

/**
 * `examples/library-example.ts` is the code block the README prints under
 * "Using it as a library", and a reader is told to run it. It therefore has to
 * keep working, so it is executed here rather than trusted.
 *
 * The test lives in the CLI package because that is where this repo keeps the
 * things a reader RUNS; the example itself belongs to no package. Under vitest
 * the `@apatureai/*` specifiers resolve to package sources (see `vitest.config.ts`),
 * so this asserts the example's behaviour without requiring a build. That the
 * same specifiers also resolve from the repository root at runtime is a fact
 * about `package.json` + `pnpm-lock.yaml`, which `--frozen-lockfile` checks.
 */
describe("examples/library-example.ts", () => {
  it("prints the dead-token drift hint and the served read contract the README documents", async () => {
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    try {
      await import("../../../examples/library-example.ts");
    } finally {
      spy.mockRestore();
    }

    expect(logged).toHaveLength(4);
    expect(logged[0]).toEqual([
      [
        'tokens.spacing.--spacing-gap: code declares "8px" but it is not observed in rendered reality (dead token)',
      ],
    ]);
    // A draft genome is never served downstream.
    expect(logged[1]).toEqual(["before approval:", null]);
    const [label, contract, digest] = logged[2] as [string, unknown, string];
    expect(label).toBe("after approval: ");
    expect(contract).toEqual({ schemaVersion: "1", storeVersion: "2" });
    expect(digest).toMatch(/^sha256:[0-9a-f]{7}$/);
    // The approved genome projects into a downstream consumer's contract.
    const [verdictLabel, approvalState, itemCount] = logged[3] as [string, string, number];
    expect(verdictLabel).toBe("verdict profile:");
    expect(approvalState).toBe("approved");
    expect(itemCount).toBeGreaterThan(0);
  });
});
