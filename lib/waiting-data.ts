import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";

/**
 * Od kdy úkol leží tam, kde leží, a kdy se naposledy urgovalo — z historie
 * úkolů (`task_events`). Historii zapisuje spouštěč v databázi při každém
 * posunu, takže tu není potřeba žádný nový sloupec.
 */

export type WaitingInfo = {
  /** Kdy úkol přišel na současný krok (ISO); `null`, když v historii nic není. */
  since: string | null;
  /** Kdy se naposledy urgovalo (ISO). */
  nudgedAt: string | null;
};

export type ActionResult = { ok: true } | { ok: false; message: string };

/** Pro úkoly, které čekají u klienta nebo u dodavatele. Jeden dotaz pro všechny. */
export async function loadWaitingInfo(orgId: string, taskIds: string[]): Promise<Map<string, WaitingInfo>> {
  const out = new Map<string, WaitingInfo>();
  if (taskIds.length === 0) return out;

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("task_events")
    .select("task_id, kind, at")
    .eq("org_id", orgId)
    .in("task_id", taskIds)
    .in("kind", ["created", "step", "client_changes", "nudge"])
    .order("at", { ascending: false });

  // Od nejnovější: první posun je ten, kterým se úkol dostal na současný krok.
  for (const e of data ?? []) {
    const id = e.task_id as string;
    const info = out.get(id) ?? { since: null, nudgedAt: null };
    if (e.kind === "nudge") {
      // Urgence platí jen pro současné čekání — starší než poslední posun se nepočítá.
      if (!info.nudgedAt && !info.since) info.nudgedAt = e.at as string;
    } else if (!info.since) {
      info.since = e.at as string;
    }
    out.set(id, info);
  }
  return out;
}

/** Zápis, že se u klienta urgovalo. Nic se neposílá — je to jen poznámka do historie úkolu. */
export async function recordClientNudge(taskId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const [{ data: { user } }, { data: ukol, error }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("tasks").select("org_id, step").eq("id", taskId).single(),
  ]);
  if (error || !ukol) return { ok: false, message: error?.message ?? "Úkol se nenašel." };

  const { error: zapis } = await supabase.from("task_events").insert({
    org_id: ukol.org_id,
    task_id: taskId,
    actor_id: user?.id ?? null,
    kind: "nudge",
    from_step: ukol.step,
    to_step: ukol.step,
    detail: "Urgováno u klienta",
  });
  if (zapis) return { ok: false, message: zapis.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
