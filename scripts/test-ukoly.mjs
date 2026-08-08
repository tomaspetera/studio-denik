/**
 * Ověří celý řetězec kolem úkolu: založení, posun kroku, přepočet míče
 * v pohledu a hlavně to, že se historie zapisuje sama spouštěčem.
 *
 * Běží v dočasné organizaci, kterou na konci smaže.
 */
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

let orgId = null;
let chyby = 0;
const ok = (s) => console.log("  " + s);

try {
  const { data: org, error } = await db
    .from("orgs")
    .insert({ name: "__test_ukoly__", slug: `__u_${Date.now()}` })
    .select("id")
    .single();
  if (error) throw error;
  orgId = org.id;

  // 1) Založení tiskového úkolu
  const { data: task, error: tErr } = await db
    .from("tasks")
    .insert({ org_id: orgId, title: "Letáky A5 — zkouška", kind: "tisk", step: 1 })
    .select("id, step")
    .single();
  if (tErr) throw new Error(`založení: ${tErr.message}`);
  ok(`založení        ok — krok ${task.step}`);

  // 2) Pohled musí dopočítat stav
  const read = async () => {
    const { data, error } = await db
      .from("tasks_view")
      .select("step, ball, step_name, step_count, is_late, closed_at")
      .eq("id", task.id)
      .single();
    if (error) throw new Error(`pohled: ${error.message}`);
    return data;
  };

  let v = await read();
  if (v.ball !== "me" || v.step_name !== "Dělám" || v.step_count !== 6) {
    chyby++;
    ok(`pohled          ŠPATNĚ — ${JSON.stringify(v)}`);
  } else {
    ok(`pohled          ok — "${v.step_name}", míč u ${v.ball}, ${v.step_count} kroků`);
  }

  // 3) Posun na krok 3 (V tisku) → míč se musí přehodit na dodavatele
  await db.from("tasks").update({ step: 3 }).eq("id", task.id);
  v = await read();
  if (v.ball !== "supplier") {
    chyby++;
    ok(`posun na tisk   ŠPATNĚ — míč u ${v.ball}, čekáno supplier`);
  } else {
    ok(`posun na tisk   ok — "${v.step_name}", míč u ${v.ball}`);
  }

  // 4) Uzavření → closed_at se má orazítkovat samo
  await db.from("tasks").update({ step: 5 }).eq("id", task.id);
  v = await read();
  if (v.ball !== "done" || !v.closed_at) {
    chyby++;
    ok(`uzavření        ŠPATNĚ — míč ${v.ball}, closed_at ${v.closed_at}`);
  } else {
    ok(`uzavření        ok — orazítkováno samo`);
  }

  // 5) Vrácení zpět → razítko musí zmizet
  await db.from("tasks").update({ step: 3 }).eq("id", task.id);
  v = await read();
  if (v.closed_at !== null) {
    chyby++;
    ok(`vrácení zpět    ŠPATNĚ — closed_at zůstalo ${v.closed_at}`);
  } else {
    ok(`vrácení zpět    ok — razítko zrušeno`);
  }

  // 6) Historie — z ní se staví report
  const { data: udalosti, error: hErr } = await db
    .from("task_events")
    .select("kind, from_step, to_step, detail")
    .eq("task_id", task.id)
    .order("at");
  if (hErr) throw new Error(`historie: ${hErr.message}`);

  const kroky = udalosti.filter((u) => u.kind === "step");
  const zalozeno = udalosti.filter((u) => u.kind === "created");
  if (zalozeno.length !== 1 || kroky.length !== 3) {
    chyby++;
    ok(`historie        ŠPATNĚ — ${zalozeno.length}× založení, ${kroky.length}× posun`);
  } else {
    ok(`historie        ok — ${udalosti.length} záznamů, zapsala se sama`);
    kroky.forEach((u) => ok(`                  ${u.from_step} → ${u.to_step}  "${u.detail}"`));
  }

  // 7) Omezení: krok mimo rozsah typu musí databáze odmítnout
  const { error: badErr } = await db
    .from("tasks")
    .insert({ org_id: orgId, title: "mimo rozsah", kind: "interni", step: 5 });
  if (!badErr) {
    chyby++;
    ok(`ochrana rozsahu ŠPATNĚ — databáze pustila krok 5 u tříkrokového úkolu`);
  } else {
    ok(`ochrana rozsahu ok — neplatný krok odmítnut`);
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

console.log(chyby === 0 ? "\nVšechno sedí." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
