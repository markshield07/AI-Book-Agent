"use client";
import { useActionState, useEffect, useState } from "react";
import type { ActionState } from "@/app/(app)/actions";

/** Form bound to a server action, with inline status and an optional two-step confirmation. */
export function ActionForm({
  action, children, submit, submitClass = "btn-primary", className, confirm,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children?: React.ReactNode;
  submit: string;
  submitClass?: string;
  className?: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [asking, setAsking] = useState(false);
  // Close the confirmation once the action has finished.
  useEffect(() => { if (state) setAsking(false); }, [state]);
  return (
    <form action={formAction} className={className}>
      {children}
      {confirm && asking ? (
        <span className="inline-flex flex-wrap items-center gap-2 text-sm">
          <span>{confirm}</span>
          <button key="yes" type="submit" className={submitClass} disabled={pending}>{pending ? "Working…" : "Yes, continue"}</button>
          <button type="button" className="btn-ghost" onClick={() => setAsking(false)}>Cancel</button>
        </span>
      ) : (
        <button
          key="main"
          type={confirm ? "button" : "submit"}
          className={submitClass}
          disabled={pending}
          onClick={confirm ? () => setAsking(true) : undefined}
        >
          {pending ? "Working…" : submit}
        </button>
      )}
      {state?.error && <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>}
      {state?.message && <p role="status" className="mt-2 text-sm text-emerald-800">{state.message}</p>}
    </form>
  );
}
