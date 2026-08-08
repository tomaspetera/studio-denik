import { redirect } from "next/navigation";
import { getWorkspace, siteUrl } from "@/lib/workspace";
import { listClientsWithStats } from "@/lib/clients";
import ClientBoard from "./ClientBoard";

export const dynamic = "force-dynamic";

export default async function KlientiPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const clients = await listClientsWithStats(ws.orgId);

  return <ClientBoard clients={clients} siteUrl={siteUrl()} />;
}
