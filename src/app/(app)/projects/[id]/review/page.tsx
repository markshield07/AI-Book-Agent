import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOwnedProject, NotFoundError } from "@/lib/projects";
import { loadReview } from "@/lib/editor/review";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";
import { ProjectHeader } from "@/components/ProjectHeader";

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ chapter?: string }> }) {
  const { id } = await params;
  const { chapter } = await searchParams;
  const user = await requireUser();
  const project = await getOwnedProject(id, user.id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const data = await loadReview(id, chapter);
  return (
    <div className="flex h-screen flex-col">
      <div className="px-6 pt-6"><ProjectHeader project={project} tab="review" /></div>
      <ReviewWorkspace projectId={id} initial={data} />
    </div>
  );
}
