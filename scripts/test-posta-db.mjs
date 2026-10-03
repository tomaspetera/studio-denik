/**
 * Pošta — databázová část (migrace 0018).
 *
 * Nejdůležitější vlastnost: schránka patří konkrétnímu člověku, ne
 * organizaci. Do mojí pošty proto nesmí vidět ani kolega ze stejného studia,
 * i když má jinak právo editovat všechno ostatní. Zbytek appky je záměrně
 * otevřenější, takže to musí hlídat test.
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
  const A = await jakoUzivatel(`posta-a-${razitko}@example.com`);
  const B = await jakoUzivatel(`posta-b-${razitko}@example.com`);
  const C = await jakoUzivatel(`posta-c-${razitko}@example.com`);

  const { data: orgA } = await A.klient.rpc("ensure_workspace", { p_name: "Studio A" });
  const { data: orgC } = await C.klient.rpc("ensure_workspace", { p_name: "Studio C" });
  uklid.orgs.push(orgA, orgC);

  // B je kolega ve stejném studiu jako A, s plným právem editovat.
  await admin.from("memberships").insert({ org_id: orgA, user_id: B.userId, role: "admin" });

  const zprava = (over = {}) => ({
    org_id: orgA, user_id: A.userId, gmail_id: "g1", thread_id: "t1",
    from_email: "jana@firma.cz", from_name: "Jana", subject: "Nabídka",
    received_at: new Date().toISOString(), status: "waiting", ...over,
  });

  // --- Schránka ---------------------------------------------------------------
  const { error: uErr } = await A.klient.from("mail_accounts").insert({
    org_id: orgA, user_id: A.userId, email: "a@example.com", token_enc: "v1.aaa.bbb.ccc",
  });
  zkouska("připojení schránky", !uErr, uErr ? uErr.message : "vlastní schránka se uloží");

  const { error: dvakrat } = await A.klient.from("mail_accounts").insert({
    org_id: orgA, user_id: A.userId, email: "jina@example.com", token_enc: "v1.x.y.z",
  });
  zkouska("jedna na člověka", !!dvakrat, "druhá schránka pro stejného člověka se odmítne");

  const { error: podvrh } = await B.klient.from("mail_accounts").insert({
    org_id: orgA, user_id: A.userId, email: "podvrh@example.com", token_enc: "v1.x.y.z",
  });
  zkouska("podvržení schránky", !!podvrh, "kolega nemůže založit schránku na cizí jméno");

  // --- Zprávy -----------------------------------------------------------------
  const { error: zErr } = await A.klient.from("mail_messages").insert(zprava());
  zkouska("uložení zprávy", !zErr, zErr ? zErr.message : "vlastní zpráva se uloží");

  const { error: duplicita } = await A.klient.from("mail_messages").insert(zprava({ subject: "Jiný předmět" }));
  zkouska("stejná zpráva dvakrát", !!duplicita, "tatáž zpráva ze stejné schránky se neuloží podruhé");

  const { data: ciziUcet } = await B.klient.from("mail_accounts").select("email").eq("user_id", A.userId);
  zkouska("kolega: schránka", (ciziUcet ?? []).length === 0, "kolega ze stejného studia schránku nevidí");

  const { data: ciziZpravy } = await B.klient.from("mail_messages").select("subject").eq("org_id", orgA);
  zkouska("kolega: pošta", (ciziZpravy ?? []).length === 0, "kolega ze stejného studia poštu nevidí");

  const { data: ciziUprava } = await B.klient
    .from("mail_messages")
    .update({ handled_at: new Date().toISOString() })
    .eq("org_id", orgA)
    .select("id");
  zkouska("kolega: úprava", (ciziUprava ?? []).length === 0, "kolega cizí zprávu neoznačí za vyřízenou");

  const { data: ciziMazani } = await B.klient.from("mail_messages").delete().eq("org_id", orgA).select("id");
  const { data: porad } = await admin.from("mail_messages").select("id").eq("user_id", A.userId);
  zkouska("kolega: mazání", (ciziMazani ?? []).length === 0 && (porad ?? []).length === 1, "kolega cizí zprávu nesmaže");

  const { data: cizi2 } = await C.klient.from("mail_messages").select("subject").eq("org_id", orgA);
  zkouska("cizí studio", (cizi2 ?? []).length === 0, "člověk z jiného studia nevidí nic");

  // --- Vlastní úpravy ---------------------------------------------------------
  const { data: vyrizeno } = await A.klient
    .from("mail_messages")
    .update({ handled_at: new Date().toISOString() })
    .eq("user_id", A.userId)
    .select("handled_at");
  zkouska("vyřízeno", !!vyrizeno?.[0]?.handled_at, "vlastní zprávu označím za vyřízenou");

  const { data: stav } = await A.klient.from("mail_messages").select("status").eq("user_id", A.userId).single();
  zkouska("výchozí stav", ["waiting", "info"].includes(stav.status), "stav je jen waiting nebo info");

  const { error: spatnyStav } = await A.klient.from("mail_messages").insert(zprava({ gmail_id: "g2", status: "urgentni" }));
  zkouska("neznámý stav", !!spatnyStav, "jiný stav než waiting/info databáze nepřijme");

  // --- Ignorovaní --------------------------------------------------------------
  const { error: igErr } = await A.klient.from("mail_ignored").insert({ org_id: orgA, user_id: A.userId, pattern: "newsletter.cz" });
  zkouska("ignorovaný", !igErr, igErr ? igErr.message : "vzorec se uloží");

  const { error: igDvakrat } = await A.klient.from("mail_ignored").insert({ org_id: orgA, user_id: A.userId, pattern: "newsletter.cz" });
  zkouska("ignorovaný dvakrát", !!igDvakrat, "stejný vzorec podruhé ne");

  const { error: igPrazdny } = await A.klient.from("mail_ignored").insert({ org_id: orgA, user_id: A.userId, pattern: "   " });
  zkouska("prázdný vzorec", !!igPrazdny, "prázdný vzorec se odmítne");

  const { data: igCizi } = await B.klient.from("mail_ignored").select("pattern").eq("org_id", orgA);
  zkouska("kolega: ignorovaní", (igCizi ?? []).length === 0, "kolega cizí seznam nevidí");

  // --- Odpojení smaže všechno ---------------------------------------------------
  await A.klient.from("mail_messages").delete().eq("user_id", A.userId);
  await A.klient.from("mail_accounts").delete().eq("user_id", A.userId);
  const { data: poOdpojeni } = await admin.from("mail_accounts").select("id").eq("user_id", A.userId);
  const { data: zbyleZpravy } = await admin.from("mail_messages").select("id").eq("user_id", A.userId);
  zkouska("odpojení", (poOdpojeni ?? []).length === 0 && (zbyleZpravy ?? []).length === 0, "schránka i stažená pošta zmizely");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  for (const id of uklid.orgs) await admin.from("orgs").delete().eq("id", id);
  for (const id of uklid.users) await admin.auth.admin.deleteUser(id);
  ok(`úklid — ${uklid.orgs.length} prostorů, ${uklid.users.length} účtů`);
}

console.log(chyby === 0 ? "\nPošta je soukromá — vidí ji jen ten, komu patří." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
