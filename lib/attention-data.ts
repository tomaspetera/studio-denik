import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysKey, dateKeyUTC, todayKeyPrague, type DateKey, type LeadStatus } from "./domain";
import { computeAttention, type AttentionItem } from "./attention";

/**
 * Načte, co chce pozornost, pro jednu organizaci.
 *
 * Klienta dostává zvenku, protože ho potřebují dvě různá místa: Dnes (jede
 * pod přihlášeným člověkem, přístupová práva hlídá databáze) a ranní cron
 * (žádný přihlášený člověk neexistuje, jede servisním klíčem). Logika je
 * stejná, jen jiné oprávnění.
 *
 * "Poslední aktivita" klienta je stejná sada událostí, jaká se ukazuje
 * v jeho historii: poznámky, uzavřené úkoly a rozhodnutí klienta přes
 * schvalovací odkaz — plus den založení, aby čerstvě přidaný klient
 * nevypadal jako dávno zapomenutý.
 */
export async function loadAttention(
  supabase: SupabaseClient,
  orgId: string,
  today: DateKey = todayKeyPrague(),
): Promise<{ items: AttentionItem[]; silenceDays: number; today: DateKey }> {
  const [{ data: org }, { data: clients }, { data: leads }, { data: tasks }, { data: notes }, { data: events }] =
    await Promise.all([
      supabase.from("orgs").select("silence_days").eq("id", orgId).single(),
      supabase
        .from("clients")
        .select("id, name, archived, next_step, next_step_at, created_at")
        .eq("org_id", orgId),
      supabase
        .from("leads")
        .select("id, name, company, status, next_step, next_step_at, created_at")
        .eq("org_id", orgId),
      supabase.from("tasks_view").select("client_id, ball, closed_at, updated_at").eq("org_id", orgId),
      supabase.from("client_notes").select("client_id, created_at").eq("org_id", orgId),
      supabase
        .from("task_events")
        .select("task_id, at")
        .eq("org_id", orgId)
        .in("kind", ["client_approved", "client_changes"]),
    ]);

  const silenceDays = Number(org?.silence_days ?? 14);

  type TaskRow = { client_id: string | null; ball: string; closed_at: string | null; updated_at: string };
  const taskRows = (tasks ?? []) as TaskRow[];

  // Událost schválení je navázaná na úkol, ne na klienta — klienta se k ní
  // dohledává přes úkol. Načítá se jen `id` úkolu, proto druhý dotaz.
  const { data: eventTasks } = (events ?? []).length
    ? await supabase
        .from("tasks")
        .select("id, client_id")
        .eq("org_id", orgId)
        .in("id", [...new Set((events ?? []).map((e) => e.task_id as string))])
    : { data: [] as { id: string; client_id: string | null }[] };
  const clientByTask = new Map((eventTasks ?? []).map((t) => [t.id as string, t.client_id as string | null]));

  const lastByClient = new Map<string, DateKey>();
  const bump = (clientId: string | null | undefined, instant: string | null | undefined) => {
    if (!clientId || !instant) return;
    const key = dateKeyUTC(instant);
    const prev = lastByClient.get(clientId);
    if (!prev || key > prev) lastByClient.set(clientId, key);
  };

  for (const c of clients ?? []) bump(c.id as string, c.created_at as string);
  for (const n of notes ?? []) bump(n.client_id as string, n.created_at as string);
  for (const t of taskRows) {
    // `closed_at` chybí u úkolu založeného rovnou jako hotový — `updated_at`
    // jako záloha, stejně jako v časové ose klienta.
    if (t.ball === "done") bump(t.client_id, t.closed_at ?? t.updated_at);
  }
  for (const e of events ?? []) bump(clientByTask.get(e.task_id as string), e.at as string);

  const openByClient = new Set(
    taskRows.filter((t) => t.ball !== "done" && t.client_id).map((t) => t.client_id as string),
  );

  const items = computeAttention({
    today,
    silentOnOrBefore: addDaysKey(today, -silenceDays),
    clients: (clients ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      archived: Boolean(c.archived),
      nextStep: (c.next_step as string | null) ?? null,
      nextStepAt: (c.next_step_at as string | null) ?? null,
      hasOpenTasks: openByClient.has(c.id as string),
      lastActivity: lastByClient.get(c.id as string) ?? dateKeyUTC(c.created_at as string),
    })),
    leads: (leads ?? []).map((l) => ({
      id: l.id as string,
      name: l.name as string,
      company: (l.company as string | null) ?? null,
      status: l.status as LeadStatus,
      nextStep: (l.next_step as string | null) ?? null,
      nextStepAt: (l.next_step_at as string | null) ?? null,
      createdAt: dateKeyUTC(l.created_at as string),
    })),
  });

  return { items, silenceDays, today };
}
