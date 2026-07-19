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
const [schema, context, store, session, onboarding, approvals, recommendations, sotSnapshot, sotRead, sotHttp, sotMcp, engineRuntime, engineContext, engineReview, engineCritique] =
  await Promise.all([
    moduleAt(repos.uiDna, "packages/schema/dist/index.js"),
    moduleAt(repos.uiDna, "packages/context/dist/css-vars-dna.js"),
    moduleAt(repos.uiDna, "packages/store/dist/index.js"),
    moduleAt(repos.consultant, "packages/session/dist/index.js"),
    moduleAt(repos.consultant, "packages/onboarding/dist/index.js"),
    moduleAt(repos.consultant, "packages/approvals/dist/index.js"),
    moduleAt(repos.consultant, "packages/recommendations/dist/index.js"),
    moduleAt(repos.sourceOfTruth, "packages/sot-snapshot/dist/index.js"),
    moduleAt(repos.sourceOfTruth, "packages/sot-read/dist/index.js"),
    moduleAt(repos.sourceOfTruth, "packages/sot-http/dist/index.js"),
    moduleAt(repos.sourceOfTruth, "packages/sot-mcp/dist/index.js"),
    moduleAt(repos.judgmentEngine, "packages/runtime/dist/index.js"),
    moduleAt(repos.judgmentEngine, "packages/context/dist/index.js"),
    moduleAt(repos.judgmentEngine, "packages/review/dist/index.js"),
    moduleAt(repos.judgmentEngine, "packages/critique/dist/index.js"),
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
    { tenantId: tenant.tenantId, approvedAt: "2026-07-11T20:05:00.000Z" },
  ),
);
const staleDigestRejected = await failure(() =>
  sotSnapshot.mirrorApprovedSnapshot(
    { ...approvedResponse, contentDigest: `sha256:${"0".repeat(64)}` },
    { tenantId: tenant.tenantId, approvedAt: "2026-07-11T20:05:00.000Z" },
  ),
);

const mirrored = sotSnapshot.mirrorApprovedSnapshot(approvedResponse, {
  tenantId: tenant.tenantId,
  approvedAt: "2026-07-11T20:05:00.000Z",
});
const snapshots = sotSnapshot.inMemorySnapshotResolverPort();
snapshots.add(mirrored);

// UI-DNA approval authority (#64): the approved version enters the append-only
// authority log as `effective` before anything downstream serves or grounds it.
const versionA = approvedResponse.dnaVersion;
const authority = store.inMemoryAuthorityStore();
const keyA = { tenant: tenant.tenantId, repo: repository, dnaVersion: versionA };
const actor = { principalId: "design-system-owner", principalKind: "user" };
const effectiveA = {
  eventId: "authority-evt-a1",
  sequence: 1,
  key: keyA,
  status: "effective",
  effectiveAt: "2026-07-11T20:05:30.000Z",
  actor,
  priorEventHash: null,
};
if (!authority.append(effectiveA).ok) throw new Error("effective authority event for A did not append");
const authorityRefAt = (dnaVersion, checkedAt) => {
  const status = authority.status({ tenant: tenant.tenantId, repo: repository, dnaVersion });
  return {
    contractVersion: status.contractVersion,
    status: status.status,
    sequence: status.sequence,
    headEventHash: status.headEventHash,
    checkedAt,
  };
};

