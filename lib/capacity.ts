import "server-only";

import { supabaseServer } from "./supabase/server";
import { todayKeyPrague, type DateKey } from "./domain";
import { listAbsences } from "./absences";

/**
 * Kapacita na osobu — bez hodin. Appka je nikdy netrackovala (schválně),
 * takže "kolik práce kdo má" počítá ze stejné veličiny jako report:
 * počet a velikost otevřených úkolů přiřazených té osobě.
 *
 * Číslo je záměrně relativní k týmu (kdo má nejvíc, ten je "plný"), ne
 * absolutní procento z nějaké zadané týdenní kapacity — tu appka nikde
 * nezná a vymýšlet si ji by bylo horší než nic neukazovat.
 */
export type CapacityRow = {
  userId: string;
  openCount: number;
  loadSize: number;
  absentToday: boolean;
  /** Poslední den nepřítomnosti, jen když `absentToday`. */
  absentUntil: DateKey | null;
};

export async function loadCapacity(orgId: string): Promise<CapacityRow[]> {
  const supabase = await supabaseServer();

  const [{ data: tasks }, absences] = await Promise.all([
    supabase.from("tasks_view").select("assignee_id, ball, size").eq("org_id", orgId),
    listAbsences(orgId),
  ]);

  const today = todayKeyPrague();
  const byUser = new Map<string, { openCount: number; loadSize: number }>();

  type TaskRow = { assignee_id: string | null; ball: string; size: number };
  for (const t of (tasks ?? []) as unknown as TaskRow[]) {
    if (!t.assignee_id || t.ball === "done") continue;
    const row = byUser.get(t.assignee_id) ?? { openCount: 0, loadSize: 0 };
    row.openCount += 1;
    row.loadSize += t.size;
    byUser.set(t.assignee_id, row);
  }

  const absentUntilByUser = new Map<string, DateKey>();
  for (const a of absences) {
    if (a.from <= today && today <= a.to) absentUntilByUser.set(a.userId, a.to);
  }

  const userIds = new Set([...byUser.keys(), ...absentUntilByUser.keys()]);
  return [...userIds].map((userId) => ({
    userId,
    openCount: byUser.get(userId)?.openCount ?? 0,
    loadSize: byUser.get(userId)?.loadSize ?? 0,
    absentToday: absentUntilByUser.has(userId),
    absentUntil: absentUntilByUser.get(userId) ?? null,
  }));
}
