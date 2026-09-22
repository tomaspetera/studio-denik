/**
 * Nepřítomnost týmu a kapacita bez hodin.
 *
 * Appka nikdy netrackovala hodiny — kapacita se počítá z počtu a velikosti
 * otevřených úkolů na osobu (lib/capacity.ts), žádná nová tabulka na to
 * netřeba. Test proto ověřuje hlavně to, co nové je: evidenci nepřítomnosti,
 * jak s ní počítá kapacita, a izolaci mezi organizacemi.
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
const zaXdni = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

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
  const a = await jakoUzivatel(`abs-a-${razitko}@example.com`);
  const b = await jakoUzivatel(`abs-b-${razitko}@example.com`);

  const { data: orgA } = await a.klient.rpc("ensure_workspace", { p_name: "Studio A" });
  const { data: orgB } = await b.klient.rpc("ensure_workspace", { p_name: "Studio B" });
  uklid.orgs.push(orgA, orgB);

  // --- 1) Zápis nepřítomnosti — od dnes na 3 dny ---------------------------
  const { data: absence, error: cErr } = await a.klient
    .from("absences")
    .insert({ org_id: orgA, user_id: a.userId, from_date: dnes(), to_date: zaXdni(2), note: "Dovolená" })
    .select("id")
    .single();
  zkouska("založení", !cErr, cErr ? cErr.message : "nepřítomnost uložena");

  // --- 2) Konec před začátkem databáze odmítne ----------------------------
  const { error: rangeErr } = await a.klient
    .from("absences")
    .insert({ org_id: orgA, user_id: a.userId, from_date: zaXdni(5), to_date: dnes() });
  zkouska("neplatný rozsah", !!rangeErr, "konec před začátkem databáze odmítla (check constraint)");

  // --- 3) Cizí organizace nevidí ani nesmí zapsat -------------------------
  const { data: cizi } = await b.klient.from("absences").select("id").eq("org_id", orgA);
  zkouska("cizí čtení", (cizi ?? []).length === 0, "cizí organizace nepřítomnost studia A nevidí");

  const { error: bErr } = await b.klient.from("absences").insert({ org_id: orgA, user_id: b.userId, from_date: dnes(), to_date: dnes() });
  zkouska("cizí zápis", !!bErr, "cizí organizace nesmí zapsat nepřítomnost do studia A");

  // --- 4) Kapacita: otevřené úkoly podle velikosti ------------------------
  await a.klient.from("tasks").insert([
    { org_id: orgA, title: "Malý úkol", kind: "interni", step: 1, size: 1, assignee_id: a.userId },
    { org_id: orgA, title: "Velký úkol", kind: "interni", step: 1, size: 3, assignee_id: a.userId },
    { org_id: orgA, title: "Hotový úkol", kind: "interni", step: 2, size: 3, assignee_id: a.userId },
  ]);
  const { data: openTasks } = await a.klient
    .from("tasks_view")
    .select("assignee_id, ball, size")
    .eq("org_id", orgA)
    .eq("assignee_id", a.userId);
  const open = (openTasks ?? []).filter((t) => t.ball !== "done");
  const loadSize = open.reduce((s, t) => s + t.size, 0);
  zkouska("kapacita", open.length === 2 && loadSize === 4, `${open.length} otevřené úkoly, součet velikostí ${loadSize} (hotový se nepočítá)`);

  // --- 5) Smazání nepřítomnosti --------------------------------------------
  await a.klient.from("absences").delete().eq("id", absence.id);
  const { data: poSmazani } = await a.klient.from("absences").select("id").eq("id", absence.id);
  zkouska("smazání", (poSmazani ?? []).length === 0, "nepřítomnost zmizela");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  for (const id of uklid.orgs) await admin.from("orgs").delete().eq("id", id);
  for (const id of uklid.users) await admin.auth.admin.deleteUser(id);
  ok(`úklid — ${uklid.orgs.length} prostorů, ${uklid.users.length} účtů`);
}

console.log(chyby === 0 ? "\nNepřítomnost i kapacita fungují a jsou izolované." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
