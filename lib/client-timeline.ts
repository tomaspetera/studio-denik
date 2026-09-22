import "server-only";

import { supabaseServer } from "./supabase/server";

/**
 * Časová osa klienta — poskládaná ze tří zdrojů, které jinak žijí každý
 * jinde: ruční poznámky, uzavřené úkoly a to, co klient sám udělal přes
 * svůj schvalovací odkaz (viz migrace 0007, `client_decide`). Skládá se
 * v TypeScriptu, ne v SQL — je to čtení jen pro přihlášeného člověka, takže
 * tu není potřeba bezpečnostní obal jako u veřejného kalendářního kanálu,
 * a tři zdroje se snáz upravují v JS než v jednom velkém SQL dotazu.
 */
export type TimelineEntry = {
  id: string;
  kind: "note" | "closed" | "client_approved" | "client_changes";
  at: string;
  /** `null` u ruční poznámky — ta na žádný úkol vázaná není. */
  taskId: string | null;
  /** Jen u ruční poznámky (`kind: "note"`) — potřeba pro úpravu/smazání. */
  noteId: string | null;
  title: string;
  detail: string | null;
  authorInitials: string | null;
};

export async function listClientTimeline(clientId: string): Promise<TimelineEntry[]> {
  const supabase = await supabaseServer();

  const [{ data: notes }, { data: tasks }] = await Promise.all([
    supabase
      .from("client_notes_view")
      .select("id, body, created_at, created_by_initials")
      .eq("client_id", clientId),
    supabase
      .from("tasks_view")
      .select("id, title, ball, closed_at, updated_at")
      .eq("client_id", clientId),
  ]);

  type TaskRow = { id: string; title: string; ball: string; closed_at: string | null; updated_at: string };
  type NoteRow = { id: string; body: string; created_at: string; created_by_initials: string | null };

  const taskRows = (tasks ?? []) as unknown as TaskRow[];
  const taskIds = taskRows.map((t) => t.id);
  const taskById = new Map(taskRows.map((t) => [t.id, t]));

  const { data: events } = taskIds.length
    ? await supabase
        .from("task_events")
        .select("task_id, kind, detail, at")
        .in("task_id", taskIds)
        .in("kind", ["client_approved", "client_changes"])
    : { data: [] as { task_id: string; kind: string; detail: string | null; at: string }[] };

  const entries: TimelineEntry[] = [];

  for (const n of (notes ?? []) as NoteRow[]) {
    entries.push({
      id: `note-${n.id}`,
      kind: "note",
      at: n.created_at,
      taskId: null,
      noteId: n.id,
      title: n.body,
      detail: null,
      authorInitials: n.created_by_initials,
    });
  }

  for (const t of taskRows) {
    // `closed_at` chybí u úkolu založeného rovnou jako hotový (razítko dává
    // spouštěč jen při úpravě — stejná mezera, kterou řešila migrace 0008
    // pro schvalovací stránku). `updated_at` jako záloha, ať uzavřený úkol
    // z osy tiše nezmizí.
    if (t.ball === "done") {
      entries.push({
        id: `closed-${t.id}`,
        kind: "closed",
        at: t.closed_at ?? t.updated_at,
        taskId: t.id,
        noteId: null,
        title: t.title,
        detail: null,
        authorInitials: null,
      });
    }
  }

  for (const e of events ?? []) {
    entries.push({
      id: `event-${e.task_id}-${e.at}`,
      kind: e.kind as "client_approved" | "client_changes",
      at: e.at,
      taskId: e.task_id,
      noteId: null,
      title: taskById.get(e.task_id)?.title ?? "Úkol",
      // `client_decide` (migrace 0007) sem zapisuje buď text klientovy
      // připomínky, nebo "Schváleno klientem <jméno>" — obojí je čitelná
      // věta, žádné další formátování netřeba.
      detail: e.detail,
      authorInitials: null,
    });
  }

  entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return entries;
}
