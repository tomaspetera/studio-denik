/**
 * Schvalovací odkaz klienta.
 *
 * Tohle je jediné místo v aplikaci, kam se dá zapsat bez přihlášení. Řádková
 * práva tu nechrání nic — návštěvník je `anon` a žádné řádky nemá. Celá
 * hranice je uvnitř funkce `client_decide`, takže se testuje anonymním
 * klíčem, ne servisním. Servisním by prošlo všechno a test by nic neřekl.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
// Takhle na funkce sahá skutečný návštěvník stránky.
const host = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const ok = (s) => console.log("  " + s);
let orgId = null;
let chyby = 0;

const zkouska = (nazev, podminka, popis) => {
  if (podminka) ok(`${nazev.padEnd(16)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(16)}ŠPATNĚ — ${popis}`); }
};

try {
  const { data: org, error } = await admin
    .from("orgs")
    .insert({ name: "Studio na zkoušku", slug: `__s_${Date.now()}` })
    .select("id")
    .single();
  if (error) throw error;
  orgId = org.id;

  const { data: klienti } = await admin
    .from("clients")
    .insert([
      { org_id: orgId, name: "Pekárna U Lípy" },
      { org_id: orgId, name: "Cizí klient" },
    ])
    .select("id, name, share_token");

  const muj = klienti.find((c) => c.name === "Pekárna U Lípy");
  const cizi = klienti.find((c) => c.name === "Cizí klient");

  const { data: ukoly } = await admin
    .from("tasks")
    .insert([
      // tisk, krok 2 = "Ke schválení" — míč u klienta
      { org_id: orgId, client_id: muj.id, title: "Plakát A2", kind: "tisk", step: 2 },
      // tisk, krok 1 = "Dělám" — míč na studiu
      { org_id: orgId, client_id: muj.id, title: "Vizitky", kind: "tisk", step: 1 },
      // interní úkol bez klienta
      { org_id: orgId, title: "Zálohy", kind: "interni", step: 1 },
      // úkol jiného klienta, taky ke schválení
      { org_id: orgId, client_id: cizi.id, title: "Cizí leták", kind: "tisk", step: 2 },
      // hotový úkol bez razítka o uzavření — spouštěč razítkuje jen při
      // úpravě, takže takhle založený úkol ho nemá. Klientovi zmizet nesmí.
      { org_id: orgId, client_id: muj.id, title: "Loňský kalendář", kind: "klient", step: 3 },
    ])
    .select("id, title");

  const ke_schvaleni = ukoly.find((t) => t.title === "Plakát A2");
  const rozdelane   = ukoly.find((t) => t.title === "Vizitky");
  const interni     = ukoly.find((t) => t.title === "Zálohy");
  const ciziUkol    = ukoly.find((t) => t.title === "Cizí leták");

  // --- 1) Co klient na odkazu vidí -------------------------------------
  const { data: board } = await host.rpc("public_client_board", { p_token: muj.share_token });
  const nazvy = (board?.tasks ?? []).map((t) => t.title).sort();

  zkouska("obsah odkazu",
    board?.client_name === "Pekárna U Lípy"
      && nazvy.join("|") === "Loňský kalendář|Plakát A2|Vizitky",
    `vidí jen svoje úkoly (${nazvy.join(", ") || "nic"})`);

  zkouska("hotový bez data",
    nazvy.includes("Loňský kalendář"),
    "uzavřený úkol bez `closed_at` ze stránky nezmizel");

  zkouska("cizí úkoly",
    !nazvy.includes("Cizí leták") && !nazvy.includes("Zálohy"),
    "úkoly jiného klienta ani interní se ven nedostaly");

  const cekaNaNej = (board?.tasks ?? []).filter((t) => t.ball === "client");
  zkouska("pořadí",
    board?.tasks?.[0]?.title === "Plakát A2" && cekaNaNej.length === 1,
    "nahoře je to, co čeká na klienta");

  // --- 2) Cizí a neplatný token ----------------------------------------
  const { data: nesmysl } = await host.rpc("public_client_board", { p_token: "nic-takoveho" });
  zkouska("cizí token", nesmysl === null, "neplatný odkaz nevydá nic");

  // Přes hranici klientů to nesmí jít ani jedním směrem.
  const { data: pokusCizim } = await host.rpc("client_decide", {
    p_token: cizi.share_token, p_task: ke_schvaleni.id, p_approve: true, p_note: null,
  });
  const { data: pokusNaCizi } = await host.rpc("client_decide", {
    p_token: muj.share_token, p_task: ciziUkol.id, p_approve: true, p_note: null,
  });
  zkouska("hranice klientů",
    pokusCizim?.ok === false && pokusCizim?.reason === "task"
      && pokusNaCizi?.ok === false && pokusNaCizi?.reason === "task",
    "svým tokenem cizí úkol neschválí a cizím tokenem ten svůj taky ne");

  // --- 3) Rozhodovat jde jen o tom, co na klienta čeká ------------------
  for (const [nazev, id] of [["rozdělaný úkol", rozdelane.id], ["interní úkol", interni.id]]) {
    const { data: r } = await host.rpc("client_decide", {
      p_token: muj.share_token, p_task: id, p_approve: true, p_note: null,
    });
    const spravne = r?.ok === false && (r?.reason === "step" || r?.reason === "task");
    zkouska(nazev.padEnd(14), spravne, `odmítnut (${r?.reason ?? "prošel!"})`);
  }

  // --- 4) Připomínka musí něco říkat ------------------------------------
  const { data: prazdna } = await host.rpc("client_decide", {
    p_token: muj.share_token, p_task: ke_schvaleni.id, p_approve: false, p_note: "   ",
  });
  zkouska("prázdný text", prazdna?.ok === false && prazdna?.reason === "note",
    "připomínka bez textu neprojde");

  // --- 5) Připomínka vrátí úkol na „Dělám“ ------------------------------
  const { data: pripominka } = await host.rpc("client_decide", {
    p_token: muj.share_token, p_task: ke_schvaleni.id, p_approve: false,
    p_note: "Logo je moc malé.",
  });
  const { data: poVraceni } = await admin
    .from("tasks_view").select("step, step_name, ball, client_reply")
    .eq("id", ke_schvaleni.id).single();

  zkouska("připomínka",
    pripominka?.ok === true && poVraceni.step === 1 && poVraceni.ball === "me"
      && poVraceni.client_reply === "Logo je moc malé.",
    `vrátil se na „${poVraceni.step_name}“ a text dorazil studiu`);

  // --- 6) Schválení posune dál -----------------------------------------
  await admin.from("tasks").update({ step: 2 }).eq("id", ke_schvaleni.id);
  const { data: schvaleno } = await host.rpc("client_decide", {
    p_token: muj.share_token, p_task: ke_schvaleni.id, p_approve: true, p_note: null,
  });
  const { data: poSchvaleni } = await admin
    .from("tasks_view").select("step, step_name, ball")
    .eq("id", ke_schvaleni.id).single();

  zkouska("schválení",
    schvaleno?.ok === true && poSchvaleni.step === 3 && poSchvaleni.ball === "supplier",
    `posunul se na „${poSchvaleni.step_name}“, míč u dodavatele`);

  // Podruhé už nemá co schválit — míč je pryč.
  const { data: dvakrat } = await host.rpc("client_decide", {
    p_token: muj.share_token, p_task: ke_schvaleni.id, p_approve: true, p_note: null,
  });
  zkouska("dvojí klik", dvakrat?.ok === false && dvakrat?.reason === "step",
    "druhé schválení už neprojde");

  // --- 7) Zápis do historie --------------------------------------------
  const { data: udalosti } = await admin
    .from("task_events").select("kind, detail")
    .eq("task_id", ke_schvaleni.id)
    .in("kind", ["client_approved", "client_changes"]);

  zkouska("historie", (udalosti ?? []).length === 2,
    `zapsalo se, kdo rozhodl (${(udalosti ?? []).length} záznamy)`);

  // --- 8) Archivovanému klientovi odkaz přestane platit ------------------
  await admin.from("clients").update({ archived: true }).eq("id", muj.id);
  const { data: poArchivaci } = await host.rpc("public_client_board", { p_token: muj.share_token });
  await admin.from("tasks").update({ step: 2 }).eq("id", rozdelane.id);
  const { data: zapisPoArchivaci } = await host.rpc("client_decide", {
    p_token: muj.share_token, p_task: rozdelane.id, p_approve: true, p_note: null,
  });

  zkouska("po archivaci",
    poArchivaci === null && zapisPoArchivaci?.ok === false && zapisPoArchivaci?.reason === "link",
    "odkaz archivovaného klienta nečte ani nezapisuje");

  // --- 9) Přímo do tabulek se anonym nedostane --------------------------
  const { data: primo } = await host.from("clients").select("share_token").eq("org_id", orgId);
  const { data: primoUkoly } = await host.from("tasks").select("title").eq("org_id", orgId);
  zkouska("přímé čtení",
    (primo ?? []).length === 0 && (primoUkoly ?? []).length === 0,
    "tabulky jsou pro nepřihlášené zamčené, jde jen ta funkce");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  if (orgId) {
    const { error } = await admin.from("orgs").delete().eq("id", orgId);
    ok(error ? `úklid selhal: ${error.message}` : "testovací data uklizena");
  }
}

console.log(chyby === 0 ? "\nSchvalovací odkaz pouští jen to, co má." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
