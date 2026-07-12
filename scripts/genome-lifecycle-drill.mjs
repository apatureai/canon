#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const uiDnaRoot = resolve(here, "..");
const productRoot = resolve(process.env.APATURE_DRILL_ROOT ?? resolve(uiDnaRoot, ".."));
const repos = {
  uiDna: resolve(productRoot, "ui-dna"),
  consultant: resolve(productRoot, "dna-consultant"),
  sourceOfTruth: resolve(productRoot, "source-of-truth"),
  judgmentEngine: resolve(productRoot, "judgment-engine"),
};

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
}

if (!process.argv.includes("--skip-build")) {
  for (const root of Object.values(repos)) {
    run("pnpm", ["install", "--frozen-lockfile"], root);
    run("pnpm", ["build"], root);
  }
}

const moduleAt = (root, relative) => import(pathToFileURL(resolve(root, relative)).href);
const [schema, context, store, session, onboarding, approvals, sotSnapshot, sotRead, sotHttp, sotMcp, engineRuntime, engineContext, engineReview] =
  await Promise.all([
    moduleAt(repos.uiDna, "packages/schema/dist/index.js"),
    moduleAt(repos.uiDna, "packages/context/dist/css-vars-dna.js"),
    moduleAt(repos.uiDna, "packages/store/dist/index.js"),
    moduleAt(repos.consultant, "packages/session/dist/index.js"),
    moduleAt(repos.consultant, "packages/onboarding/dist/index.js"),
    moduleAt(repos.consultant, "packages/approvals/dist/index.js"),
    moduleAt(repos.sourceOfTruth, "packages/sot-snapshot/dist/index.js"),
    moduleAt(repos.sourceOfTruth, "packages/sot-read/dist/index.js"),
    moduleAt(repos.sourceOfTruth, "packages/sot-http/dist/index.js"),
    moduleAt(repos.sourceOfTruth, "packages/sot-mcp/dist/index.js"),
    moduleAt(repos.judgmentEngine, "packages/runtime/dist/index.js"),
    moduleAt(repos.judgmentEngine, "packages/context/dist/index.js"),
    moduleAt(repos.judgmentEngine, "packages/review/dist/index.js"),
  ]);

const repository = "apatureai/genome-drill";
const [owner, name] = repository.split("/");
const css = `:root { --color-brand: #0a0a0a; --spacing-gap: 8px; }`;
const snapshotStore = store.inMemorySnapshotStore();
const draft = schema.emptyDraft(owner, name, "genome-drill-extractor@1");
draft.tokens = context.extractCssTokens(css);
const draftCommit = await store.commitSnapshot(snapshotStore, draft);
const digestOf = (snapshot) =>
  `sha256:${createHash("sha256").update(store.serializeGenomeContent(snapshot)).digest("hex")}`;
const refOf = (snapshot, contentDigest) => ({
  schemaVersion: snapshot.metadata.schemaVersion,
  dnaVersion: snapshot.metadata.dnaVersion,
  contentDigest,
  state: snapshot.metadata.approvalState,
  repository: snapshot.repository,
  exceptions: snapshot.exceptions,
});
const draftRef = refOf(draftCommit.stored.snapshot, digestOf(draftCommit.stored.snapshot));

const tenant = {
  tenantId: "tenant_genome_drill",
  onBehalfOf: { principalId: "design-system-owner", principalKind: "user" },
};
let id = 0;
let tick = 0;
const sessions = new session.SessionMachine({
  store: new session.InMemorySessionStore(),
  clock: () => new Date(Date.UTC(2026, 6, 11, 20, tick++)),
  newId: () => `drill-${++id}`,
});
const created = await sessions.create(tenant);
await sessions.transition(tenant, created.sessionId, "repo_bound", {
  repositoryBindingRef: "fixture://genome-drill",
});
await onboarding.extractDraftOntoSession(
  {
    sessions,
    uiDna: {
      requestDraftExtraction: async () => ({ draftRef, driftHints: [] }),
      getSnapshotRef: async () => draftRef,
    },
  },
  tenant,
  created.sessionId,
);

