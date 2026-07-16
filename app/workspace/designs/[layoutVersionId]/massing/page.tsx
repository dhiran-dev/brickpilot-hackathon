import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { MassingWorkspace } from "@/components/massing";
import { auth } from "@/lib/auth";

export default async function MassingPage({ params }: { params: Promise<{ layoutVersionId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const { layoutVersionId } = await params;
  return <MassingWorkspace layoutVersionId={layoutVersionId} userName={session.user.name} />;
}
