import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { buildInvoice, isMonthKey, type InvoiceInput } from "@/lib/invoice";
import { todayKeyPrague } from "@/lib/domain";
import InvoiceView from "./InvoiceView";

export const dynamic = "force-dynamic";

export default async function FakturacePage({
  searchParams,
}: {
  // `mesic=RRRR-MM`; bez něj tento měsíc.
  searchParams: Promise<{ mesic?: string }>;
}) {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const { mesic } = await searchParams;
  const tento = todayKeyPrague().slice(0, 7);
  const month = isMonthKey(mesic) ? mesic : tento;

  // Uzavřené úkoly kolem zvoleného měsíce: o den víc na obě strany, protože
  // měsíc se počítá podle Prahy a v databázi je čas v UTC. Přesně to pak
  // rozdělí `buildInvoice`.
  const [y, m] = month.split("-").map(Number);
  const od = new Date(Date.UTC(y, m - 1, 1) - 86_400_000).toISOString();
  const po = new Date(Date.UTC(y, m, 1) + 86_400_000).toISOString();

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("tasks_view")
    .select("id, title, client_id, client_name, client_color, closed_at, size")
    .eq("org_id", ws.orgId)
    .gte("closed_at", od)
    .lt("closed_at", po);
  if (error) throw new Error(error.message);

  return <InvoiceView basis={buildInvoice((data ?? []) as unknown as InvoiceInput[], month)} isCurrent={month === tento} />;
}
