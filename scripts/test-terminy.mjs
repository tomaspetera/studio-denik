/**
 * Rozdělení "Na tobě" podle termínu — čistá logika bez databáze. Spouští se
 * přímo nad zdrojovým souborem (Node umí TypeScript bez překladu).
 *
 * Datum ve zkouškách je pevné: 1. října 2026 je čtvrtek.
 */
import { bucketOf, groupByBucket, BUCKET_LABEL } from "../lib/buckets.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(26)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(26)}ŠPATNĚ — ${popis}`); }
};

const TODAY = "2026-10-01"; // čtvrtek
const b = (dueKey, isLate = false, today = TODAY) => bucketOf({ dueKey, isLate }, today);

// --- Skupiny ---------------------------------------------------------------
zkouska("po termínu (příznak)", b("2026-09-28", true) === "late", "databáze říká, že je pozdě");
zkouska("po termínu (jistota)", b("2026-09-28", false) === "late", "termín v minulosti je po termínu i bez příznaku");
zkouska("dnes", b("2026-10-01") === "today", "termín dnes");
zkouska("zítra", b("2026-10-02") === "tomorrow", "termín zítra");
zkouska("tento týden", b("2026-10-04") === "week", "neděle je ještě tenhle týden");
zkouska("pozítří je týden", b("2026-10-03") === "week", "sobota");
zkouska("příští týden", b("2026-10-05") === "later", "pondělí je už později");
zkouska("daleko", b("2027-03-01") === "later", "za půl roku");
zkouska("bez termínu", b(null) === "none", "žádný termín");
zkouska("příznak má přednost", b(null, true) === "late", "pozdní úkol bez data se nepočítá jako bez termínu");

// --- Hranice týdne -------------------------------------------------------------
zkouska("v neděli: zítřek", b("2026-10-05", false, "2026-10-04") === "tomorrow", "pondělí je zítra");
zkouska("v neděli: týden prázdný", b("2026-10-06", false, "2026-10-04") === "later", "úterý je už později, neděle týden zavírá");
zkouska("v sobotu: zítřek", b("2026-10-04", false, "2026-10-03") === "tomorrow", "neděle je zítra");
zkouska("v pondělí: celý týden", b("2026-10-04", false, "2026-09-28") === "week", "z pondělí je neděle ještě tento týden");
zkouska("v pondělí: příští", b("2026-10-05", false, "2026-09-28") === "later", "další pondělí je později");

// --- Seskupení a řazení ------------------------------------------------------------
const item = (title, dueKey, isLate = false, priority = false) => ({ title, dueKey, isLate, priority });
const g = groupByBucket(
  [
    item("Bez termínu B", null),
    item("Příští", "2026-10-09"),
    item("Dnes obyčejný", "2026-10-01"),
    item("Dnes hlavní", "2026-10-01", false, true),
    item("Pozdní", "2026-09-20", true),
    item("Zítra", "2026-10-02"),
    item("Bez termínu A", null),
    item("Týden dřív", "2026-10-03"),
    item("Týden později", "2026-10-04"),
  ],
  TODAY,
);

zkouska("pořadí skupin", g.map((x) => x.bucket).join(",") === "late,today,tomorrow,week,later,none", "po termínu → dnes → zítra → týden → později → bez termínu");
zkouska("hlavní klient první", g.find((x) => x.bucket === "today").items.map((i) => i.title).join(",") === "Dnes hlavní,Dnes obyčejný", "v rámci dne stojí hlavní klient před ostatními");
zkouska("týden podle data", g.find((x) => x.bucket === "week").items.map((i) => i.title).join(",") === "Týden dřív,Týden později", "uvnitř skupiny nejbližší termín první");
zkouska("bez termínu abecedně", g.find((x) => x.bucket === "none").items.map((i) => i.title).join(",") === "Bez termínu A,Bez termínu B", "bez data se řadí podle názvu");
zkouska("prázdné se vynechají", groupByBucket([item("X", "2026-10-01")], TODAY).length === 1, "skupiny bez úkolů se neukazují");
zkouska("hlavní klient neskáče", groupByBucket([item("Hlavní příští týden", "2026-10-09", false, true), item("Dnes", "2026-10-01")], TODAY)[0].bucket === "today", "priorita řadí jen uvnitř skupiny, nepřeskakuje termín");
zkouska("popisky", BUCKET_LABEL.late === "Po termínu" && BUCKET_LABEL.none === "Bez termínu", "česky");

// Žádná otevřená spojení, proces doběhne sám. `process.exit()` hned po zápisu
// do roury na Windows občas spadne v knihovně libuv a vrátí chybný kód.
console.log(chyby === 0 ? "\nRozdělení podle termínu drží." : `\nProblémů: ${chyby}`);
process.exitCode = chyby === 0 ? 0 : 1;
