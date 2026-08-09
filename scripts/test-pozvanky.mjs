/**
 * Pozvánky do týmu — konec konců.
 *
 * Zakládá skutečné účty a přihlašuje se pod nimi, protože `ensure_workspace`
 * stojí na `auth.uid()`. Servisním klíčem by byl prázdný a test by neměřil nic.
 *
 * Účty i data po sobě uklidí.
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

/** Založí účet a vrátí klienta přihlášeného pod ním. */
async function jakoUzivatel(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: HESLO,
    email_confirm: true,
  });
  if (error) throw new Error(`účet ${email}: ${error.message}`);
  uklid.users.push(data.user.id);

  const klient = createClient(url, anon, { auth: { persistSession: false } });
  const { error: sErr } = await klient.auth.signInWithPassword({ email, password: HESLO });
  if (sErr) throw new Error(`přihlášení ${email}: ${sErr.message}`);
  return klient;
}

const prostor = async (klient) => {
  const { data, error } = await klient.rpc("ensure_workspace", { p_name: null });
  if (error) throw new Error(`ensure_workspace: ${error.message}`);
  return data;
};

try {
  // --- 1) Správce si založí prostor -----------------------------------
  const sefMail = `sef+${razitko}@example.com`;
  const sef = await jakoUzivatel(sefMail);
  const orgId = await prostor(sef);
  uklid.orgs.push(orgId);
  ok(`prostor         ok — správci vznikl vlastní prostor`);

  // --- 2) Pozve kolegu -------------------------------------------------
  const kolegaMail = `kolega+${razitko}@example.com`;
  const { error: iErr } = await sef.from("invites").insert({
    org_id: orgId,
    email: kolegaMail,
    role: "member",
  });
  if (iErr) { chyby++; ok(`pozvání         ŠPATNĚ — ${iErr.message}`); }
  else ok(`pozvání         ok — pozvánka uložena`);

  // --- 3) Kolega se přihlásí — musí skončit v témže prostoru -----------
  const kolega = await jakoUzivatel(kolegaMail);
  const kolegaOrg = await prostor(kolega);

  if (kolegaOrg !== orgId) {
    chyby++;
    ok(`přijetí         ŠPATNĚ — kolega skončil v jiném prostoru`);
    uklid.orgs.push(kolegaOrg);
  } else {
    ok(`přijetí         ok — kolega je ve stejném prostoru, ne ve vlastním`);
  }

  // --- 4) Dostal správnou roli ----------------------------------------
  const { data: clen } = await admin
    .from("team_view")
    .select("role")
    .eq("org_id", orgId)
    .ilike("email", kolegaMail)
    .maybeSingle();

  if (clen?.role !== "member") { chyby++; ok(`role            ŠPATNĚ — má "${clen?.role}"`); }
  else ok(`role            ok — člen týmu, jak bylo pozváno`);

  // --- 5) Pozvánka se označila za vyřízenou ---------------------------
  const { data: zbyle } = await sef
    .from("invites")
    .select("id")
    .eq("org_id", orgId)
    .is("accepted_at", null);

  if ((zbyle ?? []).length !== 0) { chyby++; ok("vyřízení        ŠPATNĚ — pozvánka pořád čeká"); }
  else ok("vyřízení        ok — pozvánka se uzavřela");

  // --- 6) Kolega vidí úkoly týmu, ale ne cizí prostory -----------------
  await admin.from("tasks").insert({ org_id: orgId, title: "Společný úkol", kind: "interni" });
  const { data: vidi } = await kolega.from("tasks_view").select("title");
  if ((vidi ?? []).length !== 1) { chyby++; ok(`sdílení dat     ŠPATNĚ — kolega vidí ${(vidi ?? []).length} úkolů`); }
  else ok(`sdílení dat     ok — kolega vidí úkoly týmu`);

  // --- 7) Člen nesmí spravovat tým ------------------------------------
  const { error: pErr } = await kolega.from("invites").insert({
    org_id: orgId,
    email: `cizi+${razitko}@example.com`,
    role: "admin",
  });
  if (!pErr) { chyby++; ok("práva           ŠPATNĚ — člen týmu mohl pozvat dalšího"); }
  else ok("práva           ok — pozvat smí jen správce");

  // --- 8) Vypršelá pozvánka se nepřijme --------------------------------
  const pozdniMail = `pozde+${razitko}@example.com`;
  await admin.from("invites").insert({
    org_id: orgId,
    email: pozdniMail,
    role: "member",
    expires_at: new Date(Date.now() - 86_400_000).toISOString(),
  });

  const pozdni = await jakoUzivatel(pozdniMail);
  const pozdniOrg = await prostor(pozdni);
  if (pozdniOrg === orgId) { chyby++; ok("vypršelá        ŠPATNĚ — propadlá pozvánka se přijala"); }
  else { ok("vypršelá        ok — propadlá pozvánka neplatí, vznikl vlastní prostor"); uklid.orgs.push(pozdniOrg); }
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  for (const id of uklid.orgs) await admin.from("orgs").delete().eq("id", id);
  for (const id of uklid.users) await admin.auth.admin.deleteUser(id).catch(() => {});
  ok(`úklid — ${uklid.orgs.length} prostorů, ${uklid.users.length} účtů`);
}

console.log(chyby === 0 ? "\nPozvánky fungují." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
