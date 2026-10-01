/**
 * Další krok a hlídání ticha — databázová část (migrace 0015).
 *
 * Pravidla "krok i datum, nebo nic" a rozsah `silence_days` jsou v databázi,
 * ne jen ve formuláři — tenhle test ověřuje, že je nejde obejít přímým
 * zápisem. Navíc spouští přesně ty dotazy, které načítá Dnes, aby překlep
 * ve sloupci nevyšel najevo až v produkci.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const razitko = Date.now();
const HESLO = "Zkouska-" + razitko;

const ok = (s) => console.log("  " + s);
const uklid = { users: [], orgs: [] };
let chyby = 0;

const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(22)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(22)}ŠPATNĚ — ${popis}`); }
};

async function jakoUzivatel(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: HESLO, email_confirm: true });
  if (error) throw new Error(`účet ${email}: ${error.message}`);
  uklid.users.push(data.user.id);
  const klient = createClient(url, anon, { auth: { persistSession: false } });
  const { error: sErr } = await klient.auth.signInWithPassword({ email, password: HESLO });
  if (sErr) throw new Error(`přihlášení ${email}: ${sErr.message}`);
  return klient;
}

try {
  const a = await jakoUzivatel(`krok-a-${razitko}@example.com`);
  const b = await jakoUzivatel(`krok-b-${razitko}@example.com`);

  const { data: orgA } = await a.rpc("ensure_workspace", { p_name: "Studio A" });
  const { data: orgB } = await b.rpc("ensure_workspace", { p_name: "Studio B" });
  uklid.orgs.push(orgA, orgB);

  const { data: klient } = await a.from("clients").insert({ org_id: orgA, name: "Pekárna", color: "#B5673E" }).select("id").single();
  const { data: lead } = await a.from("leads").insert({ org_id: orgA, name: "Logo" }).select("id").single();

  // --- 1) Zápis a čtení kroku ------------------------------------------------
  const { error: kErr } = await a.from("clients").update({ next_step: "Ozvat se", next_step_at: "2026-11-05" }).eq("id", klient.id);
  const { data: kPo } = await a.from("clients").select("next_step, next_step_at").eq("id", klient.id).single();
  zkouska("krok u klienta", !kErr && kPo.next_step === "Ozvat se" && kPo.next_step_at === "2026-11-05", "krok i datum se uložily");

  const { error: lErr } = await a.from("leads").update({ next_step: "Poslat nabídku", next_step_at: "2026-10-10" }).eq("id", lead.id);
  const { data: lPo } = await a.from("leads").select("next_step, next_step_at").eq("id", lead.id).single();
  zkouska("krok u poptávky", !lErr && lPo.next_step === "Poslat nabídku" && lPo.next_step_at === "2026-10-10", "krok i datum se uložily");

  // --- 2) Krok a datum jdou spolu — jde to i mimo formulář --------------------
  const { error: jenText } = await a.from("clients").update({ next_step: "Jen text", next_step_at: null }).eq("id", klient.id);
  zkouska("klient: text sám", !!jenText, "krok bez data databáze odmítne");
  const { error: jenDatum } = await a.from("clients").update({ next_step: null, next_step_at: "2026-12-01" }).eq("id", klient.id);
  zkouska("klient: datum samo", !!jenDatum, "datum bez kroku databáze odmítne");
  const { error: lJenText } = await a.from("leads").update({ next_step: "Jen text", next_step_at: null }).eq("id", lead.id);
  zkouska("poptávka: text sám", !!lJenText, "krok bez data databáze odmítne");
  const { error: lJenDatum } = await a.from("leads").update({ next_step: null, next_step_at: "2026-12-01" }).eq("id", lead.id);
  zkouska("poptávka: datum samo", !!lJenDatum, "datum bez kroku databáze odmítne");

  const { data: poOdmitnuti } = await a.from("clients").select("next_step, next_step_at").eq("id", klient.id).single();
  zkouska("nic se nepoškodilo", poOdmitnuti.next_step === "Ozvat se" && poOdmitnuti.next_step_at === "2026-11-05", "odmítnutý zápis předchozí krok nepřepsal");

  // --- 3) Smazání kroku -------------------------------------------------------
  const { error: clrErr } = await a.from("clients").update({ next_step: null, next_step_at: null }).eq("id", klient.id);
  const { data: poClr } = await a.from("clients").select("next_step, next_step_at").eq("id", klient.id).single();
  zkouska("smazání kroku", !clrErr && poClr.next_step === null && poClr.next_step_at === null, "obojí prázdné je v pořádku");

  // --- 4) Cizí organizace -----------------------------------------------------
  const { data: cizi } = await b
    .from("leads")
    .update({ next_step: "Podvrh", next_step_at: "2026-10-02" })
    .eq("id", lead.id)
    .select("id");
  const { data: poPokusu } = await a.from("leads").select("next_step").eq("id", lead.id).single();
  zkouska("cizí zápis", (cizi ?? []).length === 0 && poPokusu.next_step === "Poslat nabídku", "cizí organizace krok nepřepsala");

  // --- 5) Nastavení ticha -----------------------------------------------------
  const { data: org0 } = await a.from("orgs").select("silence_days").eq("id", orgA).single();
  zkouska("výchozí ticho", org0.silence_days === 14, "nová organizace má 14 dní");

  const { data: zmena } = await a.from("orgs").update({ silence_days: 30 }).eq("id", orgA).select("silence_days");
  zkouska("změna ticha", zmena?.[0]?.silence_days === 30, "správce může počet dní změnit");

  const { error: nula } = await a.from("orgs").update({ silence_days: 0 }).eq("id", orgA);
  const { error: moc } = await a.from("orgs").update({ silence_days: 366 }).eq("id", orgA);
  zkouska("rozsah ticha", !!nula && !!moc, "0 ani 366 dní databáze nepřijme");

  const { data: cizi2 } = await b.from("orgs").update({ silence_days: 1 }).eq("id", orgA).select("id");
  const { data: org1 } = await a.from("orgs").select("silence_days").eq("id", orgA).single();
  zkouska("cizí nastavení", (cizi2 ?? []).length === 0 && org1.silence_days === 30, "cizí organizace ticho nepřepsala");

  // --- 6) Dotazy, které načítá Dnes -------------------------------------------
  const dotazy = await Promise.all([
    a.from("orgs").select("silence_days").eq("id", orgA).single(),
    a.from("clients").select("id, name, archived, next_step, next_step_at, created_at").eq("org_id", orgA),
    a.from("leads").select("id, name, company, status, next_step, next_step_at, created_at").eq("org_id", orgA),
    a.from("tasks_view").select("client_id, ball, closed_at, updated_at").eq("org_id", orgA),
    a.from("client_notes").select("client_id, created_at").eq("org_id", orgA),
    a.from("task_events").select("task_id, at").eq("org_id", orgA).in("kind", ["client_approved", "client_changes"]),
  ]);
  const prvniChyba = dotazy.find((d) => d.error)?.error;
  zkouska("dotazy pro Dnes", !prvniChyba, prvniChyba ? prvniChyba.message : "všech šest čtení projde pod běžným účtem");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  for (const id of uklid.orgs) await admin.from("orgs").delete().eq("id", id);
  for (const id of uklid.users) await admin.auth.admin.deleteUser(id);
  ok(`úklid — ${uklid.orgs.length} prostorů, ${uklid.users.length} účtů`);
}

console.log(chyby === 0 ? "\nDalší krok a nastavení ticha fungují a jsou soukromé." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
