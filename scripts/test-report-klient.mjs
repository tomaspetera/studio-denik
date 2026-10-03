/**
 * Report pro jednoho klienta — databázová část (migrace 0020).
 *
 * Za jeden týden smí existovat jeden report za celé studio a k němu nejvýš
 * jeden na každého klienta. Každý má vlastní text i vlastní sdílený odkaz,
 * takže se nesmí navzájem přepsat ani splést — a veřejný odkaz na report
 * pro klienta musí vydat jeho snímek, ne snímek celého studia.
 *
 * Běží pod skutečně přihlášenými účty, ne servisním klíčem.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const host = createClient(url, anon, { auth: { persistSession: false } });
const razitko = Date.now();
const HESLO = "Zkouska-" + razitko;

const ok = (s) => console.log("  " + s);
const uklid = { users: [], orgs: [] };
let chyby = 0;

const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(26)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(26)}ŠPATNĚ — ${popis}`); }
};

async function jakoUzivatel(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: HESLO, email_confirm: true });
  if (error) throw new Error(`účet ${email}: ${error.message}`);
  uklid.users.push(data.user.id);
  const klient = createClient(url, anon, { auth: { persistSession: false } });
  const { error: sErr } = await klient.auth.signInWithPassword({ email, password: HESLO });
  if (sErr) throw new Error(`přihlášení ${email}: ${sErr.message}`);
  return { klient, userId: data.user.id };
}

try {
  const A = await jakoUzivatel(`report-a-${razitko}@example.com`);
  const C = await jakoUzivatel(`report-c-${razitko}@example.com`);

  const { data: orgA } = await A.klient.rpc("ensure_workspace", { p_name: "Studio A" });
  const { data: orgC } = await C.klient.rpc("ensure_workspace", { p_name: "Studio C" });
  uklid.orgs.push(orgA, orgC);

  const { data: klienti, error: kErr } = await A.klient
    .from("clients")
    .insert([{ org_id: orgA, name: "ULTRA MARINE EUROPE s.r.o." }, { org_id: orgA, name: "Pekárna U Lípy" }])
    .select("id, name");
  if (kErr) throw new Error(`klienti: ${kErr.message}`);
  const ume = klienti.find((k) => k.name.startsWith("ULTRA")).id;
  const lipa = klienti.find((k) => k.name.startsWith("Pek")).id;

  const TYDEN = { period: "week", starts_on: "2026-09-28", ends_on: "2026-10-04", label: "2026-W40" };
  const report = (over = {}) => ({ org_id: orgA, ...TYDEN, ai_summary: "Text.", ...over });

  // --- Jeden za studio, jeden na klienta ------------------------------------------
  const { data: zaStudio, error: sErr } = await A.klient.from("reports").insert(report({ ai_summary: "Za celé studio." })).select("id, client_id").single();
  zkouska("report za studio", !sErr && zaStudio?.client_id === null, sErr ? sErr.message : "uloží se bez klienta");

  const { data: proUme, error: uErr } = await A.klient.from("reports").insert(report({ client_id: ume, ai_summary: "Jen pro Ultra Marine." })).select("id, share_token").single();
  zkouska("report pro klienta", !uErr && !!proUme?.id, uErr ? uErr.message : "ve stejném týdnu vedle reportu za studio");

  const { error: lErr } = await A.klient.from("reports").insert(report({ client_id: lipa, ai_summary: "Jen pro Lípu." }));
  zkouska("druhý klient", !lErr, lErr ? lErr.message : "každý klient má svůj");

  const { error: dvakratStudio } = await A.klient.from("reports").insert(report());
  zkouska("studio dvakrát", !!dvakratStudio, "druhý report za studio ve stejném týdnu se odmítne");

  const { error: dvakratKlient } = await A.klient.from("reports").insert(report({ client_id: ume }));
  zkouska("klient dvakrát", !!dvakratKlient, "druhý report pro stejného klienta a týden se odmítne");

  const { error: jinyTyden } = await A.klient.from("reports").insert(report({ client_id: ume, starts_on: "2026-10-05", ends_on: "2026-10-11", label: "2026-W41" }));
  zkouska("jiný týden", !jinyTyden, jinyTyden ? jinyTyden.message : "další týden má klient nový report");

  // --- Čtení: každý dostane ten svůj ------------------------------------------------
  const { data: cteniStudio } = await A.klient.from("reports").select("ai_summary").eq("org_id", orgA).eq("starts_on", TYDEN.starts_on).is("client_id", null);
  zkouska("čtení: studio", cteniStudio?.length === 1 && cteniStudio[0].ai_summary === "Za celé studio.", "bez klienta se najde právě report za studio");

  const { data: cteniUme } = await A.klient.from("reports").select("ai_summary").eq("org_id", orgA).eq("starts_on", TYDEN.starts_on).eq("client_id", ume);
  zkouska("čtení: klient", cteniUme?.length === 1 && cteniUme[0].ai_summary === "Jen pro Ultra Marine.", "s klientem se najde právě ten jeho");

  // Úprava jednoho se nesmí propsat do druhého.
  await A.klient.from("reports").update({ ai_summary: "Přepsaný text pro Ultra Marine." }).eq("id", proUme.id);
  const { data: poUprave } = await A.klient.from("reports").select("ai_summary, client_id").eq("org_id", orgA).eq("starts_on", TYDEN.starts_on);
  zkouska("úprava jen svého", poUprave?.find((r) => r.client_id === null)?.ai_summary === "Za celé studio." && poUprave?.find((r) => r.client_id === lipa)?.ai_summary === "Jen pro Lípu.", "report za studio ani pro jiného klienta se nezměnil");

  // --- Cizí studio --------------------------------------------------------------------
  const { data: cizi } = await C.klient.from("reports").select("id").eq("org_id", orgA);
  zkouska("cizí studio: čtení", (cizi ?? []).length === 0, "člověk z jiného studia reporty nevidí");

  const { error: podvrh } = await C.klient.from("reports").insert(report({ client_id: ume, starts_on: "2026-10-12", ends_on: "2026-10-18" }));
  zkouska("cizí studio: zápis", !!podvrh, "ani je do cizího studia nezaloží");

  // --- Veřejný odkaz vydá snímek klienta ---------------------------------------------
  let { data: verejny } = await host.rpc("public_report", { p_token: proUme.share_token });
  zkouska("odkaz: koncept", !verejny, "nepublikovaný report pro klienta se nevydá");

  const snimek = {
    rangeText: "28. září – 4. října 2026",
    scopeClient: "ULTRA MARINE EUROPE s.r.o.",
    counts: { done: 2, me: 1, client: 1, supplier: 1, late: 1 },
    byCategory: [],
    byClient: [{ client: "ULTRA MARINE EUROPE s.r.o.", percent: 100, items: [{ title: "Katalog jaro, sazba", ball: "done", stepName: "Hotovo", supplierName: null, isLate: false }] }],
    waiting: [],
  };
  await A.klient.from("reports").update({ status: "published", published_at: new Date().toISOString(), snapshot: snimek }).eq("id", proUme.id);

  ({ data: verejny } = await host.rpc("public_report", { p_token: proUme.share_token }));
  zkouska("odkaz: publikovaný", verejny?.summary === "Přepsaný text pro Ultra Marine." && verejny?.snapshot?.scopeClient === "ULTRA MARINE EUROPE s.r.o." && verejny?.snapshot?.byClient?.length === 1, "vydá text a snímek toho klienta, ne celého studia");

  const { data: tokenStudia } = await A.klient.from("reports").select("share_token").eq("id", zaStudio.id).single();
  zkouska("odkaz: vlastní token", tokenStudia.share_token !== proUme.share_token, "report pro klienta má jiný odkaz než report za studio");

  // --- Smazání klienta ----------------------------------------------------------------
  await A.klient.from("clients").delete().eq("id", lipa);
  const { data: poSmazani } = await admin.from("reports").select("client_id").eq("org_id", orgA).eq("starts_on", TYDEN.starts_on);
  zkouska("smazaný klient", poSmazani?.length === 2 && !poSmazani.some((r) => r.client_id === lipa) && poSmazani.some((r) => r.client_id === null), "jeho report zmizí s ním, ostatní zůstanou");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  for (const id of uklid.orgs) await admin.from("orgs").delete().eq("id", id);
  for (const id of uklid.users) await admin.auth.admin.deleteUser(id);
  ok(`úklid — ${uklid.orgs.length} prostorů, ${uklid.users.length} účtů`);
}

console.log(chyby === 0 ? "\nReport pro klienta: jedinečnost, čtení i odkaz drží." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
