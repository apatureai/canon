Part of [canon](../README.md). Moved from the README on 2026-08-24; anchors preserved.

The full annotated transcripts for the three quickstart steps. The [README Quickstart](../README.md#quickstart)
keeps the commands and short excerpts; this file is the complete output, kept so the README stays
short without losing the walk-through.

Run everything from the repository root, after `pnpm install --frozen-lockfile && pnpm build`.

### 1. Resolve a token file

```console
$ node packages/cli/dist/bin.js tokens examples/sample-tokens.json
ui-dna tokens - examples/sample-tokens.json
profile        DTCG Format Module 2025.10
               aliases=true $ref=same-document-only $extends=true

resolved tokens (22)
  color.brand               color       #2f6fed
  color.brand-strong        color       #2153ba
  color.focus-ring          color       #2f6fed  <- #/color/brand/$value
  color.link                color       #2f6fed  <- color.brand
  color.link-hover          color       #2f6fed  <- color.brand <- color.link
  color.surface             color       #ffffff
  color.text                color       #0a0a0a
  component.base            dimension   4px  <- space
  component.button-padding  dimension   16px  <- space <- space.gutter
  component.gutter          dimension   16px  <- space
  component.section         dimension   48px  <- space
  font.sans                 fontFamily  ["Inter","system-ui","sans-serif"]
  motion.fast               duration    120ms
  motion.slow               duration    320ms
  radius.card               dimension   12px
  radius.control            dimension   6px
  shadow.card               shadow      {"blur":{"unit":"px","value":3},"color":{"alpha":0.08,"colorS... (--json for the exact value)
  space.base                dimension   4px
  space.gutter              dimension   16px
  space.section             dimension   48px
  typography.size-body      dimension   16px
  typography.size-heading   dimension   30px

diagnostics (4)
  invalid_value         broken.typo  A dimension must contain a finite numeric value and unit.
  circular_reference    color.loop-a  Circular token alias: color.loop-a -> color.loop-b -> color.loop-a.
  circular_reference    color.loop-b  Circular token alias: color.loop-b -> color.loop-a -> color.loop-b.
  unresolved_reference  color.missing  Token alias does not resolve: {color.nowhere}.

  A diagnostic means the token was ABSTAINED, not guessed: it is absent from the
  resolved list above rather than promoted with its reference syntax as a value.
```

**Success looks like** `resolved tokens (22)` and `diagnostics (4)`. The four broken tokens are in
the diagnostics list and absent from the resolved list. A resolver that reported 26 tokens would
have guessed.

Add `--json` for exact, unelided values, or `--strict` to exit 2 when any diagnostic was raised.

### 2. Scan a project

`examples/sample-project` is a synthetic front end that declares tokens three ways at once (a
`:root` block, a Tailwind v4 `@theme` block and a DTCG token file), plus a Tailwind v3 config that
is reported but not evaluated unless you ask. That is why this run resolves tokens instead of
reporting zero. Nothing in it is installed or built; only its design sources are read.

```console
$ node packages/cli/dist/bin.js context examples/sample-project --out out/genome.json
ui-dna context - examples/sample-project

sources (6 of 6 files walked)
  .designreview.yml   brand-identity         -           tone, audience, 2 do, 1 don't
  design.tokens.json  dtcg-tokens            2 tokens    1 diagnostic(s)
  package.json        component-libraries    -           2 library: shadcn/ui, radix
  src/styles.css      css-custom-properties  12 tokens   :root / theme scopes
  src/theme.css       tailwind-v4-theme      5 tokens    @theme block
  tailwind.config.js  tailwind-v3-config     -           not evaluated (pass --exec-tailwind-config)

resolved tokens (16)
  color         7
  typography    1
  spacing       2
  radii         2
  shadows       1
  breakpoints   1
  motion        2

identity facts (5)
component libraries (2)  shadcn/ui, radix

conflicts (2)
  tokens.color.--color-brand  resolved "#2f6fed" (code, confidence 0.49)
      "#0a58ca"  code 0.60  src/styles.css
      "#2f6fed"  code 0.70  src/theme.css
      confidence delta -0.21
  tokens.radii.--radius-card  resolved "12px" (code, confidence 0.49)
      "10px"  code 0.60  src/styles.css
      "12px"  code 0.70  src/theme.css
      confidence delta -0.21

drift hints (2)
  tokens.color.--color-brand: code says "#2f6fed" but code shows "#0a58ca"
  tokens.radii.--radius-card: code says "12px" but code shows "10px"

token diagnostics (1)
  design.tokens.json  unresolved_reference  color.accent  Token alias does not resolve: {color.brand-secondary}.

context block
  contextVersion  1
  contentHash     sha256:da5aa778e56a08caea731d4c69672400c78be88d8008aac5267086ab2b2b0a17
  bytes           2669
  the hash is content-addressed: identical sources produce an identical hash, and
  approving or re-versioning the genome does not change it.

wrote draft genome  out/genome.json
```

**Success looks like** `sources (6 of 6 files walked)`, `conflicts (2)`, the `sha256:da5aa778...`
hash, and a file at `out/genome.json`. Run it twice and the hash is identical.

Read one field out of the snapshot to see the shape:

```console
$ node -e "const g=require('./out/genome.json'); console.log(g.tokens.color['--color-brand'], g.identity.tone.value)"
{
  value: '#2f6fed',
  confidence: 0.48999999999999994,
  provenance: 'code'
} precise, quiet, never playful
```

That is the whole idea. Every field carries where it came from and how sure the extractor is, and
this token's confidence sits *below* either source that declared it, because two files disagreed.

(The CLI calls the aggregate snapshot a *genome*, and the schema type is `DnaSnapshot`. It is a JSON
document of resolved token facts, identity facts and component conventions. Nothing more magic than
that.)

### Optional: evaluate the Tailwind config

`tailwind.config.js` is executable code, so it is reported but not run unless you ask:

```console
$ node packages/cli/dist/bin.js context examples/sample-project --exec-tailwind-config | head -12
ui-dna context - examples/sample-project

sources (6 of 6 files walked)
  .designreview.yml   brand-identity         -           tone, audience, 2 do, 1 don't
  design.tokens.json  dtcg-tokens            2 tokens    1 diagnostic(s)
  package.json        component-libraries    -           2 library: shadcn/ui, radix
  src/styles.css      css-custom-properties  12 tokens   :root / theme scopes
  src/theme.css       tailwind-v4-theme      5 tokens    @theme block
  tailwind.config.js  tailwind-v3-config     348 tokens  evaluated in worker

resolved tokens (364)
  color         256
```

The jump from 16 to 364 tokens is Tailwind's default theme, which is part of the project's design
system whether or not anyone wrote it down. The config is evaluated in a worker thread with a
timeout, which bounds *failure* (a config that throws or hangs fails the load instead of taking the
CLI down), not *privilege*: it runs as ordinary Node code with your user's rights. Only point it at
a repository you would already run `npm install` in.

### 3. Point it at your own repository

This is the caveat from the top of the README, stated in full, because a *correct* run on a real
project often finds nothing.

`ui-dna` reads **declared** design tokens. It does not infer a design system from usage: it will not
mine `p-4 rounded-lg text-slate-900` out of your JSX and call it a spacing scale. Concretely, you
get tokens from a `:root` / `html` / `.dark` / `[data-theme]` block of custom properties, a literal
Tailwind v4 `@theme { ... }` block, a DTCG or Style Dictionary token file, or a Tailwind v3 config
**with `--exec-tailwind-config`**. Importing Tailwind v4 as `@import "tailwindcss"` declares nothing
in your repository (that theme lives inside the npm package), and `package.json` only contributes
component conventions for shadcn/ui, Radix, MUI, Chakra and Mantine.

So a plain Vite/React app that styles entirely in utility classes legitimately reports zero tokens.
`examples/utility-only-project` is exactly that project, and it shows what an honest empty result
looks like:

```console
$ node packages/cli/dist/bin.js context examples/utility-only-project | head -20
ui-dna context - examples/utility-only-project

sources (3 of 3 files walked)
  package.json   component-libraries    -           no recognised component library (shadcn/ui, radix, mui, chakra, mantine)
  src/App.css    css-custom-properties  -           no custom properties in :root/html or a theme scope
  src/index.css  css-custom-properties  -           no custom properties in :root/html or a theme scope

resolved tokens (0)
  color         0
  typography    0
  spacing       0
  radii         0
  shadows       0
  breakpoints   0
  motion        0
  (none declared. ui-dna reads tokens a repository states outright: a :root/html/.dark/
   [data-theme] custom-property block, a Tailwind v4 @theme block, a DTCG or Style
   Dictionary token file, or a Tailwind v3 config with --exec-tailwind-config. It does
   not infer a scale from utility classes or from rendered output, so it abstains here
   instead of guessing. Each source above states what it contributed.)
```

The report explains its own zero, so nobody has to find this section to interpret one. Every
candidate file the walk opened is listed with the reason it contributed nothing, and the
`(none declared. ...)` note prints whenever files were read but no token was declared.
`sources (0 of N files walked)` is a different statement: no candidate file was found at all, which
usually means the path is wrong, and that case prints its own message instead. And if the walk was
truncated, that message says so too: `(none reached: the walk stopped after N files without finding
a candidate.)`, because a bounded walk is not entitled to claim the repository declares nothing.
