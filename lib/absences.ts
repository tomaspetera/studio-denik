import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import type { DateKey } from "./domain";

/**
 * Nepřítomnost týmu — dovolená, nemoc, cokoli. `from`/`to` jsou `date`
 * (ne timestamptz), stejně jako `reminders.date` — je to čistě kalendářní
 * rozsah bez času, žádnou konverzi přes časové pásmo nepotřebuje.
 */
export type Absence = {
  id: string;
  userId: string;
  from: DateKey;
  to: DateKey;
  note: string | null;
};

export async function listAbsences(orgId: string): Promise<Absence[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("absences")
    .select("id, user_id, from_date, to_date, note")
    .eq("org_id", orgId)
    .order("from_date");

  type Row = { id: string; user_id: string; from_date: string; to_date: string; note: string | null };
  return ((data ?? []) as unknown as Row[]).map((a) => ({
    id: a.id,
    userId: a.user_id,
    from: a.from_date,
    to: a.to_date,
    note: a.note,
  }));
}

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function createAbsence(input: {
  orgId: string;
  userId: string;
  from: DateKey;
  to: DateKey;
  note?: string | null;
}): Promise<ActionResult> {
  if (input.to < input.from) return { ok: false, message: "Konec nemůže být před začátkem." };

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from("absences").insert({
    org_id: input.orgId,
    user_id: input.userId,
    from_date: input.from,
    to_date: input.to,
    note: input.note?.trim() || null,
    created_by: user?.id ?? null,
  });

  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteAbsence(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("absences").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
