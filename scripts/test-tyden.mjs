/**
 * Můj týden — na který den je co naplánované. Bez sítě a bez databáze.
 *
 * Test hlídá tři věci, které by plán rozbily: že se žádný vlastní úkol
 * neztratí ani neukáže dvakrát, že se nestihnuté přenese na dnešek (a jen
 * v týdnu, kde dnešek je), a že se neplánuje cizí práce.
 */
import { buildWeek, planTarget, weekStartOf } from "../lib/week.ts";
import { buildToday } from "../lib/today.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(24)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(24)}ŠPATNĚ — ${popis}`); }
};
const stejne = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DNES = "2026-10-07"; // středa
const BALL = { interni: ["me", "me", "done"], klient: ["me", "me", "client", "done"], tisk: ["me", "me", "client", "supplier", "me", "done"] };
const NAZEV = { interni: ["Zadáno", "Dělám", "Hotovo"], klient: ["Zadáno", "Dělám", "U klienta", "Hotovo"], tisk: ["Zadáno", "Dělám", "Ke schválení", "V tisku", "Dodáno", "Předáno"] };
let poradi = 0;
const ukol = (title, plan, over = {}) => {
  const kind = over.kind ?? "klient";
  const step = over.step ?? 0;
  const due = over.due ?? null;
  return {
    id: `u${++poradi}`, title, kind, step,
    ball: BALL[kind][step], step_name: NAZEV[kind][step],
    is_late: due !== null && due < DNES && BALL[kind][step] !== "done",
    due_at: due ? `${due}T00:00:00.000Z` : null,
    client_id: null, client_name: over.client ?? null, client_color: null, supplier_name: null,
    planned_for: plan,
  };
};

const UKOLY = [
  ukol("Nestihnuto z pondělí", "2026-10-05"),
  ukol("Nestihnuto z minulého týdne", "2026-09-30", { due: "2026-10-01" }),
  ukol("Dnešní", DNES, { due: "2026-10-09" }),
  ukol("Zítřejší", "2026-10-08"),
  ukol("Páteční B", "2026-10-09"),
  ukol("Páteční A", "2026-10-09", { due: "2026-10-09" }),
  ukol("Sobotní", "2026-10-10"),
  ukol("Nedělní", "2026-10-11"),
  ukol("Příští pondělí", "2026-10-12"),
  ukol("Bez plánu, po termínu", null, { due: "2026-10-02" }),
  ukol("Bez plánu, s termínem", null, { due: "2026-10-20" }),
  ukol("Bez plánu", null),
  ukol("U klienta, i když naplánovaný", "2026-10-08", { step: 2 }),
  ukol("Hotový", "2026-10-08", { step: 3 }),
  ukol("V tisku", null, { kind: "tisk", step: 3 }),
];

const t = buildWeek(UKOLY, DNES);
const nazvy = (seznam) => seznam.map((x) => x.title);
const den = (plan, label) => plan.days.find((d) => d.label === label);

// --- Rozvržení týdne ---------------------------------------------------------------------
zkouska("týden: rozsah", t.start === "2026-10-05" && t.rangeLabel === "5.–11. 10." && t.isCurrent && stejne(t.days.map((d) => d.label), ["Po", "Út", "St", "Čt", "Pá", "Víkend"]), "od pondělí, pět dní a víkend dohromady");
zkouska("týden: dnešek", den(t, "St").isToday && den(t, "Po").isPast && den(t, "Út").isPast && !den(t, "Čt").isPast && !den(t, "Víkend").isPast && den(t, "Víkend").key === "2026-10-10" && den(t, "Víkend").dateLabel === "10.–11. 10.", "co uplynulo, co je dnes a víkend se plánuje na sobotu");
zkouska("týden: pondělí", weekStartOf("2026-10-11") === "2026-10-05" && weekStartOf("2026-10-05") === "2026-10-05" && weekStartOf("2026-10-12") === "2026-10-12" && weekStartOf("2027-01-01") === "2026-12-28", "neděle patří k předchozímu pondělí, i přes rok");

// --- Co kde je -----------------------------------------------------------------------------
zkouska("přenesené", stejne(nazvy(den(t, "St").items), ["Nestihnuto z minulého týdne", "Dnešní", "Nestihnuto z pondělí"]) && den(t, "St").items[0].carried && !den(t, "St").items[1].carried && den(t, "St").items[2].carried && den(t, "St").items[2].plannedKey === "2026-10-05", "nestihnuté je u dneška, označené, a pamatuje si původní den; po termínu první");
zkouska("uplynulé dny", den(t, "Po").items.length === 0 && den(t, "Út").items.length === 0, "v minulosti nic nezůstane viset");
zkouska("další dny", stejne(nazvy(den(t, "Čt").items), ["Zítřejší"]) && stejne(nazvy(den(t, "Pá").items), ["Páteční A", "Páteční B"]) && stejne(nazvy(den(t, "Víkend").items), ["Nedělní", "Sobotní"]), "každý úkol ve svém dni; s termínem dřív než bez něj, jinak abecedně; sobota i neděle spolu");
zkouska("nenaplánované", stejne(nazvy(t.unplanned), ["Bez plánu, po termínu", "Bez plánu, s termínem", "Bez plánu"]), "po termínu první, bez termínu poslední");
zkouska("jiný týden", t.elsewhere === 1 && !nazvy(t.unplanned).includes("Příští pondělí"), "úkol naplánovaný na příští týden není „nenaplánovaný“");
zkouska("jen vlastní práce", ![...t.unplanned, ...t.days.flatMap((d) => d.items)].some((x) => ["U klienta, i když naplánovaný", "Hotový", "V tisku"].includes(x.title)), "co leží u klienta, u dodavatele nebo je hotové, se neplánuje");
const vse = [...nazvy(t.unplanned), ...t.days.flatMap((d) => nazvy(d.items))];
zkouska("každý právě jednou", vse.length === new Set(vse).size && vse.length + t.elsewhere === 12, "dvanáct vlastních úkolů: každý jednou, nebo spočítaný jinde");

