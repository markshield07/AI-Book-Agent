"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/app/(app)/actions";

// All steps stay in the DOM (hidden) so the final submit sends every field.
export function Wizard({ steps, action }: { steps: { title: string; content: React.ReactNode }[]; action: (s: ActionState, f: FormData) => Promise<ActionState> }) {
  const [i, setI] = useState(0);
  const [state, formAction, pending] = useActionState(action, undefined);
  const last = i === steps.length - 1;
  return (
    <form action={formAction} className="card p-6">
      <ol className="mb-6 flex gap-4 text-sm">
        {steps.map((s, n) => (
          <li key={s.title} className={n === i ? "font-semibold" : "muted"}>{n + 1}. {s.title}</li>
        ))}
      </ol>
      {steps.map((s, n) => <div key={s.title} hidden={n !== i}>{s.content}</div>)}
      {state?.error && <p role="alert" className="mt-4 text-sm text-red-700">{state.error}</p>}
      <div className="mt-6 flex justify-between">
        <button type="button" className="btn-ghost" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
        {last ? (
          <button key="submit" type="submit" className="btn-accent" disabled={pending}>{pending ? "Creating…" : "Create book project"}</button>
        ) : (
          <button key="continue" type="button" className="btn-primary" onClick={(e) => {
            const form = (e.currentTarget as HTMLButtonElement).form!;
            const invalid = [...form.querySelectorAll<HTMLInputElement>("[required]")].find((el) => el.closest("[hidden]") === null && !el.value.trim());
            if (invalid) { invalid.reportValidity(); return; }
            setI(i + 1);
          }}>Continue</button>
        )}
      </div>
    </form>
  );
}
