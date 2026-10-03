/**
 * Třídění pošty — pravidla bez Gmailu, bez databáze a bez AI. Spouští se
 * přímo nad zdrojovým souborem (Node umí TypeScript bez překladu).
 */
import {
  parseFrom,
  domainOf,
  isPublicDomain,
  matchClient,
  matchesIgnored,
  threadStatus,
  triage,
} from "../lib/mail-rules.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(26)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(26)}ŠPATNĚ — ${popis}`); }
};

// --- Hlavička From -----------------------------------------------------------
let f = parseFrom("Jana Nováková <jana@firma.cz>");
zkouska("jméno a adresa", f?.email === "jana@firma.cz" && f?.name === "Jana Nováková", "běžný tvar");
f = parseFrom('"Nováková, Jana" <JANA@FIRMA.CZ>');
zkouska("uvozovky a velikost", f?.email === "jana@firma.cz" && f?.name === "Nováková, Jana", "uvozovky pryč, adresa malými");
f = parseFrom("jana@firma.cz");
zkouska("holá adresa", f?.email === "jana@firma.cz" && f?.name === null, "bez jména");
zkouska("nesmysl", parseFrom("bez adresy") === null && parseFrom("") === null && parseFrom(null) === null, "co není adresa, se zahodí");
zkouska("doména", domainOf("jana@sub.firma.cz") === "sub.firma.cz", "část za zavináčem");

// --- Veřejné poštovní služby ---------------------------------------------------
zkouska("veřejné domény", isPublicDomain("gmail.com") && isPublicDomain("Seznam.cz") && !isPublicDomain("ultramarine.cz"), "gmail a seznam ano, firemní ne");

// --- Přiřazení klienta ----------------------------------------------------------
const kontakty = [
  { clientId: "ume", emails: ["info@ultramarine.cz", "petr@ultramarine.cz"] },
  { clientId: "lipa", emails: ["pekarna@ulipy.cz"] },
  { clientId: "osoba", emails: ["klient.osobni@gmail.com"] },
];
zkouska("přesná adresa", matchClient("petr@ultramarine.cz", kontakty) === "ume", "shoda na adresu");
zkouska("velikost písmen", matchClient("PETR@Ultramarine.CZ", kontakty) === "ume", "velikost nerozhoduje");
zkouska("firemní doména", matchClient("nova.asistentka@ultramarine.cz", kontakty) === "ume", "neznámý člověk ze známé firmy");
zkouska("cizí doména", matchClient("kdokoliv@jinafirma.cz", kontakty) === null, "nic se nehádá");
zkouska("gmail klienta", matchClient("klient.osobni@gmail.com", kontakty) === "osoba", "přesná adresa na gmailu funguje");
zkouska("cizí gmail", matchClient("nekdo.uplne.jiny@gmail.com", kontakty) === null, "podle gmail.com se klient nepřiřadí");

const dvojice = [
  { clientId: "a", emails: ["a@spolecna.cz"] },
  { clientId: "b", emails: ["b@spolecna.cz"] },
];
zkouska("sdílená doména", matchClient("c@spolecna.cz", dvojice) === null, "když doména sedí dvěma, nehádá se");
zkouska("přesná vítězí", matchClient("a@spolecna.cz", dvojice) === "a", "přesná shoda rozhodne i u sdílené domény");

// --- Ignorovaní odesílatelé -------------------------------------------------------
const ignorovani = ["noreply@sluzba.cz", "newsletter.cz", "@spam.com"];
zkouska("ignorovaná adresa", matchesIgnored("noreply@sluzba.cz", ignorovani), "celá adresa");
zkouska("ignorovaná doména", matchesIgnored("cokoliv@newsletter.cz", ignorovani), "doména");
zkouska("zavináč navíc", matchesIgnored("x@spam.com", ignorovani), "vzorec se zavináčem na začátku");
zkouska("neignorovaný", !matchesIgnored("jana@firma.cz", ignorovani), "běžná adresa projde");
zkouska("doména není adresa", !matchesIgnored("newsletter.cz@jinde.cz", ignorovani), "doménový vzorec nesedí na část adresy");

