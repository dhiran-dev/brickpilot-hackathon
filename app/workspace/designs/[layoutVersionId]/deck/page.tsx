import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { DeckViewer } from "@/components/deck/DeckViewer";
import { auth } from "@/lib/auth";

export default async function DeckPage({ params }: { params: Promise<{ layoutVersionId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const { layoutVersionId } = await params;
  return <DeckViewer layoutVersionId={layoutVersionId} />;
}
