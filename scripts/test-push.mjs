/**
 * Odběrná místa pro push notifikace.
 *
 * Na rozdíl od zbytku appky (kde kdokoli s právem editovat smí sáhnout na
 * cizí záznam) je tohle osobní nastavení konkrétního zařízení — práva jsou
 * užší: vidí a maže jen ten, komu odběr patří, bez ohledu na roli v týmu.
 * Test to ověřuje pod skutečnými účty, ne servisním klíčem.
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
  return { klient, userId: data.user.id };
}

try {
  const a = await jakoUzivatel(`push-a-${razitko}@example.com`);
  const b = await jakoUzivatel(`push-b-${razitko}@example.com`);

  const { data: orgA } = await a.klient.rpc("ensure_workspace", { p_name: "Studio A" });
  const { data: orgB } = await b.klient.rpc("ensure_workspace", { p_name: "Studio B" });
  uklid.orgs.push(orgA, orgB);

  const endpoint = `https://fcm.example.test/${razitko}`;

  // --- 1) Vlastní odběr ----------------------------------------------------
  const { error: cErr } = await a.klient.from("push_subscriptions").insert({
    org_id: orgA, user_id: a.userId, endpoint, p256dh: "klic-p256dh", auth: "klic-auth",
  });
  zkouska("založení", !cErr, cErr ? cErr.message : "odběr uložen");

  const { data: vlastni } = await a.klient.from("push_subscriptions").select("id").eq("endpoint", endpoint);
  zkouska("vlastní čtení", (vlastni ?? []).length === 1, "vidí svůj vlastní odběr");

  // --- 2) Cizí uživatel ho nevidí, i kdyby znal endpoint ------------------
  const { data: cizi } = await b.klient.from("push_subscriptions").select("id").eq("endpoint", endpoint);
  zkouska("cizí čtení", (cizi ?? []).length === 0, "cizí uživatel odběr nevidí, i když zná endpoint");

  // --- 3) Podvržení cizího user_id je odmítnuté ----------------------------
  const { error: spoofErr } = await b.klient.from("push_subscriptions").insert({
    org_id: orgB, user_id: a.userId, endpoint: `${endpoint}-spoof`, p256dh: "x", auth: "y",
  });
  zkouska("podvržení user_id", !!spoofErr, "nejde založit odběr na cizí jméno, ani ve vlastní organizaci");

  // --- 4) Opakované přihlášení stejného zařízení aktualizuje, neduplikuje --
  const { error: upsertErr } = await a.klient.from("push_subscriptions").upsert(
    { org_id: orgA, user_id: a.userId, endpoint, p256dh: "novy-klic", auth: "novy-auth" },
    { onConflict: "endpoint" },
  );
  const { data: poUpsertu } = await a.klient.from("push_subscriptions").select("p256dh").eq("endpoint", endpoint);
  zkouska("upsert", !upsertErr && poUpsertu?.length === 1 && poUpsertu[0].p256dh === "novy-klic",
    "stejné zařízení aktualizuje záznam, neduplikuje ho");

  // --- 5) Servisní klíč (cron) vidí napříč uživateli v rámci organizace ---
  const { data: proCron } = await admin.from("push_subscriptions").select("endpoint").eq("org_id", orgA);
  zkouska("čtení pro cron", proCron?.some((s) => s.endpoint === endpoint), "servisní klíč (mimo RLS) najde odběr pro odeslání");

  // --- 6) Smazání vlastního odběru ------------------------------------------
  await a.klient.from("push_subscriptions").delete().eq("endpoint", endpoint);
  const { data: poSmazani } = await admin.from("push_subscriptions").select("id").eq("endpoint", endpoint);
  zkouska("smazání", (poSmazani ?? []).length === 0, "odběr zmizel");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  for (const id of uklid.orgs) await admin.from("orgs").delete().eq("id", id);
  for (const id of uklid.users) await admin.auth.admin.deleteUser(id);
  ok(`úklid — ${uklid.orgs.length} prostorů, ${uklid.users.length} účtů`);
}

console.log(chyby === 0 ? "\nOdběry push notifikací fungují a jsou soukromé." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
