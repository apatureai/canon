import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isApproved, type DnaSnapshot } from "@apatureai/canon-schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_OK } from "../src/index.js";
import { runCapture } from "./helpers.js";

/**
 * The publish path end to end: `context --out` -> `approve --out` ->
 * `export --target`. This is the transcript the README QUICKSTART walks and the
 * seam the two downstream consumers (Verdict, Lattice) read canon through, so it
 * is exercised through the same `runCli` entry point the terminal uses.
 */
describe("ui-dna approve + export", () => {
  let work: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "ui-dna-publish-"));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  async function draftGenome(): Promise<string> {
    const out = join(work, "genome.json");
    const result = await runCapture(["context", "examples/sample-project", "--repo", "apatureai/canon", "--out", out]);
    expect(result.code).toBe(EXIT_OK);
    return out;
  }

  async function approvedGenome(): Promise<string> {
    const genome = await draftGenome();
    const out = join(work, "approved.json");
    const result = await runCapture(["approve", genome, "--out", out]);
    expect(result.code).toBe(EXIT_OK);
    return out;
  }

  it("promotes a draft genome to an approved, version-stamped snapshot", async () => {
    const approvedPath = await approvedGenome();
    const snapshot = JSON.parse(readFileSync(approvedPath, "utf8")) as DnaSnapshot;
    expect(isApproved(snapshot)).toBe(true);
    // The content-addressed dnaVersion is a 64-char sha256 hex, not the draft "0".
    expect(snapshot.metadata.dnaVersion).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to approve an already-approved genome (a new genome is a new version)", async () => {
    const approvedPath = await approvedGenome();
    const result = await runCapture(["approve", approvedPath]);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain("already approved");
  });

  it("projects an approved genome into Verdict's contract", async () => {
    const approvedPath = await approvedGenome();
    const out = join(work, "verdict.json");
    const result = await runCapture(["export", approvedPath, "--target", "verdict", "--out", out]);
    expect(result.code).toBe(EXIT_OK);
    const profile = JSON.parse(readFileSync(out, "utf8"));
    expect(profile.snapshot.approval_state).toBe("approved");
    expect(profile.snapshot.dna_version).toMatch(/^[0-9a-f]{64}$/);
    expect(profile.snapshot.items.length).toBeGreaterThan(0);
    for (const item of profile.snapshot.items) {
      expect(item).toMatchObject({ field_id: expect.any(String), kind: expect.any(String), value: expect.any(String) });
    }
    // The brand token the sample project resolves is carried through as a color rule.
    expect(profile.snapshot.items).toContainEqual(
      expect.objectContaining({ field_id: "tokens.color.--color-brand", kind: "color", value: "#2f6fed" }),
    );
  });

  it("projects an approved genome into Lattice's contract", async () => {
    const approvedPath = await approvedGenome();
    const out = join(work, "lattice.json");
    const result = await runCapture(["export", approvedPath, "--target", "lattice", "--out", out]);
    expect(result.code).toBe(EXIT_OK);
    const profile = JSON.parse(readFileSync(out, "utf8"));
    expect(profile.projectionSchemaVersion).toBe("1");
    expect(profile.state).toBe("approved");
    expect(profile.dnaContentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(profile.tokens["tokens.color.--color-brand"]).toMatchObject({
      value: "#2f6fed",
      category: "color",
      confidence: expect.any(Number),
    });
  });

  it("projects an approved genome into Pointer's contract", async () => {
    const approvedPath = await approvedGenome();
    const out = join(work, "pointer.json");
    const result = await runCapture(["export", approvedPath, "--target", "pointer", "--out", out]);
    expect(result.code).toBe(EXIT_OK);
    const profile = JSON.parse(readFileSync(out, "utf8"));
    expect(profile.profileVersion).toBe("1");
    expect(profile.compactIndexes.colorTokens.length).toBeGreaterThan(0);
  });

  it("refuses to export a draft genome (only approved DNA projects downstream)", async () => {
    const genome = await draftGenome();
    const result = await runCapture(["export", genome, "--target", "verdict"]);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain("only from approved UI DNA");
  });

  it("requires --target on export and rejects an unknown consumer", async () => {
    const approvedPath = await approvedGenome();
    const missing = await runCapture(["export", approvedPath]);
    expect(missing.code).toBe(EXIT_ERROR);
    expect(missing.stderr).toContain("--target");

    const unknown = await runCapture(["export", approvedPath, "--target", "nope"]);
    expect(unknown.code).toBe(EXIT_ERROR);
    expect(unknown.stderr).toContain('unknown --target "nope"');
  });

  it("reports a clear error when the genome file cannot be read", async () => {
    const result = await runCapture(["approve", join(work, "does-not-exist.json")]);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain("cannot read");
  });

  it("writes to stdout when --out is omitted", async () => {
    const approvedPath = await approvedGenome();
    const result = await runCapture(["export", approvedPath, "--target", "lattice"]);
    expect(result.code).toBe(EXIT_OK);
    const profile = JSON.parse(result.stdout);
    expect(profile.projectionSchemaVersion).toBe("1");
  });
});
