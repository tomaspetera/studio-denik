/**
 * Oprava „po termínu“ a odběr kalendáře do telefonu.
 *
 * Chyba: úkol s dnešním termínem se od časných ranních hodin tvářil jako
 * po termínu, protože `is_late` porovnávalo okamžik, ne kalendářní den.
 * Test níž je navržený tak, aby padal na staré chybě bez ohledu na to,
 * v kolik hodin zrovna běží — testuje se úkol s termínem "dnes", což bylo
 * přesně to, co dřív (od 1–2 hodiny ráno pražského času dál) hlásilo
 * falešně pozdě.
 */
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const host = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);

const ok = (s) => console.log("  " + s);
let orgId = null;
let chyby = 0;

const zkouska = (nazev, podminka, popis) => {
  if (podminka) ok(`${nazev.padEnd(16)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(16)}ŠPATNĚ — ${popis}`); }
};

// Půlnoc UTC daného počtu dní od dneška — přesně tak, jak termín ukládá Composer.
function utcMidnight(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

try {
  const { data: org, error } = await db
    .from("orgs")
    .insert({ name: "Zkušební kalendář", slug: `__cal_${Date.now()}` })
    .select("id, calendar_token")
    .single();
  if (error) throw error;
  orgId = org.id;

  const { data: tasks } = await db
    .from("tasks")
    .insert([
      { org_id: orgId, title: "Termín dnes",   kind: "klient", step: 1, due_at: utcMidnight(0) },
      { org_id: orgId, title: "Termín zítra",  kind: "klient", step: 1, due_at: utcMidnight(1) },
      { org_id: orgId, title: "Termín včera",  kind: "klient", step: 1, due_at: utcMidnight(-1) },
      { org_id: orgId, title: "Hotovo po termínu", kind: "klient", step: 3, due_at: utcMidnight(-5) },
    ])
    .select("id, title");

  const { data: rows } = await db
    .from("tasks_view")
    .select("title, is_late")
    .eq("org_id", orgId);

  const late = Object.fromEntries(rows.map((r) => [r.title, r.is_late]));

  // Tohle je přesně ta oprava: dřív by "Termín dnes" v tuhle chvíli
  // (jakoukoliv, mimo 0–2 hodiny ráno) vyšel jako pozdě.
  zkouska("dnešní termín", late["Termín dnes"] === false, "termín na dnešek ještě není po termínu");
  zkouska("zítřejší termín", late["Termín zítra"] === false, "logicky v pořádku");
  zkouska("včerejší termín", late["Termín včera"] === true, "včerejší termín už pozdě je");
  zkouska("hotovo se nepočítá", late["Hotovo po termínu"] === false, "uzavřený úkol není nikdy pozdě");

  // --- Kalendářní kanál (ICS) --------------------------------------------
  const dnesniUkol = tasks.find((t) => t.title === "Termín dnes");
  await db.from("tasks").insert({
    org_id: orgId, title: "Domluvená schůzka", kind: "klient", step: 1,
    agreed_at: utcMidnight(2), agreed_note: "Prezentace návrhu",
  });
  const { data: printTask } = await db
    .from("tasks").insert({ org_id: orgId, title: "Katalog", kind: "tisk", step: 1 })
    .select("id").single();
  await db.from("print_jobs").insert({ org_id: orgId, task_id: printTask.id, promised_at: utcMidnight(4) });

  const { data: feed } = await host.rpc("public_calendar_feed", { p_token: org.calendar_token });
  const kinds = (feed?.events ?? []).map((e) => e.kind).sort();

  zkouska("obsah kanálu", feed?.org_name === "Zkušební kalendář" && kinds.join(",") === "agreed,due,due,due,print",
    `${feed?.events?.length ?? 0} událostí (hotové úkoly se nepočítají)`);

  const dueEvent = (feed?.events ?? []).find((e) => e.uid === `due-${dnesniUkol.id}`);
  zkouska("den události", dueEvent?.date?.slice(0, 10) === utcMidnight(0).slice(0, 10),
    "datum v kanálu sedí na den termínu");

  const { data: cizi } = await host.rpc("public_calendar_feed", { p_token: "neexistujici-token" });
  zkouska("cizí token", cizi === null, "neplatný token nevydá nic");

  const { data: primo } = await host.from("tasks").select("id").eq("org_id", orgId);
  zkouska("přímé čtení", (primo ?? []).length === 0, "bez tokenu se k úkolům nedostane");
} catch (e) {
  chyby++;
  ok(`CHYBA — ${String(e?.message ?? e)}`);
} finally {
  if (orgId) {
    const { error } = await db.from("orgs").delete().eq("id", orgId);
    ok(error ? `úklid selhal: ${error.message}` : "testovací data uklizena");
  }
}

console.log(chyby === 0 ? "\nVšechno sedí." : `\nProblémů: ${chyby}`);
process.exit(chyby === 0 ? 0 : 1);
