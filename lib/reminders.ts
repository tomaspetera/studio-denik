import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import type { DateKey } from "./domain";

/**
 * Připomínka — kalendářní položka bez úkolu za sebou. Na rozdíl od úkolu
 * nemá kroky ani míč, jen název, den a hotovo/nehotovo. Datum je typu
 * `date` (ne timestamptz jako `tasks.due_at`), takže je to už rovnou
 * `DateKey` — žádná konverze přes časové pásmo tu není co dělat.
 */
export type Reminder = {
  id: string;
  title: string;
  note: string | null;
  date: DateKey;
  clientId: string | null;
  clientName: string | null;
  clientColor: string | null;
  createdByInitials: string | null;
  done: boolean;
};

export async function listReminders(orgId: string): Promise<Reminder[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("reminders_view")
    .select("id, title, note, date, done_at, client_id, client_name, client_color, created_by_initials")
    .eq("org_id", orgId)
    .order("date");

  type Row = {
    id: string; title: string; note: string | null; date: string; done_at: string | null;
    client_id: string | null; client_name: string | null; client_color: string | null;
    created_by_initials: string | null;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    title: r.title,
    note: r.note,
    date: r.date,
    clientId: r.client_id,
    clientName: r.client_name,
    clientColor: r.client_color,
    createdByInitials: r.created_by_initials,
    done: r.done_at !== null,
  }));
}

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function createReminder(input: {
  orgId: string;
  title: string;
  note?: string | null;
  date: DateKey;
  clientId?: string | null;
}): Promise<ActionResult> {
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Připomínka potřebuje text." };

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from("reminders").insert({
    org_id: input.orgId,
    title,
    note: input.note?.trim() || null,
    date: input.date,
    client_id: input.clientId || null,
    created_by: user?.id ?? null,
  });

  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateReminder(input: {
  id: string;
  title: string;
  note?: string | null;
  clientId?: string | null;
}): Promise<ActionResult> {
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Připomínka potřebuje text." };

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("reminders")
    .update({ title, note: input.note?.trim() || null, client_id: input.clientId || null })
    .eq("id", input.id);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setReminderDone(id: string, done: boolean): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("reminders")
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq("id", id);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteReminder(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("reminders").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
