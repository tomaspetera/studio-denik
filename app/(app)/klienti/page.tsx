import { redirect } from "next/navigation";
import { getWorkspace, siteUrl } from "@/lib/workspace";
import { listClientsWithStats } from "@/lib/clients";
import { listAllClientContacts } from "@/lib/client-contacts";
import ClientBoard from "./ClientBoard";

export const dynamic = "force-dynamic";

export default async function KlientiPage({
  searchParams,
}: {
  // Přichází z globálního hledání — rovnou odskroluje na konkrétního klienta.
  searchParams: Promise<{ otevrit?: string }>;
}) {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const [clients, contactsByClient, { otevrit }] = await Promise.all([
    listClientsWithStats(ws.orgId),
    listAllClientContacts(ws.orgId),
    searchParams,
  ]);

  return (
    <ClientBoard
      clients={clients}
      contactsByClient={contactsByClient}
      siteUrl={siteUrl()}
      highlightId={otevrit}
    />
  );
}
