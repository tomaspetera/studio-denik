import { redirect } from "next/navigation";
import { getWorkspace, siteUrl } from "@/lib/workspace";
import { listClientsWithStats } from "@/lib/clients";
import { listAllClientContacts } from "@/lib/client-contacts";
import { todayKeyPrague } from "@/lib/domain";
import { loadMoveSuggestions } from "@/lib/brand-data";
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

  const [clients, contactsByClient, { otevrit }, moves] = await Promise.all([
    listClientsWithStats(ws.orgId),
    listAllClientContacts(ws.orgId),
    searchParams,
    // Úkoly, které mají jméno klienta v názvu a patří jinam — jen návrh.
    loadMoveSuggestions(ws.orgId),
  ]);

  return (
    <ClientBoard
      clients={clients}
      contactsByClient={contactsByClient}
      moves={moves}
      siteUrl={siteUrl()}
      today={todayKeyPrague()}
      highlightId={otevrit}
    />
  );
}
