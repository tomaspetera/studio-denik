import { getWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { KIND_LABEL, BALL_LABEL, SIZE_LABEL, dateKeyPrague, dateKeyUTC, todayKeyPrague, type Ball, type TaskKind } from "@/lib/domain";
import { csvDate, toCsv } from "@/lib/csv";
import { loadPlans } from "@/lib/week-data";

/**
 * Záloha dat — úkoly nebo klienti jako soubor pro Excel (`?co=ukoly|klienti`).
 *
 * Stahuje přihlášený člověk a dostane jen data svého studia: čte se stejnou
 * cestou jako zbytek appky (práva v databázi), žádný servisní klíč. Soubor se
 * nikam neukládá ani neposílá — odejde jen jako odpověď prohlížeči.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ws = await getWorkspace();
  if (!ws) return new Response("Nepřihlášený uživatel.", { status: 401 });
  if (ws.state !== "ready") return new Response("Pracovní prostor není připravený.", { status: 409 });

  const co = new URL(request.url).searchParams.get("co");
  const supabase = await supabaseServer();
  const dnes = todayKeyPrague();

  if (co === "klienti") {
    const { data, error } = await supabase
      .from("clients")
      .select("name, contact, email, ico, dic, address, relationship, note, next_step, next_step_at, is_priority, archived")
      .eq("org_id", ws.orgId)
      .order("name");
    if (error) return new Response(error.message, { status: 500 });

    const csv = toCsv(
      ["Klient", "Kontakt", "E-mail", "IČO", "DIČ", "Adresa", "Vztah", "Poznámka", "Další krok", "Další krok kdy", "Hlavní", "V archivu"],
      (data ?? []).map((c) => [
        c.name as string,
        c.contact as string | null,
        c.email as string | null,
        c.ico as string | null,
        c.dic as string | null,
        c.address as string | null,
        c.relationship as string | null,
        c.note as string | null,
        c.next_step as string | null,
        csvDate(c.next_step_at as string | null),
        Boolean(c.is_priority),
        Boolean(c.archived),
      ]),
    );
    return soubor(csv, `studio-denik-klienti-${dnes}.csv`);
  }

  if (co === "ukoly") {
    const [{ data, error }, plany] = await Promise.all([
      supabase
        .from("tasks_view")
        .select("id, title, kind, step_name, ball, is_late, size, due_at, client_name, supplier_name, note, created_at, closed_at")
        .eq("org_id", ws.orgId)
        .order("created_at", { ascending: false }),
      loadPlans(ws.orgId),
    ]);
    if (error) return new Response(error.message, { status: 500 });

    const csv = toCsv(
      ["Úkol", "Klient", "Typ", "Krok", "U koho leží", "Po termínu", "Termín", "V plánu na", "Velikost", "Dodavatel", "Založeno", "Uzavřeno", "Poznámka"],
      (data ?? []).map((t) => [
        t.title as string,
        t.client_name as string | null,
        KIND_LABEL[t.kind as TaskKind],
        t.step_name as string,
        BALL_LABEL[t.ball as Ball],
        Boolean(t.is_late),
        // Termín je den zadaný jako půlnoc UTC; založení a uzavření jsou okamžiky — ty podle Prahy.
        csvDate(t.due_at ? dateKeyUTC(t.due_at as string) : null),
        csvDate(plany.get(t.id as string) ?? null),
        SIZE_LABEL[t.size as number] ?? "",
        t.supplier_name as string | null,
        csvDate(t.created_at ? dateKeyPrague(t.created_at as string) : null),
        csvDate(t.closed_at ? dateKeyPrague(t.closed_at as string) : null),
        t.note as string | null,
      ]),
    );
    return soubor(csv, `studio-denik-ukoly-${dnes}.csv`);
  }

  return new Response("Neznámá záloha — použij ?co=ukoly nebo ?co=klienti.", { status: 400 });
}

function soubor(csv: string, jmeno: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${jmeno}"`,
      // Záloha obsahuje data studia — nesmí zůstat v žádné mezipaměti.
      "Cache-Control": "no-store",
    },
  });
}