// --- Čeká na odpověď? -------------------------------------------------------------
const JA = "petera.tomas11@gmail.com";
zkouska("oni poslední", threadStatus({ myEmail: JA, sendersInOrder: [JA, "jana@firma.cz"] }) === "waiting", "poslední psali oni → čeká na mě");
zkouska("já poslední", threadStatus({ myEmail: JA, sendersInOrder: ["jana@firma.cz", JA] }) === "info", "odpověděl jsem → neřeším");
zkouska("jen oni", threadStatus({ myEmail: JA, sendersInOrder: ["jana@firma.cz"] }) === "waiting", "nová zpráva bez odpovědi");
zkouska("velikost ve vlákně", threadStatus({ myEmail: JA, sendersInOrder: ["jana@firma.cz", JA.toUpperCase()] }) === "info", "velikost písmen nerozhoduje");
zkouska("prázdné vlákno", threadStatus({ myEmail: JA, sendersInOrder: [] }) === "info", "bez zpráv se nic nečeká");

// --- Celé třídění ------------------------------------------------------------------
const ctx = { myEmail: JA, contacts: kontakty, ignored: ignorovani };
const zpravy = [
  { gmailId: "1", threadId: "t1", from: "Petr <petr@ultramarine.cz>", subject: "  Nabídka   na   rukávy ", receivedAt: "2026-10-03T08:00:00Z", threadSenders: ["petr@ultramarine.cz"] },
  { gmailId: "2", threadId: "t2", from: "Jana <jana@ulipy.cz>", subject: "Korektury", receivedAt: "2026-10-03T10:00:00Z", threadSenders: ["jana@ulipy.cz", JA] },
  { gmailId: "3", threadId: "t3", from: "noreply@sluzba.cz", subject: "Faktura", receivedAt: "2026-10-03T09:00:00Z", threadSenders: ["noreply@sluzba.cz"] },
  { gmailId: "4", threadId: "t4", from: "rozbita hlavicka", subject: "X", receivedAt: "2026-10-03T07:00:00Z", threadSenders: [] },
  { gmailId: "5", threadId: "t5", from: JA, subject: "Moje odeslaná", receivedAt: "2026-10-03T11:00:00Z", threadSenders: [JA] },
];
const v = triage(zpravy, ctx);

zkouska("filtrování", v.map((x) => x.gmailId).join(",") === "2,1", "ignorovaný, rozbitý i vlastní e-mail vypadly");
zkouska("řazení", v[0].receivedAt > v[1].receivedAt, "nejnovější první");
zkouska("stav waiting", v.find((x) => x.gmailId === "1").status === "waiting", "nezodpovězená zpráva čeká");
zkouska("stav info", v.find((x) => x.gmailId === "2").status === "info", "zodpovězená ne");
zkouska("klient podle domény", v.find((x) => x.gmailId === "1").clientId === "ume", "petr@ultramarine.cz → ULTRA MARINE");
zkouska("nový člověk z firmy", v.find((x) => x.gmailId === "2").clientId === "lipa", "jana@ulipy.cz v kontaktech není, ale doména sedí na pekarna@ulipy.cz");
zkouska("čištění předmětu", v.find((x) => x.gmailId === "1").subject === "Nabídka na rukávy", "zdvojené mezery pryč");
zkouska("jméno odesílatele", v.find((x) => x.gmailId === "1").fromName === "Petr", "jméno se zachová");

const duplicitni = triage([zpravy[0], zpravy[0]], ctx);
zkouska("duplicity", duplicitni.length === 1, "stejná zpráva dvakrát se uloží jednou");
zkouska("prázdný vstup", triage([], ctx).length === 0, "nic na vstupu, nic na výstupu");

const bezPredmetu = triage([{ ...zpravy[0], subject: "   " }], ctx);
zkouska("prázdný předmět", bezPredmetu[0].subject === null, "samé mezery = žádný předmět");

// Žádná otevřená spojení, proces doběhne sám. `process.exit()` hned po zápisu
// do roury na Windows občas spadne v knihovně libuv a vrátí chybný kód.
console.log(chyby === 0 ? "\nPravidla třídění pošty drží." : `\nProblémů: ${chyby}`);
process.exitCode = chyby === 0 ? 0 : 1;
