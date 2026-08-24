import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import resolveConfig from "tailwindcss-v3/resolveConfig.js";

/**
 * Worker entry for the Tailwind v3 `ConfigLoader` port (`@apatureai/canon-context`).
 *
 * A `tailwind.config.{js,cjs,mjs,ts}` is EXECUTABLE code, so it is evaluated in
 * a worker thread rather than in the CLI's own thread: the parent keeps a
 * timeout and can terminate a config that hangs or blows the stack, and a throw
 * inside the config never takes the CLI down. This is ISOLATION, not a security
 * sandbox: the config still runs with full Node privileges. The CLI therefore
 * requires an explicit `--exec-tailwind-config` flag before it will start this
 * worker at all.
 *
 * Tailwind's `resolveConfig` runs HERE, not in the parent: a user config may put
 * closures in `theme` (`spacing: ({ theme }) => ...`), and those cannot cross a
 * worker boundary. Resolving first collapses them to plain data, which is then
 * JSON-round-tripped and posted back as a config object the pure
 * `resolveTailwindV3Tokens` can re-resolve deterministically.
 *
 * This file is deliberately plain `.mjs` and is NOT compiled: `../worker/` sits
 * at the same depth from `src/` and `dist/`, so the same relative URL resolves
 * whether the CLI is running from source (tests) or from its build output.
 */
const port = parentPort;
if (port) {
  try {
    const module = await import(pathToFileURL(workerData.configPath).href);
    const config = module?.default ?? module;
    const theme = resolveConfig(config).theme ?? {};
    port.postMessage({ ok: true, theme: JSON.parse(JSON.stringify(theme)) });
  } catch (error) {
    port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
