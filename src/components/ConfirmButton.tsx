"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";

/** Submit button for a plain server-action form that asks inline before submitting. */
export function ConfirmButton({ label, question, className = "btn-ghost" }: { label: string; question: string; className?: string }) {
  const [asking, setAsking] = useState(false);
  const { pending } = useFormStatus();
  if (!asking) return <button type="button" className={className} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <span>{question}</span>
      <button className="btn-primary" disabled={pending}>{pending ? "Working…" : "Yes"}</button>
      <button type="button" className="btn-ghost" onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
}
