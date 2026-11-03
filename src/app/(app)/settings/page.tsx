import { requireUser } from "@/lib/auth";
import { providerInfo } from "@/lib/ai";
import { ActionForm } from "@/components/ActionForm";
import { updateAccountAction } from "../actions";

export default async function Settings() {
  const user = await requireUser();
  const info = providerInfo();
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="font-serif text-3xl">Settings</h1>
      <ActionForm action={updateAccountAction} submit="Save" className="card mt-6 space-y-4 p-5">
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input id="name" name="name" className="input" defaultValue={user.name} />
        </div>
        {user.aiConsentAt && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="revokeConsent" /> Withdraw permission to send manuscripts to the AI provider (given {user.aiConsentAt.toLocaleDateString()})</label>
        )}
      </ActionForm>
      <section className="card mt-6 p-5 text-sm">
        <h2 className="text-lg font-semibold">AI and your manuscripts</h2>
        <p className="mt-2">Editing provider: <strong>{info.label}</strong>{info.external ? <> (model <code>{info.model}</code>)</> : null}.</p>
        <p className="mt-2 muted">
          {info.external
            ? "When you start an editing pass, the text of the chapters being edited is sent to Anthropic's API. Anthropic does not train models on API data by default. Nothing is sent until you start a pass, and your files stay in this app's private storage."
            : "No AI key is configured, so only automatic mechanical checks run, entirely on this server."}
        </p>
        <p className="mt-2 muted">You keep full ownership of your work. Edits are only suggestions until you approve them.</p>
        <p className="mt-4"><a className="hover:underline" href="/api/account/export">Download all my data (JSON)</a></p>
      </section>
    </main>
  );
}
