/**
 * Připomínky v kalendáři.
 *
 * Na rozdíl od úkolu nemají kroky ani míč — jen text, den, volitelně
 * klient a hotovo/nehotovo. Test ověřuje čtení přes `reminders_view`
 * (stejný bezpečný vzor jako `tasks_view`), práva mezi organizacemi
 * a že se v odběru do telefonu objeví jen nesplněné.
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

const dnes = () => new Date().toISOString().slice(0, 10);

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
  const a = await jakoUzivatel(`prip-a-${razitko}@example.com`);
  const b = await jakoUzivatel(`prip-b-${razitko}@example.com`);

  const { data: orgA } = await a.rpc("ensure_workspace", { p_name: "Studio A" });
  const { data: orgB } = await b.rpc("ensure_workspace", { p_name: "Studio B" });
  uklid.orgs.push(orgA, orgB);

  const { data: klient } = await admin.from("clients").insert({ org_id: orgA, name: "Pekárna U Lípy" }).select("id").single();

  // --- 1) Založení a čtení pod skutečným účtem, ne servisním klíčem ------
  const { error: cErr } = await a.from("reminders").insert({
    org_id: orgA, title: "Zavolat ohledně tiskovin", date: dnes(), client_id: klient.id,
  });
  zkouska("založení", !cErr, cErr ? cErr.message : "připomínka uložena");

  const { data: mine } = await a
    .from("reminders_view")
    .select("title, client_name, created_by_initials, done_at")
    .eq("org_id", orgA);
  zkouska("čtení", mine?.[0]?.title === "Zavolat ohledně tiskovin" && mine?.[0]?.client_name === "Pekárna U Lípy",
    "pohled spojil klienta správně");
  zkouska("nehotovo", mine?.[0]?.done_at === null, "nová připomínka je nesplněná");

  // --- 2) Cizí organizace nevidí nic --------------------------------------
  const { error: bErr } = await b.from("reminders").insert({ org_id: orgA, title: "Vetřelec", date: dnes() });
  zkouska("cizí zápis", !!bErr, "cizí organizace nesmí zapsat připomínku do studia A");

  const { data: cizi } = await b.from("reminders_view").select("title").eq("org_id", orgA);
  zkouska("cizí čtení", (cizi ?? []).length === 0, "cizí organizace nevidí připomínky studia A ani přes reminders_view");

  // --- 3) Odškrtnutí -------------------------------------------------------
  const { data: reminder } = await a.from("reminders").select("id").eq("org_id", orgA).single();
  await a.from("reminders").update({ done_at: new Date().toISOString() }).eq("id", reminder.id);
  const { data: poOdskrtnuti } = await a.from("reminders_view").select("done_at").eq("id", reminder.id).single();
  zkouska("odškrtnutí", poOdskrtnuti.done_at !== null, "splněná připomínka má razítko");

  // --- 4) Odběr do telefonu vidí jen nesplněné ----------------------------
  await a.from("reminders").insert({ org_id: orgA, title: "Ještě nesplněná", date: dnes() });
  const { data: org } = await admin.from("orgs").select("calendar_token").eq("id", orgA).single();
  const anon_client = createClient(url, anon, { auth: { persistSession: false } });
  const { data: feed } = await anon_client.rpc("public_calendar_feed", { p_token: org.calendar_token });
  const reminderEvents = (feed?.events ?? []).filter((e) => e.kind === "reminder");
  zkouska("odběr do telefonu",
    reminderEvents.length === 1 && reminderEvents[0].title === "Ještě nesplněná",
    `${reminderEvents.length} nesplněná připomínka v kanálu (splněná se nezobrazí)`);

  // --- 5) Bez přihlášení nejde nic přímo ------------------------------------
  const { data: anonPokus } = await anon_client.from("reminders").select("id").eq("org_id", orgA);
  zkouska("bez přihlášení", (anonPokus ?? []).length === 0, "anonym se k připomínkám nedostane přímo, jen přes kanál");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  for (const id of uklid.orgs) await admin.from("orgs").delete().eq("id", id);
  for (const id of uklid.users) await admin.auth.admin.deleteUser(id);
  ok(`úklid — ${uklid.orgs.length} prostorů, ${uklid.users.length} účtů`);
}

console.log(chyby === 0 ? "\nPřipomínky fungují a jsou izolované mezi organizacemi." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
