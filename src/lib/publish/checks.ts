// Shared shape for the KDP readiness report.
export type CheckStatus = "passed" | "warning" | "failed" | "not_checked";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface ReadinessReport {
  format: "paperback" | "ebook" | "kindle_docx";
  checkedAt: string;
  checks: ReadinessCheck[];
  summary: Record<CheckStatus, number>;
  /** True when nothing failed. Amazon still makes the final call. */
  ok: boolean;
  officialTools: { label: string; url: string }[];
}

export function summarize(format: ReadinessReport["format"], checks: ReadinessCheck[], officialTools: ReadinessReport["officialTools"]): ReadinessReport {
  const summary = { passed: 0, warning: 0, failed: 0, not_checked: 0 } as Record<CheckStatus, number>;
  for (const c of checks) summary[c.status]++;
  return { format, checkedAt: new Date().toISOString(), checks, summary, ok: summary.failed === 0, officialTools };
}
