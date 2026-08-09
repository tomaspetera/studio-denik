/**
 * Úprava úkolu. Nejzáludnější je změna typu: každý typ má jiný počet kroků,
 * takže úkol na kroku 5 by se po přepnutí na tříkrokový typ ocitl mimo rozsah
 * a databáze by zápis odmítla.
 */
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const POCTY = { interni: 3, klient: 4, tisk: 6 };
const ok = (s) => console.log("  " + s);
let orgId = null;
let chyby = 0;

/**
 * Stejné pravidlo jako v lib/tasks.ts. Uzavřený zůstane uzavřený, otevřený
 * otevřený — změna typu nesmí úkol dokončit za uživatele.
 */
function novyKrok(starýTyp, starýKrok, novýTyp) {
  const posledni = POCTY[novýTyp] - 1;
  const bylUzavren = starýKrok >= POCTY[starýTyp] - 1;
  if (bylUzavren) return posledni;
  return Math.min(starýKrok, posledni - 1);
}

async function stav(id) {
  const { data } = await db
    .from("tasks_view")
    .select("title, kind, step, ball, step_name, step_count")
    .eq("id", id)
    .single();
  return data;
}

try {
  const { data: org, error } = await db
    .from("orgs")
    .insert({ name: "__test_uprava__", slug: `__e_${Date.now()}` })
    .select("id")
    .single();
  if (error) throw error;
  orgId = org.id;

  // --- 1) Přejmenování ------------------------------------------------
  const { data: t } = await db
    .from("tasks")
    .insert({ org_id: orgId, title: "Chybne zadany", kind: "klient", step: 1 })
    .select("id")
    .single();

  await db.from("tasks").update({ title: "Opravený název" }).eq("id", t.id);
  let v = await stav(t.id);
  if (v.title !== "Opravený název") { chyby++; ok(`přejmenování    ŠPATNĚ — "${v.title}"`); }
  else ok(`přejmenování    ok — "${v.title}"`);

  // --- 2) Tiskový uzavřený → interní ---------------------------------
  // Krok 5 v tiskovém průchodu neexistuje v tříkrokovém. Bez srovnání
  // by databáze zápis odmítla.
  const { data: t2 } = await db
    .from("tasks")
    .insert({ org_id: orgId, title: "Uzavreny tiskovy", kind: "tisk", step: 5 })
    .select("id")
    .single();

  const cil = novyKrok("tisk", 5, "interni");
  const { error: e2 } = await db
    .from("tasks")
    .update({ kind: "interni", step: cil })
    .eq("id", t2.id);

  if (e2) { chyby++; ok(`tisk→interní    ŠPATNĚ — ${e2.message}`); }
  else {
    v = await stav(t2.id);
    if (v.ball !== "done") { chyby++; ok(`tisk→interní    ŠPATNĚ — míč u ${v.ball}, čekáno done`); }
    else ok(`tisk→interní    ok — zůstal uzavřený, krok ${v.step}/${v.step_count} "${v.step_name}"`);
  }

  // --- 3) Rozpracovaný tiskový (krok 3) → interní --------------------
  const { data: t3 } = await db
    .from("tasks")
    .insert({ org_id: orgId, title: "V tisku", kind: "tisk", step: 3 })
    .select("id")
    .single();

  const cil3 = novyKrok("tisk", 3, "interni");
  const { error: e3 } = await db
    .from("tasks")
    .update({ kind: "interni", step: cil3 })
    .eq("id", t3.id);

  if (e3) { chyby++; ok(`v tisku→interní ŠPATNĚ — ${e3.message}`); }
  else {
    v = await stav(t3.id);
    // Tohle je ta podstatná kontrola: rozpracovaný úkol se změnou typu
    // nesmí tiše uzavřít.
    if (v.ball === "done") {
      chyby++;
      ok(`v tisku→interní ŠPATNĚ — rozpracovaný úkol se sám uzavřel ("${v.step_name}")`);
    } else {
      ok(`v tisku→interní ok — "${v.step_name}", zůstal otevřený, míč u ${v.ball}`);
    }
    if (v.step >= v.step_count) { chyby++; ok("  krok je mimo rozsah!"); }
  }

  // --- 4) Bez srovnání to musí selhat --------------------------------
  // Pojistka: kdyby někdo srovnání odstranil, tohle to odhalí.
  const { data: t4 } = await db
    .from("tasks")
    .insert({ org_id: orgId, title: "Pojistka", kind: "tisk", step: 5 })
    .select("id")
    .single();

  const { error: e4 } = await db.from("tasks").update({ kind: "interni" }).eq("id", t4.id);
  if (!e4) { chyby++; ok("pojistka        ŠPATNĚ — databáze pustila krok 5 u tříkrokového typu"); }
  else ok("pojistka        ok — bez srovnání kroku databáze zápis odmítne");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  if (orgId) {
    const { error } = await db.from("orgs").delete().eq("id", orgId);
    ok(error ? `úklid selhal: ${error.message}` : "testovací data uklizena");
  }
}

console.log(chyby === 0 ? "\nVšechno sedí." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
