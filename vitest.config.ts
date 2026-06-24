import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@uidna/schema": fromRoot("./packages/schema/src/index.ts"),
      "@uidna/context": fromRoot("./packages/context/src/index.ts"),
      "@uidna/render": fromRoot("./packages/render/src/index.ts"),
      "@uidna/reconcile": fromRoot("./packages/reconcile/src/index.ts"),
      "@uidna/store": fromRoot("./packages/store/src/index.ts"),
      "@uidna/eval": fromRoot("./packages/eval/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
  },
});