let approvedResponse;
const approvalDeps = {
  sessions,
  approvals: new approvals.InMemoryApprovalStore(),
  clock: () => new Date("2026-07-11T20:05:00.000Z"),
  newId: () => `decision-${++id}`,
  sink: {
    promoteApproved: async (request) => {
      if (request.draftRef.dnaVersion !== draftCommit.dnaVersion) throw new Error("draft identity drift");
      const review = {
        decisions: request.approvedItemIds.map((path) => ({ path, action: "accept" })),
      };
      const result = await store.approveSnapshot(
        snapshotStore,
        store.requestReview(draftCommit.stored.snapshot),
        review,
      );
      approvedResponse = await store.getSnapshot(snapshotStore, repository, {
        version: result.commit.dnaVersion,
      });
      if (!approvedResponse) throw new Error("approved snapshot was not readable");
      return refOf(approvedResponse.snapshot, approvedResponse.contentDigest);
    },
  },
};
const reviewItems = [
  { itemId: "tokens.color.--color-brand" },
  { itemId: "tokens.spacing.--spacing-gap" },
];
for (const item of reviewItems) {
  await approvals.recordDecision(approvalDeps, tenant, created.sessionId, {
    itemId: item.itemId,
    disposition: "approved",
    decidedBy: tenant.onBehalfOf,
  });
}
const signoff = await approvals.finalizeSignoff(
  approvalDeps,
  tenant,
  created.sessionId,
  reviewItems,
);
if (!approvedResponse) throw new Error("approval adapter did not produce a response");

const failure = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};
const unapprovedRejected = await failure(() =>
  sotSnapshot.mirrorApprovedSnapshot(
    {
      contract: { schemaVersion: "1", storeVersion: "2" },
      repo: repository,
      dnaVersion: draftCommit.dnaVersion,
      contentDigest: draftRef.contentDigest,
      snapshot: draftCommit.stored.snapshot,
    },
    { approvedAt: "2026-07-11T20:05:00.000Z" },
  ),
);
const staleDigestRejected = await failure(() =>
  sotSnapshot.mirrorApprovedSnapshot(
    { ...approvedResponse, contentDigest: `sha256:${"0".repeat(64)}` },
    { approvedAt: "2026-07-11T20:05:00.000Z" },
  ),
);

const mirrored = sotSnapshot.mirrorApprovedSnapshot(approvedResponse, {
  approvedAt: "2026-07-11T20:05:00.000Z",
});
const snapshots = sotSnapshot.inMemorySnapshotResolverPort();
snapshots.add(mirrored);
const read = new sotRead.ReadService({
  authorization: { authorize: async () => ({ decision: "allow", decisionId: "drill-policy" }) },
  snapshots,
  audit: { record: async () => undefined },
  clock: () => new Date("2026-07-11T20:06:00.000Z"),
});
const http = sotHttp.createHttpHandler({ read, newRequestId: () => "genome-drill-request" });
const httpResponse = await http({
  method: "GET",
  path: `/v1/repos/${encodeURIComponent(repository)}/ui-dna`,
  headers: { "x-request-id": "genome-drill-request" },
  query: { max_items: "100" },
  tenantId: tenant.tenantId,
  principal: tenant.onBehalfOf.principalId,
});
if (httpResponse.status !== 200) throw new Error(`Source of Truth HTTP returned ${httpResponse.status}`);
const mcp = sotMcp.createMcpHandler({ read });
const mcpResponse = await mcp({
  method: "tools/call",
  requestId: "genome-drill-request",
  identity: { tenantId: tenant.tenantId, principal: tenant.onBehalfOf.principalId },
  params: { name: "get_ui_dna", arguments: { repo_id: repository, max_items: 100 } },
});
if (!mcpResponse.ok) throw new Error("Source of Truth MCP call failed");
const mcpAnswer = mcpResponse.result.structuredContent;
if (JSON.stringify(mcpAnswer) !== JSON.stringify(httpResponse.body)) {
  throw new Error("Source of Truth HTTP/MCP semantic drift");
}

