/**
 * Bohatší karta klienta: úprava existujícího klienta a další kontakty.
 *
 * Doteď appka uměla klienta jen založit, archivovat nebo smazat — tenhle
 * test ověřuje novou cestu (úpravu) a nový vedlejší zdroj (kontakty),
 * pod skutečným účtem, ne servisním klíčem, ať se prokáže, že práva
 * doopravdy fungují, ne že to jen projde kolem nich.
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
  if (cond) ok(`${nazev.padEnd(16)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(16)}ŠPATNĚ — ${popis}`); }
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
  const a = await jakoUzivatel(`karta-a-${razitko}@example.com`);
  const b = await jakoUzivatel(`karta-b-${razitko}@example.com`);

  const { data: orgA } = await a.rpc("ensure_workspace", { p_name: "Studio A" });
  const { data: orgB } = await b.rpc("ensure_workspace", { p_name: "Studio B" });
  uklid.orgs.push(orgA, orgB);

  // --- 1) Založení a úprava klienta ---------------------------------------
  const { data: klient, error: cErr } = await a
    .from("clients")
    .insert({ org_id: orgA, name: "Pekárna U Lípy", color: "#B5673E" })
    .select("id")
    .single();
  zkouska("založení", !cErr, cErr ? cErr.message : "klient uložen");

  const { error: uErr } = await a
    .from("clients")
    .update({ name: "Pekárna U Lípy s.r.o.", relationship: "Stálý klient" })
    .eq("id", klient.id);
  const { data: poUprave } = await a.from("clients").select("name, relationship").eq("id", klient.id).single();
  zkouska("úprava", !uErr && poUprave.name === "Pekárna U Lípy s.r.o." && poUprave.relationship === "Stálý klient",
    "překlep v názvu i typ spolupráce se dají opravit, ne jen při založení");

  // --- 2) Cizí organizace nesmí klienta upravit ---------------------------
  const { error: bErr } = await b.from("clients").update({ name: "Přepsáno cizí organizací" }).eq("id", klient.id);
  const { data: poPokusu } = await a.from("clients").select("name").eq("id", klient.id).single();
  zkouska("cizí úprava", poPokusu.name === "Pekárna U Lípy s.r.o.", "cizí organizace klienta nepřepsala" + (bErr ? "" : " (tiše nic nezměnila)"));

  // --- 3) Další kontakty ----------------------------------------------------
  const { error: ccErr } = await a.from("client_contacts").insert({
    org_id: orgA, client_id: klient.id, name: "Jan Novák", role: "Jednatel", phone: "777123456",
  });
  zkouska("kontakt založen", !ccErr, ccErr ? ccErr.message : "uložen");

  const { data: kontakty } = await a.from("client_contacts").select("id, name, role").eq("client_id", klient.id);
  zkouska("kontakt čtení", kontakty?.[0]?.name === "Jan Novák" && kontakty?.[0]?.role === "Jednatel", "kontakt se vrátil se všemi poli");

  const { error: cizErr } = await b.from("client_contacts").select("id").eq("client_id", klient.id);
  const { data: cizCteni } = await b.from("client_contacts").select("id").eq("client_id", klient.id);
  zkouska("cizí čtení kontaktu", !cizErr && (cizCteni ?? []).length === 0, "cizí organizace kontakt nevidí");

  await a.from("client_contacts").update({ role: "Ředitel" }).eq("id", kontakty[0].id);
  const { data: poZmeneRole } = await a.from("client_contacts").select("role").eq("id", kontakty[0].id).single();
  zkouska("úprava kontaktu", poZmeneRole.role === "Ředitel", "funkce kontaktu jde upravit bez mazání");

  // --- 4) Smazání klienta smaže i jeho kontakty (kaskáda) -----------------
  await a.from("clients").delete().eq("id", klient.id);
  const { data: poSmazani } = await admin.from("client_contacts").select("id").eq("client_id", klient.id);
  zkouska("kaskáda", (poSmazani ?? []).length === 0, "kontakty zmizely spolu s klientem, ne osiřelé");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  for (const id of uklid.orgs) await admin.from("orgs").delete().eq("id", id);
  for (const id of uklid.users) await admin.auth.admin.deleteUser(id);
  ok(`úklid — ${uklid.orgs.length} prostorů, ${uklid.users.length} účtů`);
}

console.log(chyby === 0 ? "\nÚprava klienta i kontakty fungují a jsou izolované." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
