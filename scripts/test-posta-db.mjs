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

  // --- Souhlas s AI (migrace 0019) ----------------------------------------------
  // Bez souhlasu se text zprávy z Gmailu vůbec nenačte, takže na tomhle sloupci
  // stojí, co smí opustit appku. Dát ho může jen majitel schránky.
  const { data: vychozi, error: sloupecErr } = await A.klient
    .from("mail_accounts")
    .select("ai_consent_at")
    .eq("user_id", A.userId)
    .single();
  zkouska("AI: výchozí stav", !sloupecErr && vychozi?.ai_consent_at === null, sloupecErr ? sloupecErr.message : "bez výslovného souhlasu je vypnuto");

  const { data: zapnuto } = await A.klient
    .from("mail_accounts")
    .update({ ai_consent_at: new Date().toISOString() })
    .eq("user_id", A.userId)
    .select("ai_consent_at");
  zkouska("AI: vlastní souhlas", !!zapnuto?.[0]?.ai_consent_at, "majitel schránky si návrh pomocí AI zapne");

  const { data: vypnuto } = await A.klient
    .from("mail_accounts")
    .update({ ai_consent_at: null })
    .eq("user_id", A.userId)
    .select("ai_consent_at");
  zkouska("AI: vypnutí", vypnuto?.length === 1 && vypnuto[0].ai_consent_at === null, "a zase vypne");

  const { data: ciziSouhlas } = await B.klient
    .from("mail_accounts")
    .update({ ai_consent_at: new Date().toISOString() })
    .eq("user_id", A.userId)
    .select("id");
  const { data: poPokusu } = await admin.from("mail_accounts").select("ai_consent_at").eq("user_id", A.userId).single();
  zkouska("AI: cizí souhlas", (ciziSouhlas ?? []).length === 0 && poPokusu?.ai_consent_at === null, "kolega nemůže dát souhlas za někoho jiného");

  // --- Automatické třídění (migrace 0021) ------------------------------------------
  // Širší souhlas: text nových zpráv jde do AI sám. Nesmí existovat bez toho
  // základního — hlídá to databáze, ne jen appka.
  const ted = () => new Date().toISOString();
  const { error: autoBez } = await A.klient.from("mail_accounts").update({ ai_auto_at: ted() }).eq("user_id", A.userId);
  zkouska("třídění: bez souhlasu", !!autoBez, "automatické třídění nejde zapnout bez pomoci AI");

  const { data: oboji } = await A.klient
    .from("mail_accounts")
    .update({ ai_consent_at: ted(), ai_auto_at: ted() })
    .eq("user_id", A.userId)
    .select("ai_auto_at");
  zkouska("třídění: s oběma souhlasy", !!oboji?.[0]?.ai_auto_at, "se základním souhlasem jde zapnout");

  const { error: jenAuto } = await A.klient.from("mail_accounts").update({ ai_consent_at: null }).eq("user_id", A.userId);
  zkouska("třídění: jen základní", !!jenAuto, "základní souhlas nejde odebrat, dokud třídění běží");

  const { data: obojiPryc } = await A.klient
    .from("mail_accounts")
    .update({ ai_consent_at: null, ai_auto_at: null })
    .eq("user_id", A.userId)
    .select("ai_consent_at, ai_auto_at");
  zkouska("třídění: vypnutí obojího", obojiPryc?.[0]?.ai_consent_at === null && obojiPryc?.[0]?.ai_auto_at === null, "oba souhlasy jdou odebrat najednou");

  const { data: ciziAuto } = await B.klient
    .from("mail_accounts")
    .update({ ai_consent_at: ted(), ai_auto_at: ted() })
    .eq("user_id", A.userId)
    .select("id");
  const { data: poCizim } = await admin.from("mail_accounts").select("ai_auto_at").eq("user_id", A.userId).single();
  zkouska("třídění: cizí souhlas", (ciziAuto ?? []).length === 0 && poCizim?.ai_auto_at === null, "kolega nezapne třídění cizí pošty");

  // --- Čtení příloh (migrace 0022) ---------------------------------------------------
  // Další zvláštní souhlas: v přílohách bývají faktury a smlouvy. Ani ten nesmí
  // existovat bez základního — a nijak nesouvisí s automatickým tříděním.
  const { data: prilohyVychozi, error: prilohySloupec } = await A.klient
    .from("mail_accounts")
    .select("ai_files_at")
    .eq("user_id", A.userId)
    .single();
  zkouska("přílohy: výchozí stav", !prilohySloupec && prilohyVychozi?.ai_files_at === null, prilohySloupec ? prilohySloupec.message : "bez výslovného souhlasu je čtení příloh vypnuté");

  const { error: prilohyBez } = await A.klient.from("mail_accounts").update({ ai_files_at: ted() }).eq("user_id", A.userId);
  zkouska("přílohy: bez souhlasu", !!prilohyBez, "čtení příloh nejde zapnout bez pomoci AI");

  const { data: sPrilohami } = await A.klient
    .from("mail_accounts")
    .update({ ai_consent_at: ted(), ai_files_at: ted() })
    .eq("user_id", A.userId)
    .select("ai_files_at, ai_auto_at");
  zkouska("přílohy: se základním", !!sPrilohami?.[0]?.ai_files_at && sPrilohami[0].ai_auto_at === null, "se základním souhlasem jde zapnout — a třídění tím nezapne");

  const { error: jenPrilohy } = await A.klient.from("mail_accounts").update({ ai_consent_at: null }).eq("user_id", A.userId);
  zkouska("přílohy: jen základní", !!jenPrilohy, "základní souhlas nejde odebrat, dokud je čtení příloh zapnuté");

  const { data: vsePryc } = await A.klient
    .from("mail_accounts")
    .update({ ai_consent_at: null, ai_auto_at: null, ai_files_at: null })
    .eq("user_id", A.userId)
    .select("ai_consent_at, ai_files_at");
  zkouska("přílohy: vypnutí všeho", vsePryc?.[0]?.ai_consent_at === null && vsePryc?.[0]?.ai_files_at === null, "všechny souhlasy jdou odebrat najednou — tak to dělá vypnutí pomoci AI");

  const { data: ciziPrilohy } = await B.klient
    .from("mail_accounts")
    .update({ ai_consent_at: ted(), ai_files_at: ted() })
    .eq("user_id", A.userId)
    .select("id");
  const { data: poCizichPrilohach } = await admin.from("mail_accounts").select("ai_files_at").eq("user_id", A.userId).single();
  zkouska("přílohy: cizí souhlas", (ciziPrilohy ?? []).length === 0 && poCizichPrilohach?.ai_files_at === null, "kolega nezapne čtení příloh cizí pošty");

  // --- Ranní načítání (migrace 0023) --------------------------------------------------
  // Appka pak čte Gmail sama, bez kliknutí. Zapnout to smí jen majitel schránky
  // a ranní běh (servisní klíč) musí umět vybrat právě jen zapnuté schránky.
  const { data: ranoVychozi, error: ranoSloupec } = await A.klient
    .from("mail_accounts")
    .select("auto_sync_at")
    .eq("user_id", A.userId)
    .single();
  zkouska("ráno: výchozí stav", !ranoSloupec && ranoVychozi?.auto_sync_at === null, ranoSloupec ? ranoSloupec.message : "bez výslovného souhlasu se pošta sama nenačítá");

  const zapnuteRano = () => admin.from("mail_accounts").select("user_id").not("auto_sync_at", "is", null).eq("org_id", orgA);
  const { data: predZapnutim } = await zapnuteRano();
  zkouska("ráno: výběr pro cron", (predZapnutim ?? []).length === 0, "vypnutou schránku ranní běh nevybere");

  const { data: ciziRano } = await B.klient.from("mail_accounts").update({ auto_sync_at: ted() }).eq("user_id", A.userId).select("id");
  const { data: poCizimRanu } = await zapnuteRano();
  zkouska("ráno: cizí souhlas", (ciziRano ?? []).length === 0 && (poCizimRanu ?? []).length === 0, "kolega nezapne ranní načítání cizí pošty");

  const { data: ranoZapnuto } = await A.klient.from("mail_accounts").update({ auto_sync_at: ted() }).eq("user_id", A.userId).select("auto_sync_at, ai_consent_at");
  zkouska("ráno: vlastní souhlas", !!ranoZapnuto?.[0]?.auto_sync_at && ranoZapnuto[0].ai_consent_at === null, "majitel si ho zapne — a pomoc AI k tomu nepotřebuje");

  const { data: poZapnuti } = await zapnuteRano();
  zkouska("ráno: cron ji najde", (poZapnuti ?? []).length === 1 && poZapnuti[0].user_id === A.userId, "zapnutou schránku ranní běh vybere");

  const { data: ranoVypnuto } = await A.klient.from("mail_accounts").update({ auto_sync_at: null }).eq("user_id", A.userId).select("auto_sync_at");
  zkouska("ráno: vypnutí", ranoVypnuto?.length === 1 && ranoVypnuto[0].auto_sync_at === null, "a zase vypne");

  // --- Zprávy -----------------------------------------------------------------
  const { error: zErr } = await A.klient.from("mail_messages").insert(zprava());
  zkouska("uložení zprávy", !zErr, zErr ? zErr.message : "vlastní zpráva se uloží");

  const { error: duplicita } = await A.klient.from("mail_messages").insert(zprava({ subject: "Jiný předmět" }));
  zkouska("stejná zpráva dvakrát", !!duplicita, "tatáž zpráva ze stejné schránky se neuloží podruhé");

  // --- Zařazení a shrnutí od AI (migrace 0021) --------------------------------------
  const { data: netridena } = await A.klient.from("mail_messages").select("priority, summary, ai_checked_at").eq("user_id", A.userId).eq("gmail_id", "g1").single();
  zkouska("zařazení: výchozí", netridena?.priority === null && netridena?.summary === null && netridena?.ai_checked_at === null, "nová zpráva není zařazená ani shrnutá");

  const { data: zarazena, error: zarErr } = await A.klient
    .from("mail_messages")
    .update({ priority: "urgent", summary: "Chtějí letáky do pátku.", ai_checked_at: new Date().toISOString() })
    .eq("user_id", A.userId)
    .eq("gmail_id", "g1")
    .select("priority, summary");
  zkouska("zařazení: uložení", !zarErr && zarazena?.[0]?.priority === "urgent" && zarazena?.[0]?.summary === "Chtějí letáky do pátku.", zarErr ? zarErr.message : "vlastní zprávu jde zařadit a shrnout");

  const { error: spatnaPriorita } = await A.klient.from("mail_messages").update({ priority: "nejvyssi" }).eq("user_id", A.userId).eq("gmail_id", "g1");
  zkouska("zařazení: neznámé", !!spatnaPriorita, "jiné zařazení než urgent/reply/info databáze nepřijme");

  const { error: dlouheShrnuti } = await A.klient.from("mail_messages").update({ summary: "x".repeat(301) }).eq("user_id", A.userId).eq("gmail_id", "g1");
  zkouska("zařazení: dlouhé shrnutí", !!dlouheShrnuti, "do shrnutí se nevejde celý e-mail — nejvýš 300 znaků");

  const { data: smazano } = await A.klient
    .from("mail_messages")
    .update({ priority: null, summary: null, ai_checked_at: null })
    .eq("user_id", A.userId)
    .select("priority, summary");
  zkouska("zařazení: smazání", smazano?.length === 1 && smazano[0].priority === null && smazano[0].summary === null, "vypnutím třídění jde zařazení i shrnutí smazat");

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

  // --- Úkol ze zprávy -----------------------------------------------------------
  // Založení vrací číslo úkolu, aby na něj zpráva mohla odkázat.
  const { data: ukoly, error: ukolErr } = await A.klient
    .from("tasks")
    .insert([{
      org_id: orgA, title: "Poslat letáky do tisku", kind: "tisk", step: 0, size: 2,
      created_by: A.userId, assignee_id: A.userId, due_at: "2026-10-05T00:00:00.000Z", note: "500 kusů",
    }])
    .select("id");
  zkouska("úkol: číslo při založení", !ukolErr && ukoly?.length === 1, ukolErr ? ukolErr.message : "založený úkol vrátí své číslo");

  const { data: spojeno } = await A.klient
    .from("mail_messages")
    .update({ task_id: ukoly?.[0]?.id ?? null, handled_at: new Date().toISOString() })
    .eq("user_id", A.userId)
    .eq("gmail_id", "g1")
    .select("task_id, handled_at");
  zkouska("úkol: odkaz ze zprávy", !!ukoly?.[0]?.id && spojeno?.[0]?.task_id === ukoly[0].id && !!spojeno?.[0]?.handled_at, "zpráva odkazuje na úkol a je vyřízená");

  await A.klient.from("tasks").delete().eq("id", ukoly?.[0]?.id);
  const { data: poSmazaniUkolu } = await A.klient.from("mail_messages").select("task_id, handled_at").eq("user_id", A.userId).eq("gmail_id", "g1").single();
  zkouska("úkol: smazání", poSmazaniUkolu?.task_id === null, "po smazání úkolu zpráva zůstane, jen odkaz zmizí");
  await A.klient.from("mail_messages").update({ handled_at: null }).eq("user_id", A.userId).eq("gmail_id", "g1");

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

  // --- Jméno pro podpis ----------------------------------------------------------
  // Návrh odpovědi se podepisuje jménem z profilu. Musí jít změnit — a jen vlastní.
  const { data: vychoziJmeno } = await A.klient.from("profiles").select("full_name").eq("id", A.userId).single();
  zkouska("podpis: výchozí", vychoziJmeno?.full_name === `posta-a-${razitko}`, "po registraci je jménem začátek adresy — proto se dá přepsat");

  const { data: prepsano, error: jmErr } = await A.klient.from("profiles").update({ full_name: "Anna Dvořáková" }).eq("id", A.userId).select("full_name");
  zkouska("podpis: vlastní", !jmErr && prepsano?.[0]?.full_name === "Anna Dvořáková", jmErr ? jmErr.message : "vlastní jméno si změním");

  const { data: ciziJmeno } = await B.klient.from("profiles").update({ full_name: "Podvrh" }).eq("id", A.userId).select("full_name");
  const { data: poPodvrhu } = await admin.from("profiles").select("full_name").eq("id", A.userId).single();
  zkouska("podpis: cizí", (ciziJmeno ?? []).length === 0 && poPodvrhu?.full_name === "Anna Dvořáková", "kolega mi jméno přepsat nemůže");

  const { data: videnoKolegou } = await B.klient.from("profiles").select("full_name").eq("id", A.userId).maybeSingle();
  zkouska("podpis: kolega vidí", videnoKolegou?.full_name === "Anna Dvořáková", "kolega ze studia jméno vidí — stejně jako v Týmu");

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
