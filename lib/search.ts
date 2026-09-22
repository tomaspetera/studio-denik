import "server-only";

import { supabaseServer } from "./supabase/server";

/**
 * Globální hledání napříč úkoly, klienty a poptávkami.
 *
 * Organizace je malá (desítky úkolů, jednotky klientů) — stejně jako
 * zbytek appky proto načte všechno a hledá v JS, ne přes `ilike`/`or`
 * v SQL. Vyhne se to i ručnímu escapování textu hledání uvnitř PostgREST
 * filtrovacího řetězce, což by jinak byl zbytečný zdroj chyb.
 */
export type SearchResult = {
  id: string;
  kind: "task" | "client" | "lead";
  title: string;
  subtitle: string | null;
  href: string;
};

const KIND_LIMIT = 6;

export async function globalSearch(orgId: string, query: string): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const supabase = await supabaseServer();

  const [{ data: tasks }, { data: clients }, { data: leads }] = await Promise.all([
    supabase
      .from("tasks_view")
      .select("id, title, client_name, step_name")
      .eq("org_id", orgId),
    supabase
      .from("clients")
      .select("id, name, ico")
      .eq("org_id", orgId)
      .eq("archived", false),
    supabase
      .from("leads")
      .select("id, name, company")
      .eq("org_id", orgId),
  ]);

  type TaskRow = { id: string; title: string; client_name: string | null; step_name: string };
  type ClientRow = { id: string; name: string; ico: string | null };
  type LeadRow = { id: string; name: string; company: string | null };

  const results: SearchResult[] = [];

  for (const t of (tasks ?? []) as unknown as TaskRow[]) {
    if (results.filter((r) => r.kind === "task").length >= KIND_LIMIT) break;
    if (t.title.toLowerCase().includes(q) || t.client_name?.toLowerCase().includes(q)) {
      results.push({
        id: t.id,
        kind: "task",
        title: t.title,
        subtitle: [t.client_name, t.step_name].filter(Boolean).join(" · "),
        href: `/ukoly?otevrit=${t.id}`,
      });
    }
  }

  for (const c of (clients ?? []) as unknown as ClientRow[]) {
    if (results.filter((r) => r.kind === "client").length >= KIND_LIMIT) break;
    if (c.name.toLowerCase().includes(q) || c.ico?.includes(q)) {
      results.push({
        id: c.id,
        kind: "client",
        title: c.name,
        subtitle: c.ico ? `IČO ${c.ico}` : null,
        href: `/klienti?otevrit=${c.id}`,
      });
    }
  }

  for (const l of (leads ?? []) as unknown as LeadRow[]) {
    if (results.filter((r) => r.kind === "lead").length >= KIND_LIMIT) break;
    if (l.name.toLowerCase().includes(q) || l.company?.toLowerCase().includes(q)) {
      results.push({
        id: l.id,
        kind: "lead",
        title: l.name,
        subtitle: l.company,
        href: `/poptavky?otevrit=${l.id}`,
      });
    }
  }

  return results;
}
