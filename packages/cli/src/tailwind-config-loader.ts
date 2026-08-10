import { Worker } from "node:worker_threads";
import type { ConfigLoader } from "@uidna/context";

/**
 * The production implementation of `@uidna/context`'s `ConfigLoader` port.
 *
 * `resolveTailwindV3FromFile(path, loader)` is pure and testable precisely
 * because the one dangerous step (evaluating a `tailwind.config.{js,cjs,mjs,ts}`)
 * is pushed behind this seam. This loader evaluates it in a worker thread with
 * a wall-clock timeout, so a config that hangs, throws, or recurses forever
 * fails as a rejected promise instead of hanging or killing the CLI.
 *
 * Worker isolation bounds FAILURE, not PRIVILEGE: the config runs as ordinary
 * Node code and can read files and open sockets. Only run it on a repository you
 * would already run `npm install && npm run build` in. The CLI keeps this
 * behind an explicit opt-in flag for that reason.
 *
 * `load` resolves to a config object of the shape `{ theme }`, already resolved
 * against Tailwind's defaults inside the worker (see the worker's own note on
 * why theme closures cannot cross the boundary).
 */

export interface WorkerConfigLoaderOptions {
  /** Wall-clock budget for evaluating one config file. Default 10s. */
  timeoutMs?: number;
}

interface WorkerReply {
  ok: boolean;
  theme?: unknown;
  error?: string;
}

const WORKER_URL = new URL("../worker/tailwind-config-worker.mjs", import.meta.url);

/** Evaluate a Tailwind v3 config file in a worker thread, bounded by a timeout. */
export function createWorkerConfigLoader(options: WorkerConfigLoaderOptions = {}): ConfigLoader {
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    load(path: string): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const worker = new Worker(WORKER_URL, { workerData: { configPath: path }, execArgv: [] });
        let settled = false;
        const finish = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          void worker.terminate();
          fn();
        };
        const timer = setTimeout(
          () => finish(() => reject(new Error(`tailwind config evaluation timed out after ${timeoutMs}ms: ${path}`))),
          timeoutMs,
        );
        worker.on("message", (reply: WorkerReply) => {
          if (reply.ok) finish(() => resolve({ theme: reply.theme }));
          else finish(() => reject(new Error(reply.error ?? "tailwind config evaluation failed")));
        });
        worker.on("error", (error: Error) => finish(() => reject(error)));
        worker.on("exit", (code: number) =>
          finish(() => reject(new Error(`tailwind config worker exited with code ${code}: ${path}`))),
        );
      });
    },
  };
}
