/**
 * Šablony a opakované úkoly — pravidla bez databáze: popisek rozvrhu,
 * nejbližší výskyt a validace formuláře. Spouští se přímo nad zdrojovým
 * souborem (Node umí TypeScript bez překladu).
 *
 * Datum ve zkouškách je pevné: 1. října 2026 je čtvrtek.
 */
import {
  describeSchedule,
  isoWeekday,
  nextOccurrence,
  normalizeSchedule,
  normalizePreset,
} from "../lib/presets.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(24)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(24)}ŠPATNĚ — ${popis}`); }
};

const weekly = (weekday) => ({ frequency: "weekly", weekday, monthDay: null });
const monthly = (monthDay) => ({ frequency: "monthly", weekday: null, monthDay });

// --- Popisky -----------------------------------------------------------------
zkouska("popisek týdně",
  [1, 2, 3, 4, 5, 6, 7].map((d) => describeSchedule(weekly(d))).join(", ") ===
    "každé pondělí, každé úterý, každou středu, každý čtvrtek, každý pátek, každou sobotu, každou neděli",
  "česky se správným rodem dne");
zkouska("popisek měsíčně", describeSchedule(monthly(5)) === "každého 5. v měsíci", "den v měsíci");

// --- Den v týdnu ---------------------------------------------------------------
zkouska("čtvrtek", isoWeekday("2026-10-01") === 4, "1. 10. 2026 je čtvrtek");
zkouska("pondělí a neděle", isoWeekday("2026-10-05") === 1 && isoWeekday("2026-10-04") === 7, "neděle je 7, ne 0");

// --- Nejbližší výskyt ------------------------------------------------------------
zkouska("týdně dopředu", nextOccurrence(weekly(5), "2026-10-01") === "2026-10-02", "ze čtvrtka na nejbližší pátek");
zkouska("týdně dnes", nextOccurrence(weekly(5), "2026-10-02") === "2026-10-02", "v den pravidla je výskyt dnes");
zkouska("týdně zítra až příští", nextOccurrence(weekly(5), "2026-10-03") === "2026-10-09", "po pátku čeká příští týden");
zkouska("týdně přes víkend", nextOccurrence(weekly(1), "2026-10-01") === "2026-10-05", "ze čtvrtka na pondělí");
zkouska("týdně neděle", nextOccurrence(weekly(7), "2026-10-01") === "2026-10-04", "ze čtvrtka na neděli");
zkouska("měsíčně tento měsíc", nextOccurrence(monthly(5), "2026-10-01") === "2026-10-05", "den ještě nebyl");
zkouska("měsíčně dnes", nextOccurrence(monthly(5), "2026-10-05") === "2026-10-05", "v den pravidla je výskyt dnes");
zkouska("měsíčně příští", nextOccurrence(monthly(5), "2026-10-06") === "2026-11-05", "den už byl, čeká další měsíc");
zkouska("měsíčně přes rok", nextOccurrence(monthly(1), "2026-12-15") === "2027-01-01", "prosinec přeskočí do ledna");
zkouska("měsíčně v únoru", nextOccurrence(monthly(28), "2026-01-31") === "2026-02-28", "28. existuje v každém měsíci");

// --- Rozvrh ------------------------------------------------------------------------
let r = normalizeSchedule({ frequency: "weekly", weekday: 5, monthDay: 10 });
zkouska("týdně čistí den v měsíci", r.ok && r.weekday === 5 && r.monthDay === null, "zbylý den v měsíci se zahodí");
r = normalizeSchedule({ frequency: "monthly", weekday: 3, monthDay: 10 });
zkouska("měsíčně čistí den v týdnu", r.ok && r.monthDay === 10 && r.weekday === null, "zbylý den v týdnu se zahodí");
zkouska("týdně bez dne", normalizeSchedule({ frequency: "weekly" }).ok === false, "chybí den v týdnu");
zkouska("den v týdnu 0 a 8", !normalizeSchedule({ frequency: "weekly", weekday: 0 }).ok && !normalizeSchedule({ frequency: "weekly", weekday: 8 }).ok, "mimo 1–7");
zkouska("29. se nenabízí", !normalizeSchedule({ frequency: "monthly", monthDay: 29 }).ok, "v kratším měsíci by vypadl");
zkouska("28. projde", normalizeSchedule({ frequency: "monthly", monthDay: 28 }).ok === true, "poslední povolený");
zkouska("neznámá frekvence", !normalizeSchedule({ frequency: "daily", weekday: 1 }).ok, "jen týdně a měsíčně");

// --- Společná pole ---------------------------------------------------------------
let p = normalizePreset({ title: "  Odeslat týdenní report  ", kind: "interni", size: 2, dueOffsetDays: "" });
zkouska("ořezání názvu", p.ok && p.title === "Odeslat týdenní report" && p.dueOffsetDays === null, "mezery pryč, prázdný termín = bez termínu");
zkouska("bez názvu", !normalizePreset({ title: "   ", kind: "interni", size: 2 }).ok, "název je povinný");
zkouska("neznámý typ", !normalizePreset({ title: "X", kind: "faktura", size: 2 }).ok, "jen interní, s klientem, tiskový");
zkouska("velikost", [0, 4, 1.5].every((s) => !normalizePreset({ title: "X", kind: "klient", size: s }).ok), "jen 1 až 3");
p = normalizePreset({ title: "X", kind: "tisk", size: 3, dueOffsetDays: "7" });
zkouska("termín jako text", p.ok && p.dueOffsetDays === 7, "číslo z políčka formuláře");
p = normalizePreset({ title: "X", kind: "klient", size: 1, dueOffsetDays: 0 });
zkouska("termín nula", p.ok && p.dueOffsetDays === 0, "nula = termín v den založení");
zkouska("termín mimo", ["-1", "366", "2.5", "abc"].every((v) => !normalizePreset({ title: "X", kind: "klient", size: 2, dueOffsetDays: v }).ok), "záporný, přes rok, desetinný, text");
zkouska("termín nezadaný", normalizePreset({ title: "X", kind: "klient", size: 2 }).dueOffsetDays === null, "chybějící = bez termínu");

console.log(chyby === 0 ? "\nPravidla šablon a opakování drží." : `\nProblémů: ${chyby}`);
// Žádná otevřená spojení, proces doběhne sám. `process.exit()` hned po zápisu
// do roury na Windows občas spadne v knihovně libuv a vrátí chybný kód.
process.exitCode = chyby === 0 ? 0 : 1;
