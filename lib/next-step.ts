import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import { normalizeNextStep } from "./attention";

export type ActionResult = { ok: true } | { ok: false; message: string };

/**
 * Rychlé nastavení dalšího kroku z Dnes — bez otevírání celé karty klienta
 * nebo poptávky. Prázdný krok i datum krok smaže (poptávka se pak vrátí mezi
 * "bez dalšího kroku", což je přesně to, co "hotovo, co dál?" znamená).
 *
 * `.select("id")` za úpravou je záměr: když přístupová práva úpravu tiše
 * nepustí (nula změněných řádků, žádná chyba), bez toho by akce hlásila
 * úspěch, který se nikdy nestal.
 */
export async function setNextStep(input: {
  subject: "client" | "lead";
  id: string;
  step: string | null;
  at: string | null;
}): Promise<ActionResult> {
  const n = normalizeNextStep(input.step, input.at);
  if (!n.ok) return n;

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from(input.subject === "client" ? "clients" : "leads")
    .update({ next_step: n.step, next_step_at: n.at })
    .eq("id", input.id)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "Záznam se nenašel, nebo ho nemůžeš měnit." };

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Po kolika dnech bez aktivity se klient bez práce ukáže mezi věcmi, které chtějí pozornost. */
export async function setSilenceDays(orgId: string, days: number): Promise<ActionResult> {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return { ok: false, message: "Počet dní musí být celé číslo od 1 do 365." };
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("orgs")
    .update({ silence_days: days })
    .eq("id", orgId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "Tohle nastavení může měnit jen správce." };

  revalidatePath("/", "layout");
  return { ok: true };
}
