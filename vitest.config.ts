import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@apatureai/canon-schema": fromRoot("./packages/schema/src/index.ts"),
      "@apatureai/canon-context": fromRoot("./packages/context/src/index.ts"),
      "@apatureai/canon-render": fromRoot("./packages/render/src/index.ts"),
      "@apatureai/canon-reconcile": fromRoot("./packages/reconcile/src/index.ts"),
      "@apatureai/canon-store": fromRoot("./packages/store/src/index.ts"),
      "@apatureai/canon-eval": fromRoot("./packages/eval/src/index.ts"),
      "@apatureai/canon": fromRoot("./packages/cli/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
  },
});
