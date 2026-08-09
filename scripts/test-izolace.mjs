/**
 * Izolace organizací.
 *
 * Nejdůležitější test celé aplikace: člověk z jedné organizace nesmí vidět
 * data jiné. Ověřuje se to pod skutečnými účty, ne servisním klíčem.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ok = (s) => console.log("  " + s);
const razitko = Date.now();
const HESLO = "Zkouska-" + razitko;
let chyby = 0;
const uklid = { users: [], orgs: [] };

async function jakoUzivatel(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: HESLO, email_confirm: true,
  });
  if (error) throw new Error(`účet ${email}: ${error.message}`);
  uklid.users.push(data.user.id);

  const klient = createClient(url, anon, { auth: { persistSession: false } });
  const { error: sErr } = await klient.auth.signInWithPassword({ email, password: HESLO });
  if (sErr) throw new Error(`přihlášení ${email}: ${sErr.message}`);
  return klient;
}

try {
  // Dva lidé, každý ve vlastní organizaci.
  const a = await jakoUzivatel(`a+${razitko}@example.com`);
  const b = await jakoUzivatel(`b+${razitko}@example.com`);

  const { data: orgA } = await a.rpc("ensure_workspace", { p_name: "Studio A" });
  const { data: orgB } = await b.rpc("ensure_workspace", { p_name: "Studio B" });
  uklid.orgs.push(orgA, orgB);

  if (orgA === orgB) throw new Error("oba skončili ve stejném prostoru");
  ok("příprava        ok — dva lidé, dva oddělené prostory");

  // Do A dáme tajemství.
  await admin.from("clients").insert({ org_id: orgA, name: "Tajný klient A" });
  await admin.from("tasks").insert({ org_id: orgA, title: "Tajný úkol A", kind: "interni" });
  await admin.from("suppliers").insert({ org_id: orgA, name: "Tajná tiskárna A" });

  const zkouska = async (nazev, dotaz, hledej) => {
    const { data, error } = await dotaz;
    if (error) { ok(`${nazev.padEnd(15)} ok — dotaz odmítnut (${error.code ?? "chyba"})`); return; }
    const uniklo = (data ?? []).filter((r) => JSON.stringify(r).includes(hledej));
    if (uniklo.length > 0) {
      chyby++;
      ok(`${nazev.padEnd(15)} ÚNIK — B vidí ${uniklo.length} záznamů z A`);
    } else {
      ok(`${nazev.padEnd(15)} ok — B nevidí nic z A`);
    }
  };

  await zkouska("tasks",      b.from("tasks").select("title"),            "Tajný úkol A");
  await zkouska("tasks_view", b.from("tasks_view").select("title"),       "Tajný úkol A");
  await zkouska("clients",    b.from("clients").select("name"),           "Tajný klient A");
  await zkouska("suppliers",  b.from("suppliers").select("name"),         "Tajná tiskárna A");
  await zkouska("orgs",       b.from("orgs").select("name"),              "Studio A");
  await zkouska("team_view",  b.from("team_view").select("email"),        `a+${razitko}`);

  // Cílený dotaz na cizí organizaci — kdyby filtr chyběl jinde.
  await zkouska(
    "cílený dotaz",
    b.from("tasks_view").select("title").eq("org_id", orgA),
    "Tajný úkol A",
  );
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  for (const id of uklid.orgs) if (id) await admin.from("orgs").delete().eq("id", id);
  for (const id of uklid.users) await admin.auth.admin.deleteUser(id).catch(() => {});
  ok(`úklid — ${uklid.orgs.length} prostorů, ${uklid.users.length} účtů`);
}

console.log(
  chyby === 0
    ? "\nOrganizace jsou oddělené."
    : `\nÚNIK DAT — problémů: ${chyby}`,
);
process.exit(chyby === 0 ? 0 : 1);