// --- Karta ---------------------------------------------------------------------------------
const karta = den(t, "St").items[0];
zkouska("karta: termín", karta.dueLabel === "1. 10." && karta.dueTone === "late" && den(t, "St").items[1].dueLabel === "Pá 9. 10." && t.unplanned[2].dueLabel === null && t.unplanned[2].dueTone === "none", "stejný štítek termínu jako na Dnes");
zkouska("karta: hotovo", stejne(karta.finish, { step: 3, label: "Hotovo" }) && karta.step === 0, "fajfka posune na poslední krok a ví, odkud ho vrátit");

// --- Jiný týden než ten dnešní ---------------------------------------------------------------
let p = buildWeek(UKOLY, DNES, "2026-10-14");
zkouska("příští týden", p.start === "2026-10-12" && !p.isCurrent && stejne(nazvy(den(p, "Po").items), ["Příští pondělí"]) && p.days.every((d) => !d.isPast && !d.isToday) && p.days.filter((d) => d.items.length > 0).length === 1, "ukáže jen to, co je na něj naplánované; nic se do něj nepřenáší");
zkouska("příští týden: jinde", p.elsewhere === 8 && p.unplanned.length === 3, "tento týden i nestihnuté jsou spočítané jinde, nenaplánované zůstávají");
p = buildWeek(UKOLY, DNES, "2026-09-28");
zkouska("minulý týden", p.days.every((d) => d.isPast && d.items.length === 0) && p.elsewhere === 9, "uplynulý týden je prázdný — nestihnuté je v tom dnešním");
p = buildWeek([ukol("Přes měsíc", "2026-10-01")], "2026-09-30", "2026-09-28");
zkouska("přes měsíc", p.rangeLabel === "28. 9. – 4. 10." && stejne(nazvy(den(p, "Čt").items), ["Přes měsíc"]), "týden přes hranici měsíce");
p = buildWeek([ukol("Sobotní nestihnutý", "2026-10-10")], "2026-10-11");
zkouska("neděle", den(p, "Víkend").isToday && den(p, "Pá").isPast && stejne(nazvy(den(p, "Víkend").items), ["Sobotní nestihnutý"]) && den(p, "Víkend").items[0].carried, "v neděli je dnešek ve sloupci Víkend a sobotní úkol je přenesený");
zkouska("prázdno", buildWeek([], DNES).days.every((d) => d.items.length === 0) && buildWeek([], DNES).unplanned.length === 0 && buildWeek([], DNES).elsewhere === 0, "bez úkolů nic nespadne");

// --- Kam se úkol opravdu zapíše ---------------------------------------------------------------
zkouska("cíl plánu", planTarget("2026-10-09", DNES) === "2026-10-09" && planTarget(DNES, DNES) === DNES && planTarget("2026-10-05", DNES) === DNES && planTarget("2026-10-10", "2026-10-11") === "2026-10-11", "na uplynulý den se neplánuje — zapíše se dnešek (i víkend v neděli)");

// --- Dnes: co je v plánu na dnešek, jde první --------------------------------------------------
// Vyšší strop řádků, ať je vidět celé pořadí — Dnes jich jinak ukáže jen osm.
const d = buildToday(UKOLY, DNES, new Set(), 50);
const mine = d.mine.flatMap((g) => g.items);
zkouska("dnes: pořadí", stejne(nazvy(mine).slice(0, 2), ["Dnešní", "Nestihnuto z pondělí"]) && d.mine[0].bucket === "today" && mine[0].plannedToday && mine[1].plannedToday, "naplánované na dnešek (i přenesené) je v „Na tobě“ nahoře");
zkouska("dnes: ostatní", !mine.find((x) => x.title === "Zítřejší").plannedToday && !mine.find((x) => x.title === "Bez plánu").plannedToday && nazvy(mine).filter((n) => n === "Dnešní").length === 1, "zítřejší plán ani úkol bez plánu značku nemají a nic není dvakrát");
zkouska("dnes: hoří", d.burning.find((x) => x.title === "Nestihnuto z minulého týdne").plannedToday && d.counts.planned === 3, "po termínu zůstává v Hoří, značku má taky; počet naplánovaných na dnešek");
zkouska("dnes: cizí práce", !d.waiting.some((x) => x.plannedToday), "úkol u klienta není „v plánu na dnes“, i když plán má");
zkouska("dnes: bez plánu", buildToday(UKOLY.map((u) => ({ ...u, planned_for: undefined })), DNES).counts.planned === 0, "bez plánů (před migrací) se nic nemění");

// Žádná otevřená spojení, proces doběhne sám.
console.log(chyby === 0 ? "\nMůj týden: plán drží." : `\nProblémů: ${chyby}`);
process.exitCode = chyby === 0 ? 0 : 1;
