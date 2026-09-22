/**
 * Historie komunikace s klientem.
 *
 * Osa se skládá ze tří zdrojů: ruční poznámky, uzavřené úkoly a co udělal
 * klient přes svůj schvalovací odkaz (client_decide, migrace 0007). Test
 * ověřuje, že se to skládá správně, že úprava/smazání funguje jen u ruční
 * poznámky, a že cizí organizace do historie nevidí.
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
  const a = await jakoUzivatel(`hist-a-${razitko}@example.com`);
  const b = await jakoUzivatel(`hist-b-${razitko}@example.com`);

  const { data: orgA } = await a.rpc("ensure_workspace", { p_name: "Studio A" });
  const { data: orgB } = await b.rpc("ensure_workspace", { p_name: "Studio B" });
  uklid.orgs.push(orgA, orgB);

  const { data: klient } = await a.from("clients").insert({ org_id: orgA, name: "Pekárna U Lípy", color: "#B5673E" }).select("id, share_token").single();

  // Uzavřený úkol — má se objevit na ose jako "closed".
  const { data: uzavreny } = await a.from("tasks").insert({ org_id: orgA, client_id: klient.id, title: "Etikety", kind: "interni", step: 1 }).select("id").single();
  await a.from("tasks").update({ step: 2 }).eq("id", uzavreny.id);

  // Tiskový úkol na kroku "Ke schválení" — necháme klienta schválit přes
  // jeho vlastní odkaz, ať v historii vznikne skutečný client_approved
  // záznam, ne jen ručně vložený.
  const { data: kSchvaleni } = await a.from("tasks").insert({ org_id: orgA, client_id: klient.id, title: "Plakát A2", kind: "tisk", step: 2 }).select("id").single();
  const host = createClient(url, anon, { auth: { persistSession: false } });
  await host.rpc("client_decide", { p_token: klient.share_token, p_task: kSchvaleni.id, p_approve: true, p_note: null });

  // Ruční poznámka.
  const { error: nErr } = await a.from("client_notes").insert({ org_id: orgA, client_id: klient.id, body: "Volali jsme, chtějí nabídku do pátku." });
  zkouska("poznámka založena", !nErr, nErr ? nErr.message : "uložena");

  // --- Poskládání osy (přes stejné dotazy jako lib/client-timeline.ts) ---
  const { data: notes } = await a.from("client_notes_view").select("id, body, created_at, created_by_initials").eq("client_id", klient.id);
  const { data: tasks } = await a.from("tasks_view").select("id, title, ball, closed_at, updated_at").eq("client_id", klient.id);
  const { data: events } = await a.from("task_events").select("task_id, kind, detail, at").in("task_id", tasks.map((t) => t.id)).in("kind", ["client_approved", "client_changes"]);

  zkouska("poznámka ve čtení", notes?.[0]?.body === "Volali jsme, chtějí nabídku do pátku.", "reminders_view analogie funguje i pro klienty");
  zkouska("uzavřený úkol", tasks.some((t) => t.id === uzavreny.id && t.ball === "done"), "úkol je v tasks_view veden jako hotový");
  zkouska("schválení klientem", events?.some((e) => e.kind === "client_approved" && e.task_id === kSchvaleni.id), "client_decide zapsal schválení, historie ho najde");

  // --- Úprava a smazání poznámky ------------------------------------------
  const { data: noteRow } = await a.from("client_notes").select("id").eq("client_id", klient.id).single();
  await a.from("client_notes").update({ body: "Upraveno." }).eq("id", noteRow.id);
  const { data: poUprave } = await a.from("client_notes").select("body").eq("id", noteRow.id).single();
  zkouska("úprava poznámky", poUprave.body === "Upraveno.", "jde upravit bez mazání a zakládání znovu");

  // --- Cizí organizace nevidí nic -----------------------------------------
  const { data: cizi } = await b.from("client_notes_view").select("id").eq("client_id", klient.id);
  zkouska("cizí čtení", (cizi ?? []).length === 0, "cizí organizace poznámky klienta nevidí");

  const { error: bErr } = await b.from("client_notes").insert({ org_id: orgA, client_id: klient.id, body: "Vetřelec" });
  zkouska("cizí zápis", !!bErr, "cizí organizace nesmí zapsat poznámku do studia A");

  await a.from("client_notes").delete().eq("id", noteRow.id);
  const { data: poSmazani } = await a.from("client_notes").select("id").eq("id", noteRow.id);
  zkouska("smazání poznámky", (poSmazani ?? []).length === 0, "poznámka zmizela");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  for (const id of uklid.orgs) await admin.from("orgs").delete().eq("id", id);
  for (const id of uklid.users) await admin.auth.admin.deleteUser(id);
  ok(`úklid — ${uklid.orgs.length} prostorů, ${uklid.users.length} účtů`);
}

console.log(chyby === 0 ? "\nHistorie se skládá správně a je izolovaná mezi organizacemi." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
