/**
 * Co chce pozornost — pravidla, která rozhodují, co se ukáže na Dnes a co
 * přijde v ranním pushi. Čistá logika bez databáze, takže se spouští přímo
 * nad zdrojovým souborem (Node umí TypeScript bez překladu).
 */
import { computeAttention, actionableCount, normalizeNextStep, isValidDateKey } from "../lib/attention.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(24)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(24)}ŠPATNĚ — ${popis}`); }
};

const TODAY = "2026-10-01";
const CUTOFF = "2026-09-17"; // dnes minus 14 dní

const client = (over) => ({
  id: "c", name: "Klient", archived: false, nextStep: null, nextStepAt: null,
  hasOpenTasks: false, lastActivity: "2026-10-01", ...over,
});
const lead = (over) => ({
  id: "l", name: "Poptávka", company: null, status: "poptavka", nextStep: null, nextStepAt: null,
  createdAt: "2026-09-30", ...over,
});
const run = (clients, leads) =>
  computeAttention({ today: TODAY, silentOnOrBefore: CUTOFF, clients, leads });

// --- Poptávky ------------------------------------------------------------
let r = run([], [lead({ id: "a" })]);
zkouska("poptávka bez kroku", r.length === 1 && r[0].kind === "lead_no_step", "otevřená poptávka bez kroku tiše vyhnívá");

r = run([], [lead({ id: "a", nextStep: "Zavolat", nextStepAt: "2026-10-05" })]);
zkouska("poptávka s krokem", r.length === 0, "plánovaný krok v budoucnu = klid");

r = run([], [lead({ id: "a", nextStep: "Poslat nabídku", nextStepAt: "2026-09-28" })]);
zkouska("krok po termínu", r.length === 1 && r[0].kind === "step_overdue" && r[0].step === "Poslat nabídku" && r[0].since === "2026-09-28",
  "ukáže text kroku a od kdy je po termínu");

r = run([], [lead({ id: "a", nextStep: "Dnes", nextStepAt: TODAY })]);
zkouska("krok dnes", r.length === 0, "krok na dnešek ještě po termínu není");

r = run([], [lead({ id: "a", status: "vyhrano" }), lead({ id: "b", status: "prohrano" })]);
zkouska("rozhodnuté poptávky", r.length === 0, "vyhráno ani prohráno nehlídáme");

r = run([], [lead({ id: "a", status: "nabidka" })]);
zkouska("nabídka bez kroku", r.length === 1 && r[0].kind === "lead_no_step", "stav „nabídka“ je pořád otevřený");

r = run([], [lead({ id: "a", name: "Logo", company: "Kavárna" })]);
zkouska("jméno s firmou", r[0].name === "Logo · Kavárna", "firma se přidá za název");

// --- Klienti ---------------------------------------------------------------
r = run([client({ id: "a", nextStep: "Ozvat se", nextStepAt: "2026-09-20", lastActivity: "2026-01-01" })], []);
zkouska("klient po termínu", r.length === 1 && r[0].kind === "step_overdue", "krok po termínu přebije ticho (žádné dvojí upozornění)");

r = run([client({ id: "a", nextStep: "Ozvat se v lednu", nextStepAt: "2027-01-10", lastActivity: "2026-01-01" })], []);
zkouska("odložení", r.length === 0, "krok v budoucnu klienta ztiší");

r = run([client({ id: "a", lastActivity: CUTOFF })], []);
zkouska("hranice ticha", r.length === 1 && r[0].kind === "client_silent", "přesně N dní bez aktivity už je ticho");

r = run([client({ id: "a", lastActivity: "2026-09-18" })], []);
zkouska("den před hranicí", r.length === 0, "o den čerstvější klient ticho není");

r = run([client({ id: "a", hasOpenTasks: true, lastActivity: "2026-01-01" })], []);
zkouska("otevřená práce", r.length === 0, "klient s otevřeným úkolem se nehlídá, práce běží");

r = run([client({ id: "a", archived: true, lastActivity: "2026-01-01" })], []);
zkouska("archivovaný", r.length === 0, "archivovaný klient nikdy");

// --- Řazení a počítání -------------------------------------------------------
r = run(
  [
    client({ id: "ticho-stare", name: "A", lastActivity: "2026-01-01" }),
    client({ id: "ticho-nove", name: "B", lastActivity: "2026-08-01" }),
    client({ id: "krok", name: "C", nextStep: "X", nextStepAt: "2026-09-29" }),
  ],
  [
    lead({ id: "bez-stare", name: "P1", createdAt: "2026-09-01" }),
    lead({ id: "bez-nove", name: "P2", createdAt: "2026-09-25" }),
    lead({ id: "krok-stary", name: "P3", nextStep: "Y", nextStepAt: "2026-09-10" }),
  ],
);
zkouska("pořadí skupin",
  r.map((i) => i.id).join(",") === "krok-stary,krok,bez-stare,bez-nove,ticho-stare,ticho-nove",
  "po termínu → poptávky bez kroku → ticho; uvnitř skupiny nejstarší první");
zkouska("jednou na subjekt", new Set(r.map((i) => `${i.subject}:${i.id}`)).size === r.length, "nic se neobjeví dvakrát");
zkouska("push bez ticha", actionableCount(r) === 4, "do pushe jen sliby a poptávky, ne ticho u klienta");

// --- Krok a datum jdou spolu ------------------------------------------------
zkouska("prázdný krok", JSON.stringify(normalizeNextStep("", "")) === JSON.stringify({ ok: true, step: null, at: null }), "obojí prázdné = krok se maže");
zkouska("jen mezery", normalizeNextStep("   ", "  ").ok === true, "samé mezery se berou jako prázdné");
zkouska("text bez data", normalizeNextStep("Zavolat", "").ok === false, "krok bez data se odmítne");
zkouska("datum bez textu", normalizeNextStep("", "2026-10-05").ok === false, "datum bez popisu se odmítne");
zkouska("neexistující den", normalizeNextStep("Zavolat", "2026-02-31").ok === false, "31. února není den");
const good = normalizeNextStep("  Zavolat  ", " 2026-10-05 ");
zkouska("ořezání", good.ok && good.step === "Zavolat" && good.at === "2026-10-05", "mezery okolo se ořežou");
zkouska("přestupný rok", isValidDateKey("2028-02-29") && !isValidDateKey("2026-02-29"), "29. února jen v přestupném roce");
zkouska("špatný formát", !isValidDateKey("5. 10. 2026") && !isValidDateKey("2026-10-5"), "jiný zápis než RRRR-MM-DD se nepřijme");

console.log(chyby === 0 ? "\nPravidla pozornosti drží." : `\nProblémů: ${chyby}`);
// Žádná otevřená spojení, proces doběhne sám. `process.exit()` hned po zápisu
// do roury na Windows občas spadne v knihovně libuv a vrátí chybný kód.
process.exitCode = chyby === 0 ? 0 : 1;
