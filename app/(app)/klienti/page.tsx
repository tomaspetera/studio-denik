import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { listClientsWithStats } from "@/lib/clients";
import ClientBoard from "./ClientBoard";

export const dynamic = "force-dynamic";

export default async function KlientiPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const clients = await listClientsWithStats(ws.orgId);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  return <ClientBoard clients={clients} siteUrl={siteUrl} />;
}
