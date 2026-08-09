/**
 * Ověří, co se smazáním úkolu skutečně stane. Rozhraní na to uživatele
 * upozorňuje, takže to upozornění musí být pravdivé.
 */
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const ok = (s) => console.log("  " + s);
let orgId = null;
let chyby = 0;

try {
  const { data: org, error } = await db
    .from("orgs")
    .insert({ name: "__test_mazani__", slug: `__m_${Date.now()}` })
    .select("id")
    .single();
  if (error) throw error;
  orgId = org.id;

  // Tiskový úkol, posuneme ho, ať vznikne historie, a přidáme zakázku.
  const { data: task } = await db
    .from("tasks")
    .insert({ org_id: orgId, title: "Ke smazání", kind: "tisk", step: 1 })
    .select("id")
    .single();

  await db.from("tasks").update({ step: 3 }).eq("id", task.id);
  await db.from("print_jobs").insert({ org_id: orgId, task_id: task.id, code: "ZAK-TEST" });

  const pocty = async () => {
    const [u, h, z] = await Promise.all([
      db.from("tasks").select("id", { count: "exact", head: true }).eq("id", task.id),
      db.from("task_events").select("id", { count: "exact", head: true }).eq("task_id", task.id),
      db.from("print_jobs").select("id", { count: "exact", head: true }).eq("task_id", task.id),
    ]);
    return { ukol: u.count, historie: h.count, zakazka: z.count };
  };

  const pred = await pocty();
  ok(`před smazáním   úkol ${pred.ukol}, historie ${pred.historie}, zakázka ${pred.zakazka}`);
  if (pred.historie < 2) { chyby++; ok("historie se nezapsala — test nemá co ověřovat"); }

  const { error: delErr } = await db.from("tasks").delete().eq("id", task.id);
  if (delErr) throw new Error(`mazání: ${delErr.message}`);

  const po = await pocty();
  ok(`po smazání      úkol ${po.ukol}, historie ${po.historie}, zakázka ${po.zakazka}`);

  if (po.ukol !== 0) { chyby++; ok("úkol se nesmazal"); }
  if (po.historie !== 0) { chyby++; ok("historie zůstala — kaskáda nefunguje"); }
  if (po.zakazka !== 0) { chyby++; ok("tisková zakázka zůstala — kaskáda nefunguje"); }

  if (chyby === 0) {
    ok("kaskáda funguje — upozornění v rozhraní říká pravdu");
  }
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  if (orgId) {
    const { error } = await db.from("orgs").delete().eq("id", orgId);
    ok(error ? `úklid selhal: ${error.message}` : "testovací data uklizena");
  }
}

console.log(chyby === 0 ? "\nOK." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
