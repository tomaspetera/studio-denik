import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { listLeads } from "@/lib/leads";
import LeadBoard from "./LeadBoard";

export const dynamic = "force-dynamic";

export default async function PoptavkyPage({
  searchParams,
}: {
  // Přichází z globálního hledání — rovnou odskroluje na konkrétní poptávku.
  searchParams: Promise<{ otevrit?: string }>;
}) {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const [leads, { otevrit }] = await Promise.all([listLeads(ws.orgId), searchParams]);

  return <LeadBoard leads={leads} highlightId={otevrit} />;
}
