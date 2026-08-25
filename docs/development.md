Part of [canon](../README.md). Moved from the README on 2026-08-24; anchors preserved.

## Development

```console
$ pnpm test
 Test Files  60 passed (60)
      Tests  519 passed (519)
```

```bash
pnpm lint         # eslint . --max-warnings=0 (warnings fail)
pnpm typecheck    # tsc -b (same as pnpm build)
pnpm vitest run packages/cli/test/scan.test.ts    # one file
pnpm vitest run packages/cli                      # one package
```

CI (`.github/workflows/ci.yml`) runs exactly `lint`, `typecheck`, `test` on pull requests and pushes
to `main`, with `permissions: contents: read`.

`pnpm eval:dtcg-corpus` is outside the gate and is the only thing in the repository that touches the
network. It fetches 20 public token files from `api.github.com` by immutable blob SHA and asserts
its recorded per-file expectations, so it fails if resolution behaviour drifts. Set `GITHUB_TOKEN`
or `GH_TOKEN` to avoid the 60-requests-per-hour anonymous rate limit. Last run:

```console
$ pnpm eval:dtcg-corpus
{
  "files": 20,
  "deterministic": true,
  "p95Ms": 1.885,
  "peakHeapMiB": 14.87,
  "rawTokens": 1629,
  "resolvedTokens": 384,
  "diagnostics": 1223,
  "filesResolvingZeroTokens": 10,
  "filesWithZeroDiagnostics": 1
}
```

Every number quoted from this corpus above is in that output, and all of them except `p95Ms` and
`peakHeapMiB` are properties of the files rather than of the machine: they must come out identical
on yours, because the blobs are pinned by SHA and the script asserts each file against its recorded
per-file expectation. The two timing numbers will not match, and are not meant to.

If `node packages/cli/dist/bin.js` reports that it cannot find the module, `pnpm build` has not been
run.

### The hero image

`docs/assets/hero.png` is the `ui-dna tokens` output rendered into the shared terminal frame. To
regenerate it after the CLI output changes: run `node packages/cli/dist/bin.js tokens
examples/sample-tokens.json`, paste the captured bytes into the `<pre>` of
`docs/assets/terminal-frame.html` (and update `docs/assets/hero-transcript.txt` to match), then
screenshot the `.frame` element with a headless Chromium at width 1520, `deviceScaleFactor` 2.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for conventions, layout and how pull requests are reviewed.

## Releasing

Releases publish the six public `@apatureai/*` packages to npm together, keyed off a version tag.
[`CHANGELOG.md`](../CHANGELOG.md) records what each version contains.

**One-time maintainer setup.** Create an npm **automation** token with publish rights on the
`@apatureai` scope (npmjs.com → Access Tokens → Generate → *Automation*), then add it to the repo as an
Actions secret named `NPM_TOKEN` (Settings → Secrets and variables → Actions). Nothing else reads the
token; lint, typecheck, test and build all run without it.

**Cutting a release.**

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under a new `[x.y.z]` heading and set the same
   `version` in every package's `package.json` (they are versioned together).
2. Commit, then tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. [`.github/workflows/release.yml`](../.github/workflows/release.yml) runs on the tag: it verifies the
   tag matches `@apatureai/canon`'s version, runs the full gate (lint · typecheck · test · build), and
   publishes every non-private package with `pnpm -r publish --access public` and npm build
   provenance (`id-token: write`). `@apatureai/canon-eval` is `private: true` and is skipped.

`pnpm` rewrites each `workspace:*` dependency range to the concrete version in the published
tarballs; a direct `npm publish` would not, so publish through the workflow (or `pnpm publish`), not
`npm`.