async function judgment(answer) {
  const resolver = new engineRuntime.HttpGenomeResolver(
    "https://source.fixture.test",
    "fixture-token",
    async () => new globalThis.Response(JSON.stringify(answer), { status: 200 }),
  );
  const resolvedGenome = await resolver.resolve(repository, tenant.tenantId);
  if (!resolvedGenome) throw new Error("Judgment Engine resolved no genome");
  const embedder = async (texts) => texts.map((text) => [text.includes("#0a0a0a") ? 1 : 0, 1]);
  const genomeIndex = await engineContext.buildGenomeIndex(
    resolvedGenome.version,
    resolvedGenome.rules,
    embedder,
  );
  const calls = [];
  const modelFactory = () => ({
    backend: "mock",
    complete: async (request) => {
      calls.push(request);
      const system = request.messages.find((message) => message.role === "system")?.content ?? "";
      let text;
      if (system.startsWith("You are triaging")) {
        text = JSON.stringify({ needsDeepReview: true, suspectRoutes: ["/"], obviousBreakage: [] });
      } else if (request.responseFormat === "json_object" || request.responseFormat === "json_schema") {
        text = JSON.stringify({ grade: "ship", overall: "fixture review", findings: [] });
      } else {
        text = "/";
      }
      return {
        text,
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        finishReason: "stop",
      };
    },
  });
  const result = await engineReview.runReview(
    {
      url: "https://preview.fixture.test",
      depth: "deep",
      context: {
        tokens: {},
        brand: null,
        componentLibraries: [],
        uiDnaVersion: resolvedGenome.version,
        routes: ["/"],
      },
      captureContext: {
        installationId: tenant.tenantId,
        viewports: ["desktop"],
        darkMode: false,
        isFork: false,
        routes: ["/"],
      },
      routes: [{ route: "/", currentPhash: "changed" }],
      wireOptions: { screenshotRetentionSeconds: 3600 },
    },
    {
      captureInSandbox: async () => ({
        images: [{ route: "/", viewport: "desktop", objectKey: "fixture/home.png", width: 1280, height: 720 }],
        geometry: [],
        pageHealth: { consoleErrors: 0, failedRequests: 0, unstable: false },
        captureVersion: "genome-drill-capture@1",
      }),
      modelFactory,
      genomeIndex,
      embedder,
    },
  );
  return {
    version: result.metadata.uiDnaVersion,
    ruleCount: resolvedGenome.rules.length,
    groundingObserved: JSON.stringify(calls).includes("#0a0a0a"),
  };
}

const judged = await judgment(httpResponse.body);
const mismatchAnswer = globalThis.structuredClone(httpResponse.body);
mismatchAnswer.snapshot.id = "stale-ui-dna-version";
const mismatched = await judgment(mismatchAnswer);
const mismatchVisible = mismatched.version !== approvedResponse.dnaVersion;

const audit = await sessions.auditTrail(tenant, created.sessionId);
const summary = {
  contract: "genome-lifecycle-drill/1",
  repository,
  draft: {
    dnaVersion: draftCommit.dnaVersion,
    contentDigest: draftRef.contentDigest,
    state: draftRef.state,
  },
  consultant: {
    phase: signoff.session.phase,
    approvedDnaVersion: signoff.approvedRef.dnaVersion,
    authoritativeVersionChanged: signoff.approvedRef.dnaVersion !== draftRef.dnaVersion,
    auditKinds: audit.map((event) => event.kind),
  },
  sourceOfTruth: {
    snapshotId: mirrored.snapshotId,
    contentDigest: mirrored.contentDigest,
    itemIds: httpResponse.body.items.map((item) => item.field_id),
    httpMcpEqual: true,
  },
  judgmentEngine: {
    uiDnaVersion: judged.version,
    ruleCount: judged.ruleCount,
    groundingObserved: judged.groundingObserved,
    mismatchStamp: mismatched.version,
  },
  failures: { unapprovedRejected, staleDigestRejected, mismatchVisible },
};

if (!Object.values(summary.failures).every(Boolean)) throw new Error("one or more failure legs did not fail closed");
if (!summary.consultant.authoritativeVersionChanged) throw new Error("approval reused the draft lifecycle identity");
if (!summary.judgmentEngine.groundingObserved) throw new Error("approved genome rules did not reach the critique prompt");
if (summary.judgmentEngine.uiDnaVersion !== approvedResponse.dnaVersion) throw new Error("critique version stamp drifted");

const serialized = `${JSON.stringify(summary, null, 2)}\n`;
const goldenPaths = [
  resolve(repos.uiDna, "packages/store/test/fixtures/genome-lifecycle-drill.golden.json"),
  resolve(repos.consultant, "packages/approvals/test/fixtures/genome-lifecycle-drill.golden.json"),
  resolve(repos.sourceOfTruth, "packages/sot-snapshot/test/fixtures/genome-lifecycle-drill.golden.json"),
  resolve(repos.judgmentEngine, "packages/runtime/test/fixtures/genome-lifecycle-drill.golden.json"),
];
if (process.argv.includes("--write-goldens")) {
  for (const goldenPath of goldenPaths) {
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, serialized);
  }
} else if (!process.argv.includes("--emit")) {
  for (const goldenPath of goldenPaths) {
    const golden = readFileSync(goldenPath, "utf8");
    if (serialized !== golden) throw new Error(`genome lifecycle golden drifted: ${goldenPath}`);
  }
}
process.stdout.write(serialized);
