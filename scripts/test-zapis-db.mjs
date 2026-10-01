/**
 * Rychlý zápis a hlavní klient — databázová část (migrace 0017 + chování,
 * na kterém hromadné založení stojí).
 *
 * Tři věci, na kterých to visí:
 *  1) hromadný zápis je všechno, nebo nic — jeden špatný řádek nesmí nechat
 *     v databázi polovinu úkolů,
 *  2) úkol založený rovnou jako hotový si drží `closed_at`, který dostal při
 *     založení — report počítá uzavřené právě podle něj,
 *  3) příznak hlavního klienta jde nastavit a nikdo cizí na něj nesáhne.
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
  const A = await jakoUzivatel(`zapis-a-${razitko}@example.com`);
  const B = await jakoUzivatel(`zapis-b-${razitko}@example.com`);
  const a = A.klient;
  const b = B.klient;

  const { data: orgA } = await a.rpc("ensure_workspace", { p_name: "Studio A" });
  const { data: orgB } = await b.rpc("ensure_workspace", { p_name: "Studio B" });
  uklid.orgs.push(orgA, orgB);

  const pocet = async () => (await admin.from("tasks").select("id", { count: "exact", head: true }).eq("org_id", orgA)).count ?? 0;
  const radek = (over) => ({ org_id: orgA, created_by: A.userId, assignee_id: A.userId, title: "Úkol", kind: "interni", step: 0, size: 2, ...over });

  // =========================== HROMADNÉ ZALOŽENÍ ================================
  const predemnou = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const { error: hErr } = await a.from("tasks").insert([
    radek({ title: "Rozdělaný", step: 1 }),
    radek({ title: "Hotový dnes", kind: "tisk", step: 5, closed_at: new Date().toISOString() }),
    radek({ title: "Hotový před třemi dny", kind: "klient", step: 3, closed_at: `${predemnou}T12:00:00.000Z` }),
  ]);
  zkouska("hromadné založení", !hErr && (await pocet()) === 3, hErr ? hErr.message : "tři úkoly najednou jedním zápisem");

  const { data: pohled } = await a.from("tasks_view").select("title, ball, closed_at").eq("org_id", orgA);
  const podle = Object.fromEntries((pohled ?? []).map((t) => [t.title, t]));
  zkouska("hotové zůstanou hotové", podle["Hotový dnes"]?.ball === "done" && podle["Hotový před třemi dny"]?.ball === "done" && podle["Rozdělaný"]?.ball === "me",
    "úkol založený na posledním kroku je uzavřený, rozdělaný ne");
  zkouska("razítko uzavření", podle["Hotový před třemi dny"]?.closed_at?.slice(0, 10) === predemnou && podle["Rozdělaný"]?.closed_at === null,
    "den dokončení se zachoval, otevřený úkol razítko nemá");

  // Všechno, nebo nic: poslední řádek je neplatný (interní nemá krok 9).
  const pred = await pocet();
  const { error: vErr } = await a.from("tasks").insert([
    radek({ title: "Dobrý 1" }),
    radek({ title: "Dobrý 2" }),
    radek({ title: "Špatný krok", step: 9 }),
  ]);
  zkouska("všechno, nebo nic", !!vErr && (await pocet()) === pred, "jeden neplatný řádek = nezaložil se žádný");

  // =========================== HLAVNÍ KLIENT ========================================
  const { data: kl } = await a
    .from("clients")
    .insert([{ org_id: orgA, name: "Běžný", color: "#B5673E" }, { org_id: orgA, name: "Hlavní", color: "#3E7AB5" }])
    .select("id, name, is_priority");
  zkouska("výchozí hodnota", kl?.every((k) => k.is_priority === false), "klient hlavní není, dokud to neřekneš");

  const hlavni = kl.find((k) => k.name === "Hlavní");
  const { data: nastaveno } = await a.from("clients").update({ is_priority: true }).eq("id", hlavni.id).select("is_priority");
  zkouska("nastavení", nastaveno?.[0]?.is_priority === true, "příznak jde zapnout");

  const { data: serazeno } = await a.from("clients").select("name").eq("org_id", orgA).order("is_priority", { ascending: false }).order("name");
  zkouska("řazení", serazeno?.[0]?.name === "Hlavní", "hlavní klient stojí první i před abecedně dřívějším");

  const { data: ciziZapis } = await b.from("clients").update({ is_priority: false }).eq("id", hlavni.id).select("id");
  const { data: po } = await a.from("clients").select("is_priority").eq("id", hlavni.id).single();
  zkouska("cizí organizace", (ciziZapis ?? []).length === 0 && po.is_priority === true, "cizí studio příznak nepřepsalo");

  const { data: idcka } = await a.from("clients").select("id").eq("org_id", orgA).eq("is_priority", true).eq("archived", false);
  zkouska("dotaz pro Dnes", idcka?.length === 1 && idcka[0].id === hlavni.id, "výběr hlavních klientů vrací jen toho jednoho");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  for (const id of uklid.orgs) await admin.from("orgs").delete().eq("id", id);
  for (const id of uklid.users) await admin.auth.admin.deleteUser(id);
  ok(`úklid — ${uklid.orgs.length} prostorů, ${uklid.users.length} účtů`);
}

console.log(chyby === 0 ? "\nHromadný zápis a hlavní klient fungují a jsou soukromé." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
