import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import { todayKeyPrague } from "./domain";
import {
  normalizePreset,
  normalizeSchedule,
  type Frequency,
  type PresetKind,
  type Schedule,
} from "./presets";

/**
 * Opakovaný úkol = pravidlo. Samotné úkoly z něj zakládá SQL funkce
 * `create_due_recurring_tasks` (migrace 0016) — ranní cron i appka hned
 * po uložení pravidla.
 */
export type RecurringRule = {
  id: string;
  title: string;
  kind: PresetKind;
  size: number;
  clientId: string | null;
  categoryId: string | null;
  dueOffsetDays: number | null;
  frequency: Frequency;
  weekday: number | null;
  monthDay: number | null;
  active: boolean;
};

export type ActionResult = { ok: true } | { ok: false; message: string };

const NOT_FOUND = "Záznam se nenašel, nebo ho nemůžeš měnit.";

export async function listRecurring(orgId: string): Promise<RecurringRule[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("recurring_tasks")
    .select("id, title, kind, size, client_id, category_id, due_offset_days, frequency, weekday, month_day, active")
    .eq("org_id", orgId)
    .order("created_at");

  type Row = {
    id: string; title: string; kind: PresetKind; size: number;
    client_id: string | null; category_id: string | null; due_offset_days: number | null;
    frequency: Frequency; weekday: number | null; month_day: number | null; active: boolean;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    size: r.size,
    clientId: r.client_id,
    categoryId: r.category_id,
    dueOffsetDays: r.due_offset_days,
    frequency: r.frequency,
    weekday: r.weekday,
    monthDay: r.month_day,
    active: r.active,
  }));
}

export type RecurringFields = {
  title: string;
  kind: string;
  size: number;
  clientId?: string | null;
  categoryId?: string | null;
  dueOffsetDays?: number | string | null;
  frequency: string;
  weekday?: number | null;
  monthDay?: number | null;
};

function toRow(
  p: { title: string; kind: PresetKind; size: number; dueOffsetDays: number | null },
  s: Schedule,
  input: RecurringFields,
) {
  return {
    title: p.title,
    kind: p.kind,
    size: p.size,
    client_id: input.clientId || null,
    category_id: input.categoryId || null,
    due_offset_days: p.dueOffsetDays,
    frequency: s.frequency,
    weekday: s.weekday,
    month_day: s.monthDay,
  };
}

/**
 * Pravidlo uložené ve svůj den má úkol vyrobit hned, ne až zítra ráno —
 * jinak by se první týden zdálo, že nic nedělá. Záznam o výskytu hlídá, aby
 * ho ranní cron nezaložil podruhé. Selhání tu není fatální: pravidlo je
 * uložené a ranní běh to dožene.
 */
async function createTodaysTasks(orgId: string): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.rpc("create_due_recurring_tasks", {
    p_org: orgId,
    p_today: todayKeyPrague(),
    p_days_back: 0,
  });
}

export async function createRecurring(input: RecurringFields & { orgId: string }): Promise<ActionResult> {
  const p = normalizePreset(input);
  if (!p.ok) return p;
  const s = normalizeSchedule(input);
  if (!s.ok) return s;

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from("recurring_tasks").insert({
    org_id: input.orgId,
    created_by: user?.id ?? null,
    ...toRow(p, s, input),
  });
  if (error) return { ok: false, message: error.message };

  await createTodaysTasks(input.orgId);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateRecurring(
  input: RecurringFields & { id: string; orgId: string },
): Promise<ActionResult> {
  const p = normalizePreset(input);
  if (!p.ok) return p;
  const s = normalizeSchedule(input);
  if (!s.ok) return s;

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("recurring_tasks")
    .update(toRow(p, s, input))
    .eq("id", input.id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: NOT_FOUND };

  await createTodaysTasks(input.orgId);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setRecurringActive(
  id: string,
  orgId: string,
  active: boolean,
): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("recurring_tasks")
    .update({ active })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: NOT_FOUND };

  if (active) await createTodaysTasks(orgId);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteRecurring(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("recurring_tasks").delete().eq("id", id).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: NOT_FOUND };

  revalidatePath("/", "layout");
  return { ok: true };
}
