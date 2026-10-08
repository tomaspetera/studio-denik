import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import { isValidDateKey } from "./attention";

/**
 * Plán týdne v databázi: sloupec `tasks.planned_for` (migrace 0025). Pohled
 * `tasks_view` ho nevrací, proto se čte zvlášť přímo z tabulky a k úkolům se
 * přidává až v aplikaci.
 */

export type ActionResult = { ok: true } | { ok: false; message: string };

/**
 * Naplánované úkoly studia: id úkolu → den "RRRR-MM-DD".
 *
 * Když dotaz selže (typicky sloupec ještě neexistuje, protože migrace 0025
 * neproběhla), vrátí prázdný plán. Plán je doplněk — kvůli němu nesmí spadnout
 * stránka Dnes.
 */
export async function loadPlans(orgId: string): Promise<Map<string, string>> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("tasks")
    .select("id, planned_for")
    .eq("org_id", orgId)
    .not("planned_for", "is", null);
  if (error) return new Map();
  return new Map((data ?? []).map((r) => [r.id as string, r.planned_for as string]));
}

/** Zařazení úkolu na den; `null` plán zruší. Termín úkolu se tím nemění. */
export async function planTask(taskId: string, day: string | null): Promise<ActionResult> {
  if (day !== null && !isValidDateKey(day)) return { ok: false, message: "Neplatný den." };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("tasks").update({ planned_for: day }).eq("id", taskId).select("id");
  if (error) {
    // Sloupec přidává migrace 0025 — bez ní databáze zápis odmítne.
    return { ok: false, message: /planned_for/.test(error.message) ? "V databázi chybí migrace 0025 (Můj týden)." : error.message };
  }
  if (!data?.length) return { ok: false, message: "Úkol se nenašel." };

  revalidatePath("/", "layout");
  return { ok: true };
}
