import { requireUser } from "@/lib/auth";
import { Wizard } from "@/components/Wizard";
import { BookFields, EditingFields, StyleFields } from "@/components/ProjectFields";
import { createProjectAction } from "../../actions";

export default async function NewProject() {
  const user = await requireUser();
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="font-serif text-3xl">New book project</h1>
      <p className="mt-1 mb-6 muted">Tell us about your book. Everything here can be changed later.</p>
      <Wizard action={createProjectAction} steps={[
        { title: "Your book", content: <BookFields d={{ authorName: user.name }} /> },
        { title: "Editing", content: <EditingFields d={{}} /> },
        { title: "Style preferences", content: <><p className="mb-4 text-sm muted">These become your manuscript's style sheet. The editor follows it in every chapter.</p><StyleFields s={{}} /></> },
      ]} />
    </main>
  );
}
