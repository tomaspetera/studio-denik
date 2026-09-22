import { redirect } from "next/navigation";
import { getWorkspace, siteUrl } from "@/lib/workspace";
import { listClientsWithStats } from "@/lib/clients";
import { listAllClientContacts } from "@/lib/client-contacts";
import ClientBoard from "./ClientBoard";

export const dynamic = "force-dynamic";

export default async function KlientiPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const [clients, contactsByClient] = await Promise.all([
    listClientsWithStats(ws.orgId),
    listAllClientContacts(ws.orgId),
  ]);

  return <ClientBoard clients={clients} contactsByClient={contactsByClient} siteUrl={siteUrl()} />;
}
