import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { listLeads } from "@/lib/leads";
import LeadBoard from "./LeadBoard";

export const dynamic = "force-dynamic";

export default async function PoptavkyPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const leads = await listLeads(ws.orgId);

  return <LeadBoard leads={leads} />;
}
