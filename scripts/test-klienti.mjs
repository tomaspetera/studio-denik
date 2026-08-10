/**
 * Archivace a mazání klienta.
 *
 * Rozhraní tvrdí, že smazáním klienta se úkoly neztratí, jen přestanou vědět,
 * komu patřily. Tohle to ověřuje — kdyby to nebyla pravda, upozornění by
 * uživatele klamalo v okamžiku, kdy se rozhoduje.
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
    .insert({ name: "__test_klienti__", slug: `__k_${Date.now()}` })
    .select("id")
    .single();
  if (error) throw error;
  orgId = org.id;

  const { data: klient } = await db
    .from("clients")
    .insert({ org_id: orgId, name: "Pekárna U Lípy", ico: "27604977" })
    .select("id")
    .single();

  await db.from("tasks").insert([
    { org_id: orgId, title: "Letáky A5", kind: "klient", client_id: klient.id },
    { org_id: orgId, title: "Vizitky", kind: "tisk", client_id: klient.id },
  ]);

  // --- 1) Archivace nesmí nic ztratit ---------------------------------
  await db.from("clients").update({ archived: true }).eq("id", klient.id);

  const { data: poArchivaci } = await db
    .from("tasks_view")
    .select("title, client_name")
    .eq("org_id", orgId);

  const svazane = (poArchivaci ?? []).filter((t) => t.client_name === "Pekárna U Lípy");
  if (svazane.length !== 2) {
    chyby++;
    ok(`archivace       ŠPATNĚ — po archivaci má vazbu jen ${svazane.length} ze 2 úkolů`);
  } else {
    ok("archivace       ok — úkoly si klienta pamatují dál");
  }

  // --- 2) Archivovaný klient nesmí být v aktivním seznamu --------------
  const { data: aktivni } = await db
    .from("clients")
    .select("id")
    .eq("org_id", orgId)
    .eq("archived", false);

  if ((aktivni ?? []).length !== 0) { chyby++; ok("skrytí          ŠPATNĚ — archivovaný je pořád mezi aktivními"); }
  else ok("skrytí          ok — z aktivních zmizel");

  // --- 3) Vrácení zpět --------------------------------------------------
  await db.from("clients").update({ archived: false }).eq("id", klient.id);
  const { data: zpet } = await db
    .from("clients").select("id").eq("org_id", orgId).eq("archived", false);
  if ((zpet ?? []).length !== 1) { chyby++; ok("vrácení         ŠPATNĚ — nešel vrátit"); }
  else ok("vrácení         ok — je zpátky mezi aktivními");

  // --- 4) Smazání: úkoly zůstanou, jen se uvolní vazba -----------------
  const { error: dErr } = await db.from("clients").delete().eq("id", klient.id);
  if (dErr) throw new Error(`mazání: ${dErr.message}`);

  const { data: poSmazani } = await db
    .from("tasks_view")
    .select("title, client_id, client_name")
    .eq("org_id", orgId);

  const pocet = (poSmazani ?? []).length;
  const bezVazby = (poSmazani ?? []).filter((t) => t.client_id === null).length;

  if (pocet !== 2) {
    chyby++;
    ok(`smazání         ŠPATNĚ — z 2 úkolů zbylo ${pocet}, úkoly se smazaly s klientem`);
  } else if (bezVazby !== 2) {
    chyby++;
    ok(`smazání         ŠPATNĚ — ${2 - bezVazby} úkolů má vazbu na neexistujícího klienta`);
  } else {
    ok("smazání         ok — oba úkoly zůstaly, vazba se uvolnila");
    ok("                upozornění v rozhraní tedy říká pravdu");
  }

  // --- 5) Stejné IČO nejde založit dvakrát ------------------------------
  await db.from("clients").insert({ org_id: orgId, name: "Prvni", ico: "26185610" });
  const { error: dupErr } = await db
    .from("clients")
    .insert({ org_id: orgId, name: "Druhy", ico: "26185610" });

  if (!dupErr) { chyby++; ok("duplicitní IČO  ŠPATNĚ — prošlo dvakrát"); }
  else ok("duplicitní IČO  ok — druhý zápis odmítnut");
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
