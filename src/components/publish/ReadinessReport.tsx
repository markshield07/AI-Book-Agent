// KDP readiness report: Passed / Warning / Failed / Not checked, plus links to Amazon's tools.
import type { ReadinessReport as Report, CheckStatus } from "@/lib/publish/checks";

const STYLE: Record<CheckStatus, { label: string; cls: string; icon: string }> = {
  failed: { label: "Failed", cls: "bg-red-50 text-red-800 border-red-200", icon: "✕" },
  warning: { label: "Warning", cls: "bg-amber-50 text-amber-900 border-amber-200", icon: "!" },
  passed: { label: "Passed", cls: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: "✓" },
  not_checked: { label: "Not checked", cls: "bg-stone-50 text-stone-700 border-stone-200", icon: "–" },
};
const ORDER: CheckStatus[] = ["failed", "warning", "passed", "not_checked"];

export function ReadinessReport({ report }: { report: Report }) {
  const checks = [...report.checks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  return (
    <div>
      <div className="flex flex-wrap gap-2 text-xs">
        {ORDER.map((s) => (
          <span key={s} className={`rounded border px-2 py-0.5 ${STYLE[s].cls}`}>{report.summary[s]} {STYLE[s].label.toLowerCase()}</span>
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {checks.map((c) => (
          <li key={c.id} className="flex gap-2">
            <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${STYLE[c.status].cls}`} aria-label={STYLE[c.status].label}>{STYLE[c.status].icon}</span>
            <span><span className="font-medium">{c.label}.</span> <span className="muted">{c.detail}</span></span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs muted">
        Passing these checks doesn&apos;t guarantee Amazon will accept the file. Always do a final check with Amazon&apos;s own tools:{" "}
        {report.officialTools.map((t, i) => (
          <span key={t.url}>{i ? " · " : ""}<a href={t.url} target="_blank" rel="noopener noreferrer" className="underline">{t.label}</a></span>
        ))}
      </p>
    </div>
  );
}
