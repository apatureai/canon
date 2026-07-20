/**
 * Drift comment renderer — the human-readable PR comment for the design-system
 * drift gate (PRD §4/§9), the drift-axis sibling of the rendered-review comment.
 * The drift gate node produces an agent-actionable remediation plan; this renders
 * the same result as deterministic Markdown a reviewer reads: the verdict, the
 * drift THIS change introduced (each headlined by the design token it broke), and
 * the counts. Pre-existing drift is not gated and is only counted.
 *
 * Every token headline names the exact `group.name` — un-arguable, the drift
 * axis's version of D1 ("which of your tokens it broke"), never prose. Pure and
 * deterministic; no I/O — the delivery surface posts the string.
 */

import type { DriftGateNodeResult, DriftGateVerdictDecision } from "./drift-gate-node.js";
import type { DriftRemediation } from "./drift-remediation.js";

const VERDICT_HEADING: Record<DriftGateVerdictDecision, string> = {
  block: "🚫 Design-system drift: changes requested",
  warn: "⚠️ Design-system drift: warnings",
  pass: "✅ Design-system drift: passed",
};

const KIND_MARK = {
  value_mismatch: "🔴 off-token",
  missing_in_code: "🟠 unused token",
  undocumented_in_design: "🟠 unsanctioned",
} as const;

function renderEntry(r: DriftRemediation): string {
  return `- ${KIND_MARK[r.kind]} — \`${r.group}.${r.name}\`: ${r.instruction}`;
}

/**
 * Render the drift gate node result as a PR review comment (Markdown). Blocking
 * drift leads (each token-headlined), then advisory. Deterministic.
 */
export function renderDriftComment(result: DriftGateNodeResult): string {
  const { verdict, remediation, introducedCount, persistingCount, resolvedCount } = result;
  const lines: string[] = [`## ${VERDICT_HEADING[verdict]}`, ""];
  lines.push(
    `**${introducedCount}** introduced (${remediation.blocking.length} blocking, ${remediation.advisory.length} advisory) · ` +
      `${persistingCount} pre-existing · ${resolvedCount} resolved`,
    "",
  );

  if (remediation.blocking.length > 0) {
    lines.push("### Introduced — must fix");
    for (const r of remediation.blocking) lines.push(renderEntry(r));
    lines.push("");
  }
  if (remediation.advisory.length > 0) {
    lines.push("### Introduced — advisory");
    for (const r of remediation.advisory) lines.push(renderEntry(r));
    lines.push("");
  }
  if (persistingCount > 0) {
    lines.push(`_${persistingCount} pre-existing drift(s) not introduced by this change — not gated._`, "");
  }
  if (resolvedCount > 0) lines.push(`✓ Resolved **${resolvedCount}** drift(s).`, "");

  return lines.join("\n").trimEnd() + "\n";
}
