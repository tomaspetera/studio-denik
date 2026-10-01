/**
 * Šablony úkolů a opakované úkoly — databázová část (migrace 0016).
 *
 * Hlavní věc je funkce `create_due_recurring_tasks`: musí založit úkol
 * právě jednou (ani dvojí spuštění ho nezduplikuje), dohnat výpadek cronu,
 * nezačít zpětně před vznikem pravidla, nevracet smazaný úkol a nesahat
 * do cizí organizace. Všechno pod skutečnými účty, ne servisním klíčem.
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

// --- Dny (pražské "dnes" a UTC aritmetika, stejně jako v appce) ----------------
const dnes = (() => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
})();
const pridej = (key, n) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const isoDen = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
};
const denVMesici = (key) => Number(key.split("-")[2]);

try {
  const A = await jakoUzivatel(`sablony-a-${razitko}@example.com`);
  const B = await jakoUzivatel(`sablony-b-${razitko}@example.com`);
  const a = A.klient;
  const b = B.klient;

  const { data: orgA } = await a.rpc("ensure_workspace", { p_name: "Studio A" });
  const { data: orgB } = await b.rpc("ensure_workspace", { p_name: "Studio B" });
  uklid.orgs.push(orgA, orgB);

  const vyma = async () => {
    await admin.from("tasks").delete().eq("org_id", orgA);
    await admin.from("recurring_tasks").delete().eq("org_id", orgA);
  };
  const spust = (klient, org, den, zpet = 0) =>
    klient.rpc("create_due_recurring_tasks", { p_org: org, p_today: den, p_days_back: zpet });
  const ukoly = async (nazev) =>
    (await admin.from("tasks").select("id, title, kind, step, size, due_at, assignee_id, created_by").eq("org_id", orgA).eq("title", nazev)).data ?? [];
  const pravidlo = (over) =>
    a.from("recurring_tasks").insert({ org_id: orgA, created_by: A.userId, title: "Pravidlo", kind: "interni", frequency: "weekly", weekday: isoDen(dnes), ...over }).select("id").single();

  // =========================== ŠABLONY ==========================================
  const { data: sab, error: sErr } = await a
    .from("task_templates")
    .insert({ org_id: orgA, title: "Letáky A5", kind: "tisk", size: 3, due_offset_days: 7 })
    .select("id, kind, size, due_offset_days")
    .single();
  zkouska("šablona: založení", !sErr && sab.kind === "tisk" && sab.size === 3 && sab.due_offset_days === 7, "uložila se se všemi poli");

  await a.from("task_templates").update({ title: "Letáky A4", due_offset_days: null }).eq("id", sab.id);
  const { data: sabPo } = await a.from("task_templates").select("title, due_offset_days").eq("id", sab.id).single();
  zkouska("šablona: úprava", sabPo.title === "Letáky A4" && sabPo.due_offset_days === null, "název se změnil, termín jde smazat");

  const { error: prazdny } = await a.from("task_templates").insert({ org_id: orgA, title: "   " });
  const { error: velky } = await a.from("task_templates").insert({ org_id: orgA, title: "X", size: 4 });
  const { error: dlouhy } = await a.from("task_templates").insert({ org_id: orgA, title: "X", due_offset_days: 366 });
  zkouska("šablona: pravidla", !!prazdny && !!velky && !!dlouhy, "prázdný název, velikost 4 a termín 366 dní databáze odmítne");

  const { data: ciziCteni } = await b.from("task_templates").select("id").eq("org_id", orgA);
  const { data: ciziZapis } = await b.from("task_templates").update({ title: "Podvrh" }).eq("id", sab.id).select("id");
  const { data: ciziMazani } = await b.from("task_templates").delete().eq("id", sab.id).select("id");
  zkouska("šablona: cizí organizace", (ciziCteni ?? []).length === 0 && (ciziZapis ?? []).length === 0 && (ciziMazani ?? []).length === 0, "cizí studio ji nevidí, nepřepíše ani nesmaže");

  // =========================== TVAR PRAVIDLA ====================================
  const e1 = (await a.from("recurring_tasks").insert({ org_id: orgA, title: "X", frequency: "weekly" })).error;
  const e2 = (await a.from("recurring_tasks").insert({ org_id: orgA, title: "X", frequency: "weekly", weekday: 2, month_day: 10 })).error;
  const e3 = (await a.from("recurring_tasks").insert({ org_id: orgA, title: "X", frequency: "monthly", month_day: 29 })).error;
  const e4 = (await a.from("recurring_tasks").insert({ org_id: orgA, title: "X", frequency: "monthly", month_day: 10, weekday: 2 })).error;
  const e5 = (await a.from("recurring_tasks").insert({ org_id: orgA, title: "X", frequency: "weekly", weekday: 8 })).error;
  zkouska("pravidlo: tvar", !!e1 && !!e2 && !!e3 && !!e4 && !!e5, "týdně bez dne, smíšené dny, 29. v měsíci i den 8 databáze odmítne");

  // =========================== FUNKCE: ZALOŽENÍ ===================================
  await pravidlo({ title: "Týdenní report", due_offset_days: 3 });
  const { data: n1, error: fErr } = await spust(a, orgA, dnes);
  zkouska("funkce: založí", !fErr && n1 === 1, "pravidlo na dnešní den založí jeden úkol");

  const u1 = await ukoly("Týdenní report");
  zkouska("úkol: pole", u1.length === 1 && u1[0].kind === "interni" && u1[0].step === 0 && u1[0].assignee_id === A.userId && u1[0].created_by === A.userId,
    "typ, krok „Zadáno“ a vlastník jsou podle pravidla");
  zkouska("úkol: termín", u1[0]?.due_at?.slice(0, 10) === pridej(dnes, 3) && u1[0].due_at.slice(11, 19) === "00:00:00", "termín = dnes + 3 dny, půlnoc UTC jako u ručních úkolů");

  const { data: n2 } = await spust(a, orgA, dnes);
  zkouska("funkce: podruhé", n2 === 0 && (await ukoly("Týdenní report")).length === 1, "druhé spuštění nic nezduplikuje");

  // =========================== NEZASAHUJE ====================================================
  await a.from("tasks").delete().eq("id", u1[0].id);
  const { data: n3 } = await spust(a, orgA, dnes);
  zkouska("smazaný úkol", n3 === 0 && (await ukoly("Týdenní report")).length === 0, "smazaný úkol se ten den nevrátí");

  await vyma();
  await pravidlo({ title: "Cizí zkouška" });
  const { data: nCizi } = await spust(b, orgA, dnes);
  zkouska("cizí organizace", nCizi === 0 && (await ukoly("Cizí zkouška")).length === 0, "účet z jiného studia úkol nezaloží");
  const { data: nVlastni } = await spust(a, orgA, dnes);
  zkouska("vlastní organizace", nVlastni === 1, "vlastní účet ho založí hned potom");
  const { data: ciziPravidla } = await b.from("recurring_tasks").select("id").eq("org_id", orgA);
  zkouska("cizí čtení pravidel", (ciziPravidla ?? []).length === 0, "cizí studio pravidla nevidí");

  // =========================== POZASTAVENO, BEZ TERMÍNU ===============================
  await vyma();
  await pravidlo({ title: "Pozastavené", active: false });
  const { data: nPoz } = await spust(a, orgA, dnes);
  zkouska("pozastavené pravidlo", nPoz === 0, "neaktivní pravidlo nezakládá");

  await vyma();
  await pravidlo({ title: "Bez termínu" });
  await spust(a, orgA, dnes);
  const [bez] = await ukoly("Bez termínu");
  zkouska("bez termínu", bez?.due_at === null, "prázdný termín pravidla = úkol bez termínu");

  // =========================== MĚSÍČNĚ ================================================
  await vyma();
  let k = 1;
  while (denVMesici(pridej(dnes, k)) > 28) k++;
  const mesicni = pridej(dnes, k);
  await pravidlo({ title: "Měsíční", frequency: "monthly", weekday: null, month_day: denVMesici(mesicni) });
  const { data: nMes0 } = await spust(a, orgA, dnes);
  const { data: nMes1 } = await spust(a, orgA, mesicni);
  zkouska("měsíčně", nMes0 === 0 && nMes1 === 1, "v jiný den nic, v den v měsíci právě jeden úkol");

  // =========================== ZPĚTNĚ A DOHÁNĚNÍ ======================================
  await vyma();
  await pravidlo({ title: "Dnes založené", weekday: isoDen(pridej(dnes, -1)) });
  const { data: nZpet } = await spust(a, orgA, dnes, 2);
  zkouska("nezačne zpětně", nZpet === 0, "pravidlo založené dnes nevyrobí úkol z předchozích dnů");

  await vyma();
  const { data: stare } = await admin
    .from("recurring_tasks")
    .insert({ org_id: orgA, created_by: A.userId, title: "Zameškaný pátek", kind: "interni", frequency: "weekly", weekday: isoDen(pridej(dnes, -1)), created_at: new Date(Date.now() - 10 * 86_400_000).toISOString() })
    .select("id")
    .single();
  const { data: nBezDoh } = await spust(a, orgA, dnes, 0);
  const { data: nDoh } = await spust(a, orgA, dnes, 2);
  const { data: nDoh2 } = await spust(a, orgA, dnes, 2);
  const { data: beh } = await admin.from("recurring_task_runs").select("run_on, task_id").eq("recurring_id", stare.id);
  zkouska("dohánění výpadku", nBezDoh === 0 && nDoh === 1 && nDoh2 === 0, "včerejšek se dožene jen s okénkem a jen jednou");
  zkouska("záznam o výskytu", beh?.length === 1 && beh[0].run_on === pridej(dnes, -1) && !!beh[0].task_id, "zapsal se den výskytu i vzniklý úkol");

  // Smazání pravidla uklidí záznamy o výskytech.
  await a.from("recurring_tasks").delete().eq("id", stare.id);
  const { data: begPo } = await admin.from("recurring_task_runs").select("run_on").eq("recurring_id", stare.id);
  zkouska("smazání pravidla", (begPo ?? []).length === 0, "záznamy o výskytech zmizely s pravidlem");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  for (const id of uklid.orgs) await admin.from("orgs").delete().eq("id", id);
  for (const id of uklid.users) await admin.auth.admin.deleteUser(id);
  ok(`úklid — ${uklid.orgs.length} prostorů, ${uklid.users.length} účtů`);
}

console.log(chyby === 0 ? "\nŠablony a opakované úkoly fungují a jsou soukromé." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
