import { and, count, desc, eq, inArray } from "drizzle-orm";
import { AlertTriangle, ArrowRight, Box, Clock3, LayoutDashboard, LoaderCircle, Plus } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { generatedAssets, layoutVersions, projects } from "@/lib/db/schema";
import { deriveProjectStage, type DashboardStage } from "@/lib/design/dashboard-stage";

type DashboardProject = {
  projectId: string;
  title: string;
  createdAt: Date;
  design: { id: string; version: number; status: string; createdAt: Date } | null;
  completedRenderCount: number;
};

const stageBadgeClass: Record<DashboardStage, string> = {
  draft: "border-[#8e5a31]/45 text-[#9f9183]",
  "in-progress": "border-[#c97940]/60 text-[#ff8d49]",
  failed: "border-[#ff5b45]/70 text-[#ff806f]",
  "plan-ready": "border-[#38765a]/60 text-[#7bc79e]",
  rendered: "border-[#38765a]/60 text-[#7bc79e]",
};

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function ProjectCard({ project }: { project: DashboardProject }) {
  const stage = deriveProjectStage({ designStatus: project.design?.status ?? null, completedRenderCount: project.completedRenderCount });
  const canOpen = (stage.stage === "plan-ready" || stage.stage === "rendered") && project.design;
  return (
    <article className="flex flex-col border border-[#8e5a31]/45 bg-[#0d0c0a] p-5 transition hover:border-[#8e5a31]/70">
      <div className="flex items-start justify-between gap-3">
        <span className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[0.58rem] font-bold uppercase tracking-[0.1em] ${stageBadgeClass[stage.stage]}`}>
          {stage.stage === "failed" ? <AlertTriangle className="h-3 w-3" /> : null}
          {stage.stage === "in-progress" ? <LoaderCircle className="h-3 w-3" /> : null}
          {stage.label}
        </span>
        {project.design ? <span className="text-[0.58rem] uppercase tracking-[0.08em] text-[#6f6359]">v{project.design.version}</span> : null}
      </div>
      <h2 className="mt-4 font-[family-name:var(--font-display)] text-2xl leading-tight tracking-[-0.03em] text-[#fff6ea]">{project.title}</h2>
      <p className="mt-2 flex items-center gap-1.5 text-[0.62rem] uppercase tracking-[0.08em] text-[#9f9183]"><Clock3 className="h-3 w-3" /> {formatDate(project.createdAt)}</p>
      <p className="mt-3 text-sm leading-6 text-[#b5a697]">{stage.detail}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
        {canOpen ? <>
          <Link className="inline-flex min-h-10 items-center gap-2 bg-[#ff4e00] px-3 py-2 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-[#090908] transition hover:bg-[#e94500] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea]" href={`/workspace?design=${project.design!.id}`}>
            Open plan <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link className="inline-flex min-h-10 items-center gap-2 border border-[#8e5a31]/65 px-3 py-2 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-[#fff6ea] transition hover:bg-[#171512] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea]" href={`/workspace/designs/${project.design!.id}/massing`}>
            <Box className="h-3.5 w-3.5" /> 3D &amp; renders
          </Link>
        </> : null}
        {stage.stage === "failed" || stage.stage === "draft" ? (
          <Link className="inline-flex min-h-10 items-center gap-2 border border-[#8e5a31]/65 px-3 py-2 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-[#fff6ea] transition hover:bg-[#171512] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea]" href="/workspace">
            {stage.stage === "failed" ? "Start fresh" : "Start project"} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const ownedProjects = await db
    .select({ id: projects.id, title: projects.title, createdAt: projects.createdAt })
    .from(projects)
    .where(eq(projects.ownerId, session.user.id))
    .orderBy(desc(projects.createdAt));

  const projectIds = ownedProjects.map((project) => project.id);
  const versions = projectIds.length === 0 ? [] : await db
    .select({ id: layoutVersions.id, projectId: layoutVersions.projectId, version: layoutVersions.version, status: layoutVersions.status, createdAt: layoutVersions.createdAt })
    .from(layoutVersions)
    .where(inArray(layoutVersions.projectId, projectIds))
    .orderBy(desc(layoutVersions.version));

  const latestByProject = new Map<string, (typeof versions)[number]>();
  for (const version of versions) {
    if (!latestByProject.has(version.projectId)) latestByProject.set(version.projectId, version);
  }

  const latestVersionIds = [...latestByProject.values()].map((version) => version.id);
  const renderCounts = latestVersionIds.length === 0 ? [] : await db
    .select({ layoutVersionId: generatedAssets.layoutVersionId, value: count() })
    .from(generatedAssets)
    .where(and(inArray(generatedAssets.layoutVersionId, latestVersionIds), eq(generatedAssets.type, "render"), eq(generatedAssets.status, "completed")))
    .groupBy(generatedAssets.layoutVersionId);
  const renderCountByVersion = new Map(renderCounts.map((row) => [row.layoutVersionId, row.value]));

  const cards: DashboardProject[] = ownedProjects.map((project) => {
    const design = latestByProject.get(project.id) ?? null;
    return {
      projectId: project.id,
      title: project.title,
      createdAt: project.createdAt,
      design,
      completedRenderCount: design ? renderCountByVersion.get(design.id) ?? 0 : 0,
    };
  });

  return (
    <main className="min-h-screen bg-[#080807] text-[#fff6ea]">
      <div className="mx-auto max-w-[90rem] px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#8e5a31]/55 pb-4">
          <div className="flex items-end gap-4">
            <div>
              <p className="font-[family-name:var(--font-display)] text-3xl leading-none tracking-[-0.04em] text-[#c97940]">BrickPilot</p>
              <p className="mt-1 text-[0.62rem] font-extrabold uppercase tracking-[0.15em] text-[#86796c]">Project dashboard</p>
            </div>
            <span className="hidden border-l border-[#8e5a31]/45 pl-4 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#ff8d49] md:block">Every study, resumable</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-[#95887b] sm:block">Signed in as {session.user.name}</span>
            <Link className="inline-flex items-center gap-2 border border-[#8e5a31]/65 px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.12em] transition hover:bg-[#171512] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea]" href="/workspace">
              <LayoutDashboard className="h-3.5 w-3.5" /> Workspace
            </Link>
            <Link className="inline-flex items-center gap-2 bg-[#ff4e00] px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-[#090908] transition hover:bg-[#e94500] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea]" href="/workspace">
              <Plus className="h-3.5 w-3.5" /> New project
            </Link>
          </div>
        </header>

        <div className="py-6">
          {cards.length === 0 ? (
            <section className="mx-auto grid max-w-2xl place-items-center border border-[#8e5a31]/45 bg-[#0d0c0a] p-10 text-center">
              <div>
                <p className="text-[0.67rem] font-extrabold uppercase tracking-[0.15em] text-[#c97940]">No projects yet</p>
                <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl leading-[0.98] tracking-[-0.04em]">Your drafting table is empty<span className="text-[#ff4e00]">.</span></h1>
                <p className="mt-4 text-base leading-7 text-[#b5a697]">Answer the guided questionnaire and BrickPilot will generate a validated floor plan, cost evidence and 3D massing you can return to here.</p>
                <Link className="mt-6 inline-flex items-center gap-2 bg-[#ff4e00] px-4 py-3 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[#090908] transition hover:bg-[#e94500] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea]" href="/workspace">
                  Start your first project <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </section>
          ) : (
            <section>
              <div className="flex items-center justify-between">
                <h1 className="text-[0.67rem] font-extrabold uppercase tracking-[0.15em] text-[#c97940]">Your projects</h1>
                <span className="text-[0.62rem] uppercase tracking-[0.1em] text-[#9f9183]">{cards.length} saved</span>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {cards.map((project) => <ProjectCard key={project.projectId} project={project} />)}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
