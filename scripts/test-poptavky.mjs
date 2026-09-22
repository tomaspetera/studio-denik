/**
 * Poptávky a nabídky (pipeline) — krok před založeným klientem.
 *
 * Ověřuje čtyři stavy, razítkování `decided_at`, izolaci mezi organizacemi
 * a hlavně převod vyhrané poptávky na klienta: jméno/kontakt se přenesou,
 * poptávka zůstane (jen ví, kam vedla) a v historii nového klienta vznikne
 * první záznam.
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
  const a = await jakoUzivatel(`lead-a-${razitko}@example.com`);
  const b = await jakoUzivatel(`lead-b-${razitko}@example.com`);

  const { data: orgA } = await a.rpc("ensure_workspace", { p_name: "Studio A" });
  const { data: orgB } = await b.rpc("ensure_workspace", { p_name: "Studio B" });
  uklid.orgs.push(orgA, orgB);

  // --- 1) Založení s výchozím stavem ---------------------------------------
  const { data: lead, error: cErr } = await a
    .from("leads")
    .insert({ org_id: orgA, name: "Vizuální identita", company: "Nová kavárna", contact: "Jana Nováková", email: "jana@novakavarna.cz", amount: 35000 })
    .select("id, status, decided_at")
    .single();
  zkouska("založení", !cErr && lead.status === "poptavka" && lead.decided_at === null, "výchozí stav je poptávka, bez rozhodnutí");

  // --- 2) Posun na nabídku, pak na vyhráno --------------------------------
  await a.from("leads").update({ status: "nabidka" }).eq("id", lead.id);
  await a.from("leads").update({ status: "vyhrano", decided_at: new Date().toISOString() }).eq("id", lead.id);
  const { data: poVyhre } = await a.from("leads").select("status, decided_at").eq("id", lead.id).single();
  zkouska("vyhráno", poVyhre.status === "vyhrano" && poVyhre.decided_at !== null, "razítko rozhodnutí se zapsalo");

  // --- 3) Cizí organizace nevidí ani nesmí zapsat -------------------------
  const { data: cizi } = await b.from("leads").select("id").eq("org_id", orgA);
  zkouska("cizí čtení", (cizi ?? []).length === 0, "cizí organizace poptávky studia A nevidí");

  const { error: bErr } = await b.from("leads").update({ status: "prohrano" }).eq("id", lead.id);
  const { data: poPokusu } = await a.from("leads").select("status").eq("id", lead.id).single();
  zkouska("cizí zápis", poPokusu.status === "vyhrano", "cizí organizace stav nepřepsala" + (bErr ? "" : " (tiše nic nezměnila)"));

  // --- 4) Převod na klienta -------------------------------------------------
  const { data: pred } = await a.from("clients").select("id").eq("org_id", orgA);
  zkouska("před převodem", (pred ?? []).length === 0, "klient zatím neexistuje");

  const { data: existing } = await a.from("clients").select("color").eq("org_id", orgA);
  const usedColors = (existing ?? []).map((c) => c.color);

  const { data: novyKlient, error: ncErr } = await a
    .from("clients")
    .insert({ org_id: orgA, name: lead.company ?? "Nová kavárna", color: "#B5673E", contact: "Jana Nováková", email: "jana@novakavarna.cz" })
    .select("id")
    .single();
  zkouska("klient založen", !ncErr, ncErr ? ncErr.message : `barva zatím nepoužitá: ${!usedColors.includes("#B5673E")}`);

  await a.from("leads").update({ client_id: novyKlient.id }).eq("id", lead.id);
  await a.from("client_notes").insert({ org_id: orgA, client_id: novyKlient.id, body: `Vznikl z poptávky „Vizuální identita“ (35 000 Kč).` });

  const { data: poptavkaPoPrevodu } = await a.from("leads").select("client_id").eq("id", lead.id).single();
  zkouska("poptávka zůstala", poptavkaPoPrevodu.client_id === novyKlient.id, "poptávka existuje dál a ví, kam vedla");

  const { data: poznamky } = await a.from("client_notes_view").select("body").eq("client_id", novyKlient.id);
  zkouska("záznam v historii", poznamky?.[0]?.body?.includes("Vizuální identita"), "nový klient má v historii, odkud se vzal");

  // --- 5) Smazání poptávky nemaže klienta -----------------------------------
  await a.from("leads").delete().eq("id", lead.id);
  const { data: klientPoSmazani } = await a.from("clients").select("id").eq("id", novyKlient.id);
  zkouska("smazání poptávky", (klientPoSmazani ?? []).length === 1, "klient zůstal, i když se poptávka, ze které vznikl, smazala");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  for (const id of uklid.orgs) await admin.from("orgs").delete().eq("id", id);
  for (const id of uklid.users) await admin.auth.admin.deleteUser(id);
  ok(`úklid — ${uklid.orgs.length} prostorů, ${uklid.users.length} účtů`);
}

console.log(chyby === 0 ? "\nPoptávky fungují, převod na klienta funguje, izolace drží." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
