import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import { suggestMoves, type MoveSuggestion } from "./brand-match";

/**
 * Přeřazení úkolů ke značce — čtení a zápis. Pravidla jsou v `brand-match.ts`.
 *
 * Appka nic nepřeřazuje sama: jen spočítá, které úkoly mají jméno klienta
 * v názvu a patří jinam, a člověk to u klienta potvrdí.
 */

export type ActionResult = { ok: true; moved: number } | { ok: false; message: string };

async function navrhy(orgId: string): Promise<MoveSuggestion[]> {
  const supabase = await supabaseServer();
  const [{ data: klienti }, { data: ukoly }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("org_id", orgId).eq("archived", false),
    supabase.from("tasks").select("id, title, client_id").eq("org_id", orgId),
  ]);
  return suggestMoves(
    (ukoly ?? []) as { id: string; title: string; client_id: string | null }[],
    (klienti ?? []) as { id: string; name: string }[],
  );
}

/** Návrhy pro stránku Klienti. Když se nepovede je spočítat, stránka se obejde bez nich. */
export async function loadMoveSuggestions(orgId: string): Promise<MoveSuggestion[]> {
  try {
    return await navrhy(orgId);
  } catch {
    return [];
  }
}

/**
 * Přeřadí ke klientovi úkoly, které mají jeho jméno v názvu. Seznam se počítá
 * znovu na serveru — z prohlížeče přijde jen, o kterého klienta jde, ne které
 * úkoly se mají přesunout.
 */
export async function applyBrandMoves(orgId: string, clientId: string): Promise<ActionResult> {
  const navrh = (await navrhy(orgId)).find((n) => n.clientId === clientId);
  if (!navrh || navrh.tasks.length === 0) return { ok: true, moved: 0 };

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("tasks")
    .update({ client_id: clientId })
    .eq("org_id", orgId)
    .in("id", navrh.tasks.map((t) => t.id))
    .select("id");
  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true, moved: data?.length ?? 0 };
}
