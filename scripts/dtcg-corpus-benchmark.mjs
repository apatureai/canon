import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { URL } from "node:url";
import { resolveTokensJson } from "../packages/context/dist/index.js";

const manifestUrl = new URL("../packages/context/test/fixtures/dtcg-real-corpus.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

function countRawTokens(value) {
  if (!value || typeof value !== "object") return 0;
  const own = "$value" in value || "value" in value ? 1 : 0;
  return own + Object.values(value).reduce((sum, child) => sum + countRawTokens(child), 0);
}

const rows = [];
const timings = [];
let deterministic = true;
let peakHeapBytes = 0;

for (const fixture of manifest.fixtures) {
  const response = await globalThis.fetch(
    `https://api.github.com/repos/${fixture.repository}/git/blobs/${fixture.blobSha}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "apature-ui-dna-dtcg-corpus",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );
  if (!response.ok) throw new Error(`${fixture.repository}/${fixture.path}: GitHub ${response.status}`);
  const blob = await response.json();
  const input = JSON.parse(Buffer.from(blob.content, "base64").toString("utf8"));
  const rawTokens = countRawTokens(input);
  const started = performance.now();
  const result = resolveTokensJson(input);
  timings.push(performance.now() - started);
  peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
  deterministic &&= JSON.stringify(result) === JSON.stringify(resolveTokensJson(input));
  const row = {
    repository: fixture.repository,
    path: fixture.path,
    rawTokens,
    resolvedTokens: result.tokens.length,
    diagnostics: result.diagnostics.length,
  };
  const expected = fixture.expected;
  if (row.rawTokens !== expected.rawTokens || row.resolvedTokens !== expected.resolvedTokens || row.diagnostics !== expected.diagnostics) {
    throw new Error(`${fixture.repository}/${fixture.path}: corpus result drifted: ${JSON.stringify(row)}`);
  }
  rows.push(row);
}

timings.sort((a, b) => a - b);
const p95Ms = timings[Math.ceil(timings.length * 0.95) - 1] ?? 0;
const peakHeapMiB = peakHeapBytes / 1_048_576;
if (!deterministic) throw new Error("Corpus output was not byte-deterministic.");
if (p95Ms > manifest.ceilings.p95Ms) throw new Error(`p95 ${p95Ms.toFixed(3)}ms exceeds ${manifest.ceilings.p95Ms}ms.`);
if (peakHeapMiB > manifest.ceilings.peakHeapMiB) throw new Error(`Peak heap ${peakHeapMiB.toFixed(2)}MiB exceeds ${manifest.ceilings.peakHeapMiB}MiB.`);

process.stdout.write(`${JSON.stringify({
  files: rows.length,
  deterministic,
  p95Ms: Number(p95Ms.toFixed(3)),
  peakHeapMiB: Number(peakHeapMiB.toFixed(2)),
  rawTokens: rows.reduce((sum, row) => sum + row.rawTokens, 0),
  resolvedTokens: rows.reduce((sum, row) => sum + row.resolvedTokens, 0),
  diagnostics: rows.reduce((sum, row) => sum + row.diagnostics, 0),
}, null, 2)}\n`);
