import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import { normalizePreset, type PresetKind } from "./presets";

/**
 * Šablona = předvyplněný úkol. Kroky do ní nepatří, ty nese typ úkolu.
 */
export type TaskTemplate = {
  id: string;
  title: string;
  kind: PresetKind;
  size: number;
  clientId: string | null;
  categoryId: string | null;
  /** Termín = den založení + tolik dní. `null` = bez termínu. */
  dueOffsetDays: number | null;
};

export type ActionResult = { ok: true } | { ok: false; message: string };

const NOT_FOUND = "Záznam se nenašel, nebo ho nemůžeš měnit.";

export async function listTemplates(orgId: string): Promise<TaskTemplate[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("task_templates")
    .select("id, title, kind, size, client_id, category_id, due_offset_days")
    .eq("org_id", orgId)
    .order("created_at");

  type Row = {
    id: string; title: string; kind: PresetKind; size: number;
    client_id: string | null; category_id: string | null; due_offset_days: number | null;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    size: r.size,
    clientId: r.client_id,
    categoryId: r.category_id,
    dueOffsetDays: r.due_offset_days,
  }));
}

export type TemplateFields = {
  title: string;
  kind: string;
  size: number;
  clientId?: string | null;
  categoryId?: string | null;
  dueOffsetDays?: number | string | null;
};

function toRow(p: { title: string; kind: PresetKind; size: number; dueOffsetDays: number | null }, input: TemplateFields) {
  return {
    title: p.title,
    kind: p.kind,
    size: p.size,
    client_id: input.clientId || null,
    category_id: input.categoryId || null,
    due_offset_days: p.dueOffsetDays,
  };
}

export async function createTemplate(input: TemplateFields & { orgId: string }): Promise<ActionResult> {
  const p = normalizePreset(input);
  if (!p.ok) return p;

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from("task_templates").insert({
    org_id: input.orgId,
    created_by: user?.id ?? null,
    ...toRow(p, input),
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateTemplate(input: TemplateFields & { id: string }): Promise<ActionResult> {
  const p = normalizePreset(input);
  if (!p.ok) return p;

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("task_templates")
    .update(toRow(p, input))
    .eq("id", input.id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: NOT_FOUND };

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("task_templates").delete().eq("id", id).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: NOT_FOUND };

  revalidatePath("/", "layout");
  return { ok: true };
}
