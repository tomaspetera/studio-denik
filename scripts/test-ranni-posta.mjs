/**
 * Ranní načítání pošty — kdy běží, co se počítá a co se o tom říká. Bez sítě,
 * bez databáze a bez AI.
 *
 * Ranní běh čte Gmail, i když appku nikdo nemá otevřenou. Test proto hlídá,
 * že se to děje jen ve dny, na kterých je dohoda (úterý, středa, čtvrtek),
 * a že se do počtů dostane jen to, co opravdu čeká na odpověď.
 */
import { MAIL_AUTO_DAYS, isMailAutoDay, lastSyncLabel, mailLine, mailPushPart, morningPushBody } from "../lib/mail-schedule.ts";
import { mailCounts } from "../lib/mail-buckets.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(26)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(26)}ŠPATNĚ — ${popis}`); }
};
const stejne = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- Dny -------------------------------------------------------------------------
// Týden 5.–11. 10. 2026: pondělí 5., neděle 11.
const tyden = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];
zkouska("dny v týdnu", stejne(tyden.map(isMailAutoDay), [false, true, true, true, false, false, false]), "jen úterý, středa a čtvrtek");
zkouska("dohoda", stejne([...MAIL_AUTO_DAYS], [2, 3, 4]), "tři dny, jak je to domluvené");
zkouska("přes měsíc a rok", isMailAutoDay("2026-12-31") && !isMailAutoDay("2027-01-01") && isMailAutoDay("2027-01-05"), "čtvrtek 31. 12. ano, pátek 1. 1. ne, úterý 5. 1. ano");

// --- Počty --------------------------------------------------------------------------
const z = (over = {}) => ({ status: "waiting", handledAt: null, priority: null, ...over });
let c = mailCounts([
  z({ priority: "urgent" }),
  z({ priority: "reply" }),
  z(), // tříděním neprošla — čeká
  z({ priority: "info" }), // jen pro informaci
  z({ priority: "urgent", handledAt: "2026-10-06T08:00:00Z" }), // vyřízená
  z({ status: "info", priority: "urgent" }), // odpovězená
]);
zkouska("počty", stejne(c, { waiting: 3, urgent: 1 }), "čekají tři, jedna spěchá; informace, vyřízené a odpovězené se nepočítají");
zkouska("prázdná schránka", stejne(mailCounts([]), { waiting: 0, urgent: 0 }), "nic nečeká");
zkouska("bez třídění", stejne(mailCounts([z(), z()]), { waiting: 2, urgent: 0 }), "netříděné zprávy čekají — omyl nesmí zprávu schovat");

// --- Ranní upozornění ------------------------------------------------------------------
zkouska("upozornění: nic", mailPushPart({ waiting: 0, urgent: 0 }) === null, "když nic nečeká, o poště se mlčí");
zkouska("upozornění: čeká", mailPushPart({ waiting: 3, urgent: 0 }) === "pošta čeká 3", "jen počet");
zkouska("upozornění: spěchá", mailPushPart({ waiting: 3, urgent: 1 }) === "pošta čeká 3, spěchá 1", "a kolik z toho spěchá");

const ukoly = ["dnes končí 2", "po termínu 1"];
zkouska("souhrn: majitel", morningPushBody(ukoly, { waiting: 3, urgent: 1 }) === "dnes končí 2 · po termínu 1 · pošta čeká 3, spěchá 1", "úkoly studia a za nimi vlastní pošta");
zkouska("souhrn: kolega", morningPushBody(ukoly, undefined) === "dnes končí 2 · po termínu 1" && morningPushBody(ukoly, null) === "dnes končí 2 · po termínu 1", "kdo schránku nemá (nebo není jeho), o poště nic nedostane");
zkouska("souhrn: jen pošta", morningPushBody([], { waiting: 2, urgent: 0 }) === "pošta čeká 2", "bez úkolů přijde aspoň pošta");
zkouska("souhrn: nic", morningPushBody([], { waiting: 0, urgent: 0 }) === null && morningPushBody([], undefined) === null, "když nic nehoří a nic nečeká, upozornění se neposílá");
zkouska("souhrn: pošta nečeká", morningPushBody(ukoly, { waiting: 0, urgent: 0 }) === "dnes končí 2 · po termínu 1", "prázdná pošta souhrn úkolů nemění");

// --- Řádek na Dnes -------------------------------------------------------------------------
zkouska("řádek: nic", mailLine({ waiting: 0, urgent: 0 }) === null, "bez čekajících zpráv se řádek neukáže");
zkouska("řádek: skloňování", mailLine({ waiting: 1, urgent: 0 }) === "Čeká 1 zpráva" && mailLine({ waiting: 3, urgent: 0 }) === "Čekají 3 zprávy" && mailLine({ waiting: 7, urgent: 0 }) === "Čeká 7 zpráv", "jedna, tři, sedm");
zkouska("řádek: spěchá", mailLine({ waiting: 3, urgent: 1 }) === "Čekají 3 zprávy, 1 spěchá" && mailLine({ waiting: 7, urgent: 2 }) === "Čeká 7 zpráv, 2 spěchají" && mailLine({ waiting: 9, urgent: 5 }) === "Čeká 9 zpráv, 5 spěchá", "počet spěchajících ve správném tvaru");
zkouska("řádek: jediná spěchá", mailLine({ waiting: 1, urgent: 1 }) === "Čeká 1 zpráva a spěchá", "jedna zpráva, která spěchá");

// --- Kdy se naposledy načetla ------------------------------------------------------------------
// 6. 10. 2026 v Praze platí letní čas (UTC+2).
const ted = new Date("2026-10-06T09:30:00Z");
zkouska("načteno: dnes", lastSyncLabel("2026-10-06T05:12:00Z", ted) === "dnes v 7:12", "dnešní načtení s hodinou podle Prahy");
zkouska("načteno: dřív", lastSyncLabel("2026-10-03T19:49:00Z", ted) === "3. 10.", "starší jen datem");
zkouska("načteno: kolem půlnoci", lastSyncLabel("2026-10-05T22:30:00Z", ted) === "dnes v 0:30", "půl jedné ráno v Praze je už dnešek, i když v UTC je ještě včera");
zkouska("načteno: nikdy", lastSyncLabel(null, ted) === null && lastSyncLabel("nesmysl", ted) === null, "bez data nic");

// Žádná otevřená spojení, proces doběhne sám.
console.log(chyby === 0 ? "\nRanní načítání pošty: dny, počty i texty drží." : `\nProblémů: ${chyby}`);
process.exitCode = chyby === 0 ? 0 : 1;
