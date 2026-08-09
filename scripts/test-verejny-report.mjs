/**
 * Bezpečnost veřejného odkazu na report.
 *
 * Stránka `/r/[token]` je jediné místo aplikace přístupné bez přihlášení,
 * takže musí platit, že nepřihlášený návštěvník uvidí výhradně report,
 * který je publikovaný, má platný odkaz a on zná jeho token.
 *
 * Testujeme přes veřejný klíč, ne servisní — jinak bychom měřili něco jiného,
 * než co potká skutečný návštěvník.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
// Přesně to, s čím pracuje prohlížeč nepřihlášeného člověka.
const host = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const ok = (s) => console.log("  " + s);
let orgId = null;
let chyby = 0;

const cti = async (token) => {
  const { data, error } = await host.rpc("public_report", { p_token: token });
  return error ? null : data;
};

try {
  const { data: org, error } = await admin
    .from("orgs")
    .insert({ name: "Zkušební studio", slug: `__v_${Date.now()}` })
    .select("id")
    .single();
  if (error) throw error;
  orgId = org.id;

  const { data: rep, error: rErr } = await admin
    .from("reports")
    .insert({
      org_id: orgId,
      starts_on: "2026-08-03",
      ends_on: "2026-08-09",
      label: "2026-W32",
      ai_summary: "Tajný text reportu.",
    })
    .select("id, share_token")
    .single();
  if (rErr) throw rErr;

  // --- 1) Koncept nesmí být vidět --------------------------------------
  let v = await cti(rep.share_token);
  if (v) { chyby++; ok("koncept         ŠPATNĚ — nepublikovaný report je veřejně čitelný"); }
  else ok("koncept         ok — nepublikovaný report se nevydá");

  // --- 2) Po publikaci ano ---------------------------------------------
  await admin
    .from("reports")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      snapshot: { rangeText: "3.–9. srpna 2026", counts: { done: 1, me: 0, client: 0, supplier: 0, late: 0 }, byCategory: [], byClient: [], waiting: [] },
    })
    .eq("id", rep.id);

  v = await cti(rep.share_token);
  if (!v) { chyby++; ok("publikovaný     ŠPATNĚ — publikovaný report se nevydal"); }
  else if (v.summary !== "Tajný text reportu.") { chyby++; ok(`publikovaný     ŠPATNĚ — vrátil "${v.summary}"`); }
  else ok(`publikovaný     ok — text i snímek dorazily (${v.org_name})`);

  // --- 3) Cizí token nesmí projít --------------------------------------
  v = await cti("0".repeat(32));
  if (v) { chyby++; ok("cizí token      ŠPATNĚ — vymyšlený token něco vrátil"); }
  else ok("cizí token      ok — nic nevydá");

  // --- 4) Po vypršení platnosti ----------------------------------------
  await admin
    .from("reports")
    .update({ share_until: new Date(Date.now() - 86_400_000).toISOString() })
    .eq("id", rep.id);

  v = await cti(rep.share_token);
  if (v) { chyby++; ok("vypršelý odkaz  ŠPATNĚ — po platnosti pořád vydává"); }
  else ok("vypršelý odkaz  ok — po platnosti se nevydá");

  // --- 5) Tabulka reports musí zůstat zamčená --------------------------
  // Kdyby šla číst přímo, byl by celý token k ničemu.
  const { data: primo } = await host.from("reports").select("ai_summary").limit(5);
  if (primo && primo.length > 0) {
    chyby++;
    ok(`přímé čtení     ŠPATNĚ — veřejný klíč přečetl ${primo.length} reportů z tabulky`);
  } else {
    ok("přímé čtení     ok — tabulka reports je pro nepřihlášené zamčená");
  }
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  if (orgId) {
    const { error } = await admin.from("orgs").delete().eq("id", orgId);
    ok(error ? `úklid selhal: ${error.message}` : "testovací data uklizena");
  }
}

console.log(chyby === 0 ? "\nVeřejný odkaz pouští jen to, co má." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
