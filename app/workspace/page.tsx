import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { DesignWorkspace } from "@/components/design-workspace";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ design?: string; step?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { design, step } = await searchParams;
  const existingProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.ownerId, session.user.id))
    .limit(1);

  return <DesignWorkspace hasProjects={existingProjects.length > 0} initialDesignId={design ?? null} initialStep={step ?? null} userName={session.user.name} />;
}