const read = new sotRead.ReadService({
  authorization: { authorize: async () => ({ decision: "allow", decisionId: "drill-policy" }) },
  snapshots,
  audit: { record: async () => undefined },
  clock: () => new Date("2026-07-11T20:06:00.000Z"),
  authority: {
    statusFor: async (tenantId, repo, dnaVersion) => authorityRefAt(dnaVersion, "2026-07-11T20:06:00.000Z"),
  },
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
mismatchAnswer.snapshot.dna_version = "stale-ui-dna-version";
const mismatched = await judgment(mismatchAnswer);
const mismatchVisible = mismatched.version !== approvedResponse.dnaVersion;

// ---------------------------------------------------------------------------
// Revocation leg (ui-dna#64 / #72): approve A → serve/ground A (above) →
// revoke A → every ordinary read and new blocking decision fails closed →
// approve B → latest resolves B. UI-DNA is the sole authority; Source of
// Truth, DNA Consultant, and Judgment Engine each enforce its mirrored status.
// ---------------------------------------------------------------------------
const resolveAuthority = (dnaVersion) =>
  authority.status({ tenant: tenant.tenantId, repo: repository, dnaVersion }).status;
const uiDnaLatestBefore = await store.getSnapshot(snapshotStore, repository, { resolveAuthority });
const uiDnaPinnedBefore = await store.getSnapshot(snapshotStore, repository, { version: versionA, resolveAuthority });

// Authority-log admission matrix: every unsafe append rejects with a typed
// reason; only a byte-identical replay of the head is an idempotent no-op.
const logA = authority.log(keyA);
const hashA1 = store.hashAuthorityEvent(effectiveA);
const rejectionOf = (event, log = logA) => {
  const result = store.appendAuthorityEvent(log, event);
  return result.ok ? "accepted" : result.reason;
};
const replay = authority.append(effectiveA);
const logRejections = {
  idempotentReplay: replay.ok === true && replay.idempotentReplay === true,
  duplicateConflict: rejectionOf({ ...effectiveA, effectiveAt: "2026-07-11T20:08:00.000Z" }),
  sequenceGap: rejectionOf({ ...effectiveA, eventId: "authority-evt-gap", sequence: 3, priorEventHash: hashA1, status: "superseded", effectiveAt: "2026-07-11T20:08:00.000Z", replacementDnaVersion: "unknown" }),
  forgedPriorHash: rejectionOf({ ...effectiveA, eventId: "authority-evt-forged", sequence: 2, priorEventHash: `sha256:${"f".repeat(64)}`, status: "revoked", reason: "other", effectiveAt: "2026-07-11T20:08:00.000Z" }),
  backdated: rejectionOf({ ...effectiveA, eventId: "authority-evt-backdated", sequence: 2, priorEventHash: hashA1, status: "revoked", reason: "other", effectiveAt: "2026-07-11T20:00:00.000Z" }),
  wrongTenant: rejectionOf({ ...effectiveA, eventId: "authority-evt-cross", sequence: 2, priorEventHash: hashA1, key: { ...keyA, tenant: "tenant_other" }, status: "revoked", reason: "other", effectiveAt: "2026-07-11T20:08:00.000Z" }),
  missingReason: rejectionOf({ ...effectiveA, eventId: "authority-evt-noreason", sequence: 2, priorEventHash: hashA1, status: "revoked", effectiveAt: "2026-07-11T20:08:00.000Z" }),
};

// The withdrawal itself: append-only, chained, reasoned, idempotency-keyed.
const revokeA = {
  eventId: "authority-evt-a2",
  sequence: 2,
  key: keyA,
  status: "revoked",
  effectiveAt: "2026-07-11T20:09:00.000Z",
  reason: "compromised_account",
  actor,
  priorEventHash: hashA1,
};
if (!authority.append(revokeA).ok) throw new Error("revocation event for A did not append");
logRejections.afterRevoked = rejectionOf(
  { ...effectiveA, eventId: "authority-evt-resurrect", sequence: 3, priorEventHash: store.hashAuthorityEvent(revokeA), effectiveAt: "2026-07-11T20:09:30.000Z" },
  authority.log(keyA),
);

// UI-DNA ordinary reads now withhold A, non-enumeratingly (null, not an error).
const uiDnaLatestAfter = await store.getSnapshot(snapshotStore, repository, { resolveAuthority });
const uiDnaPinnedAfter = await store.getSnapshot(snapshotStore, repository, { version: versionA, resolveAuthority });

// Source of Truth enforcement: the mirrored authority status gates the resolver.
const authorityClock = () => new Date("2026-07-11T20:10:00.000Z");
const sotRefFor = (dnaVersion) => authorityRefAt(dnaVersion, "2026-07-11T20:10:00.000Z");
const sotAuthorityPort = { statusFor: async (tenantId, repo, dnaVersion) => sotRefFor(dnaVersion) };
const sotErrorOf = async (fn) => {
  try {
    await fn();
    return "served";
  } catch (error) {
    return error instanceof sotSnapshot.SnapshotError ? error.code : `unexpected:${String(error)}`;
  }
};
const sotResolveOpts = { tenantId: tenant.tenantId, authority: sotAuthorityPort, authorityNow: authorityClock };
const sotLatestRevoked = await sotErrorOf(() => sotSnapshot.resolveSnapshot(snapshots, repository, sotResolveOpts));
const sotPinnedRevoked = await sotErrorOf(() =>
  sotSnapshot.resolveSnapshot(snapshots, repository, { ...sotResolveOpts, snapshot: mirrored.snapshotId }),
);
const sotPinnedMissing = await sotErrorOf(() =>
  sotSnapshot.resolveSnapshot(snapshots, repository, { ...sotResolveOpts, snapshot: "no-such-snapshot" }),
);

// An authority-mirror outage must fail closed even when stale serving was
// permitted and a cached last-known-good record is in hand.
const outagePort = { statusFor: async () => { throw new sotSnapshot.AuthorityEvidenceError("missing", "authority mirror outage"); } };
const sotStaleFallbackRejected = await sotErrorOf(() =>
  sotSnapshot.resolveSnapshot(snapshots, repository, {
    tenantId: tenant.tenantId,
    authority: outagePort,
    authorityNow: authorityClock,
    stale: { allowStale: true, reason: "drill outage", freshnessCheckedAt: "2026-07-11T20:10:00.000Z" },
    lastKnownGood: mirrored,
  }),
);

// A delayed pre-revocation mirror response can never resurrect A: the
// monotonic guard rejects the sequence regression.
const flip = [sotRefFor(versionA), { ...sotRefFor(versionA), status: "effective", sequence: 1, headEventHash: hashA1 }];
const monotonic = sotSnapshot.monotonicAuthorityStatusPort({ statusFor: async () => flip.shift() });
await monotonic.statusFor(tenant.tenantId, repository, versionA);
let monotonicRegression = "served";
try {
  await monotonic.statusFor(tenant.tenantId, repository, versionA);
} catch (error) {
  monotonicRegression = error instanceof sotSnapshot.AuthorityEvidenceError ? error.reason : `unexpected:${String(error)}`;
}

// The privileged audit path still reaches the immutable bytes, with the
// revoked status disclosed — auditors see history; ordinary consumers see nothing.
const audited = await sotSnapshot.resolveSnapshot(snapshots, repository, {
  ...sotResolveOpts,
  snapshot: mirrored.snapshotId,
  privilegedAudit: true,
});

// DNA Consultant: new work grounded on A refuses with an audited invalidation;
// a replayed pre-revocation "effective" receipt cannot reopen the gate.
const verifiedEffectiveA = { contractVersion: "uidna-authority/1", status: "effective", sequence: 1, headEventHash: hashA1, checkedAt: "2026-07-11T20:08:00.000Z" };
const emptyScan = { scanId: "drill-scan-1", divergences: [], proposedTasks: [], newId: () => `rec-${++id}`, clock: () => new Date("2026-07-11T20:10:30.000Z") };
const consultantRefused = recommendations.generateRecommendationsForVersion(
  tenant,
  emptyScan,
  { repositoryId: repository, dnaVersion: versionA },
  { ...sotRefFor(versionA), checkedAt: "2026-07-11T20:10:30.000Z" },
  { invalidationId: () => "invalidation-1", clock: () => new Date("2026-07-11T20:10:30.000Z"), previousAuthority: verifiedEffectiveA },
);
const consultantReplay = recommendations.generateRecommendationsForVersion(
  tenant,
  { ...emptyScan, scanId: "drill-scan-2" },
  { repositoryId: repository, dnaVersion: versionA },
  verifiedEffectiveA,
  {
    invalidationId: () => "invalidation-2",
    clock: () => new Date("2026-07-11T20:08:30.000Z"),
    previousAuthority: { ...sotRefFor(versionA), checkedAt: "2026-07-11T20:08:00.000Z" },
  },
);

// Recovery: approve B, record its effective authority, mirror it — latest
// resolves B everywhere while A stays withdrawn.
const cssB = `:root { --color-brand: #0a0a0a; --spacing-gap: 12px; }`;
const draftB = schema.emptyDraft(owner, name, "genome-drill-extractor@1");
draftB.tokens = context.extractCssTokens(cssB);
const draftCommitB = await store.commitSnapshot(snapshotStore, draftB);
const approveB = await store.approveSnapshot(
  snapshotStore,
  store.requestReview(draftCommitB.stored.snapshot),
  { decisions: reviewItems.map((item) => ({ path: item.itemId, action: "accept" })) },
);
const versionB = approveB.commit.dnaVersion;
if (!authority.append({
  eventId: "authority-evt-b1",
  sequence: 1,
  key: { tenant: tenant.tenantId, repo: repository, dnaVersion: versionB },
  status: "effective",
  effectiveAt: "2026-07-11T20:11:00.000Z",
  actor,
  priorEventHash: null,
}).ok) throw new Error("effective authority event for B did not append");

const approvedResponseB = await store.getSnapshot(snapshotStore, repository, { version: versionB, resolveAuthority });
if (!approvedResponseB) throw new Error("approved B was not readable under authority");
const uiDnaLatestB = await store.getSnapshot(snapshotStore, repository, { resolveAuthority });
snapshots.add(
  sotSnapshot.mirrorApprovedSnapshot(approvedResponseB, {
    tenantId: tenant.tenantId,
    approvedAt: "2026-07-11T20:11:00.000Z",
  }),
);
const sotLatestB = await sotSnapshot.resolveSnapshot(snapshots, repository, sotResolveOpts);
const httpResponseB = await http({
  method: "GET",
  path: `/v1/repos/${encodeURIComponent(repository)}/ui-dna`,
  headers: { "x-request-id": "genome-drill-request-b" },
  query: { max_items: "100" },
  tenantId: tenant.tenantId,
  principal: tenant.onBehalfOf.principalId,
});
if (httpResponseB.status !== 200) throw new Error(`Source of Truth HTTP returned ${httpResponseB.status} for B`);
const judgedB = await judgment(httpResponseB.body);
const consultantAllowedB = recommendations.generateRecommendationsForVersion(
  tenant,
  { ...emptyScan, scanId: "drill-scan-3" },
  { repositoryId: repository, dnaVersion: versionB },
  { ...sotRefFor(versionB), checkedAt: "2026-07-11T20:11:30.000Z" },
  { invalidationId: () => "invalidation-3", clock: () => new Date("2026-07-11T20:11:30.000Z"), previousAuthority: null },
);

// Judgment Engine: a result grounded on the revoked A loses blocking authority
// (blocked floors to needs_work, advisory note names the withdrawn version);
// effective B passes through unchanged; unknown never blocks either.
const groundingMirror = engineCritique.inMemoryGroundingAuthority([
  { uiDnaVersion: versionA, status: "revoked" },
  { uiDnaVersion: versionB, status: "effective" },
]);
const enforcedRevoked = engineCritique.enforceGroundingAuthority(
  { grade: "blocked", notReviewed: [], metadata: { uiDnaVersion: judged.version } },
  groundingMirror.statusFor(judged.version),
);
const enforcedEffective = engineCritique.enforceGroundingAuthority(
  { grade: "blocked", notReviewed: [], metadata: { uiDnaVersion: judgedB.version } },
  groundingMirror.statusFor(judgedB.version),
);
const enforcedUnknown = engineCritique.enforceGroundingAuthority(
  { grade: "blocked", notReviewed: [], metadata: { uiDnaVersion: "never-approved@1" } },
  groundingMirror.statusFor("never-approved@1"),
);

const audit = await sessions.auditTrail(tenant, created.sessionId);
const summary = {
  contract: "genome-lifecycle-drill/2",
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
  authority: {
    contractVersion: store.AUTHORITY_CONTRACT_VERSION,
    revokedVersion: versionA,
    revocationReason: revokeA.reason,
    headSequence: authority.status(keyA).sequence,
    logRejections,
    uiDna: {
      latestServedBeforeRevocation: uiDnaLatestBefore?.dnaVersion === versionA,
      pinnedServedBeforeRevocation: uiDnaPinnedBefore?.dnaVersion === versionA,
      latestWithheldAfterRevocation: uiDnaLatestAfter === null,
      pinnedWithheldAfterRevocation: uiDnaPinnedAfter === null,
    },
    sourceOfTruth: {
      latestRevokedCode: sotLatestRevoked,
      pinnedRevokedCode: sotPinnedRevoked,
      pinnedNonEnumerating: sotPinnedRevoked === sotPinnedMissing,
      staleFallbackRejectedCode: sotStaleFallbackRejected,
      monotonicRegression,
      privilegedAuditStatus: audited.authority?.status ?? null,
      privilegedAuditSnapshotId: audited.record.snapshotId,
      latestAfterApproveB: sotLatestB.record.snapshot.metadata.dnaVersion,
    },
    consultant: {
      refused: consultantRefused.refused,
      refusalReason: consultantRefused.refused ? consultantRefused.invalidation.reason : null,
      refusalNamesVersion: consultantRefused.refused && consultantRefused.invalidation.dnaVersion === versionA,
      replayRefused: consultantReplay.refused,
      replayFailureReason: consultantReplay.refused ? (consultantReplay.invalidation.authorityFailureReason ?? null) : null,
      effectiveBGenerated: consultantAllowedB.refused === false,
    },
    judgmentEngine: {
      revokedFlooredGrade: enforcedRevoked.grade,
      revokedBlockingEnabled: enforcedRevoked.blockingEnabled ?? null,
      revokedNoteNamesVersion: enforcedRevoked.notReviewed.some((note) => note.includes(versionA) && note.includes("revoked")),
      effectiveUnchangedGrade: enforcedEffective.grade,
      unknownFlooredGrade: enforcedUnknown.grade,
      versionStampB: judgedB.version,
    },
    recovery: {
      approvedVersionB: versionB,
      distinctFromA: versionB !== versionA,
      uiDnaLatestResolvesB: uiDnaLatestB?.dnaVersion === versionB,
    },
  },
};

if (!Object.values(summary.failures).every(Boolean)) throw new Error("one or more failure legs did not fail closed");
if (!summary.consultant.authoritativeVersionChanged) throw new Error("approval reused the draft lifecycle identity");
if (!summary.judgmentEngine.groundingObserved) throw new Error("approved genome rules did not reach the critique prompt");
if (summary.judgmentEngine.uiDnaVersion !== approvedResponse.dnaVersion) throw new Error("critique version stamp drifted");

const auth = summary.authority;
if (!auth.logRejections.idempotentReplay) throw new Error("byte-identical replay was not an idempotent no-op");
for (const [leg, expected] of Object.entries({
  duplicateConflict: "duplicate_out_of_order_event",
  sequenceGap: "sequence_gap",
  forgedPriorHash: "prior_hash_mismatch",
  backdated: "backdated_effective_time",
  wrongTenant: "wrong_tenant",
  missingReason: "missing_revocation_reason",
  afterRevoked: "illegal_status_transition",
})) {
  if (auth.logRejections[leg] !== expected) throw new Error(`authority log leg ${leg} was ${auth.logRejections[leg]}, expected ${expected}`);
}
if (!auth.uiDna.latestServedBeforeRevocation || !auth.uiDna.pinnedServedBeforeRevocation) {
  throw new Error("effective version A was not served before revocation");
}
if (!auth.uiDna.latestWithheldAfterRevocation || !auth.uiDna.pinnedWithheldAfterRevocation) {
  throw new Error("UI-DNA ordinary reads served revoked A");
}
if (auth.sourceOfTruth.latestRevokedCode !== "not_found" || auth.sourceOfTruth.pinnedRevokedCode !== "not_found") {
  throw new Error("Source of Truth served or mis-classified revoked A");
}
if (!auth.sourceOfTruth.pinnedNonEnumerating) throw new Error("revoked pinned read is distinguishable from missing");
if (auth.sourceOfTruth.staleFallbackRejectedCode !== "dependency_unavailable") {
  throw new Error("stale fallback served without authority evidence");
}
if (auth.sourceOfTruth.monotonicRegression !== "sequence_regression") {
  throw new Error("a delayed pre-revocation receipt resurrected A");
}
if (auth.sourceOfTruth.privilegedAuditStatus !== "revoked") throw new Error("privileged audit did not disclose revocation");
if (auth.sourceOfTruth.latestAfterApproveB !== versionB) throw new Error("Source of Truth latest did not advance to B");
if (!auth.consultant.refused || auth.consultant.refusalReason !== "genome_revoked" || !auth.consultant.refusalNamesVersion) {
  throw new Error("consultant generated work grounded on revoked A");
}
if (!auth.consultant.replayRefused) throw new Error("a replayed effective receipt reopened the consultant gate");
if (!auth.consultant.effectiveBGenerated) throw new Error("consultant refused effective B");
if (auth.judgmentEngine.revokedFlooredGrade !== "needs_work" || auth.judgmentEngine.revokedBlockingEnabled !== false) {
  throw new Error("Judgment Engine kept blocking authority on revoked A");
}
if (!auth.judgmentEngine.revokedNoteNamesVersion) throw new Error("advisory note does not name the withdrawn version");
if (auth.judgmentEngine.effectiveUnchangedGrade !== "blocked") throw new Error("effective B lost blocking authority");
if (auth.judgmentEngine.unknownFlooredGrade !== "needs_work") throw new Error("unknown authority kept blocking");
if (auth.judgmentEngine.versionStampB !== versionB) throw new Error("critique version stamp for B drifted");
if (!auth.recovery.distinctFromA || !auth.recovery.uiDnaLatestResolvesB) throw new Error("recovery to B failed");

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
