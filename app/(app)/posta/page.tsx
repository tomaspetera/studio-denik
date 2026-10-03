import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { isGmailConfigured, listIgnored, listMail, loadMailAccount } from "@/lib/mail-data";
import MailBoard from "./MailBoard";

export const dynamic = "force-dynamic";
// Obnovení tahá vlákna z Gmailu jedno po druhém, což chvíli trvá.
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
  const [zpravy, ignorovani] = ucet
    ? await Promise.all([listMail(user.id), listIgnored(user.id)])
    : [[], []];

  return (
    <MailBoard
      configured={isGmailConfigured()}
      account={ucet}
      messages={zpravy}
      ignored={ignorovani}
      justConnected={pripojeno === "1"}
      error={chyba ?? null}
    />
  );
}
