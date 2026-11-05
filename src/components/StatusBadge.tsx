import { STATUS_LABEL } from "@/lib/projects";

const TONE: Record<string, string> = {
  DRAFT: "bg-stone-100 text-stone-700",
  UPLOADED: "bg-sky-50 text-sky-800",
  ANALYZING: "bg-amber-50 text-amber-800",
  EDITING: "bg-amber-50 text-amber-800",
  AWAITING_REVIEW: "bg-violet-50 text-violet-800",
  REVISIONS_REQUESTED: "bg-violet-50 text-violet-800",
  APPROVED: "bg-emerald-50 text-emerald-800",
  FORMATTING: "bg-amber-50 text-amber-800",
  READY: "bg-emerald-50 text-emerald-800",
  EXPORT_FAILED: "bg-red-50 text-red-800",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[status] ?? ""}`}>{STATUS_LABEL[status] ?? status}</span>;
}
