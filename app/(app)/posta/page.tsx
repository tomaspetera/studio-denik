import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { isGmailConfigured, isMailAiAvailable, listIgnored, listMail, loadMailAccount, loadSignature } from "@/lib/mail-data";
import { listCategories, listClients } from "@/lib/tasks";
import { csDateFromKey, dateKeyPrague, todayKeyPrague } from "@/lib/domain";
import MailBoard from "./MailBoard";

export const dynamic = "force-dynamic";
// Obnovení tahá vlákna z Gmailu jedno po druhém, což chvíli trvá. Platí i pro
// návrh úkolu z e-mailu: načtení zprávy a až dva pokusy u AI po deseti vteřinách
// — s přílohami po dvaadvaceti, plus jejich stažení z Gmailu.
export const maxDuration = 60;

export default async function PostaPage({
  searchParams,
}: {
  // Přichází z návratu od Googlu: `pripojeno=1`, nebo `chyba=…`.
  searchParams: Promise<{ pripojeno?: string; chyba?: string }>;
}) {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/prihlaseni");

  const [ucet, { pripojeno, chyba }] = await Promise.all([loadMailAccount(user.id), searchParams]);
  // Klienti a kategorie jsou potřeba v okně s návrhem úkolu z e-mailu.
  const [zpravy, ignorovani, klienti, kategorie, podpis] = ucet
    ? await Promise.all([
        listMail(user.id),
        listIgnored(user.id),
        listClients(ws.orgId),
        listCategories(ws.orgId),
        loadSignature(user.id),
      ])
    : [[], [], [], [], null];

  return (
    <MailBoard
      configured={isGmailConfigured()}
      account={ucet}
      messages={zpravy}
      ignored={ignorovani}
      justConnected={pripojeno === "1"}
      error={chyba ?? null}
      aiAvailable={isMailAiAvailable()}
      // Datum se skládá tady, podle Prahy — v prohlížeči by se kolem půlnoci
      // mohlo lišit od toho, co vykreslil server.
      aiSince={ucet?.aiConsentAt ? csDateFromKey(dateKeyPrague(ucet.aiConsentAt)) : null}
      signature={podpis}
      clients={klienti}
      categories={kategorie}
      today={todayKeyPrague()}
    />
  );
}
