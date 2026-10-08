/**
 * Stránka Dnes — co se kam zařadí a co nabídne tlačítko na řádku. Bez sítě
 * a bez databáze.
 *
 * Dnes je první, co člověk ráno vidí. Test proto hlídá, že se v ní žádný
 * úkol neztratí ani neopakuje, že nahoře je opravdu to, co hoří, a že
 * tlačítko na řádku posune úkol na správný krok jeho štafety.
 */
import { TODAY_MINE_ROWS, buildToday } from "../lib/today.ts";
import { initials, mailWhen } from "../lib/mail-face.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(24)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(24)}ŠPATNĚ — ${popis}`); }
};
const stejne = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DNES = "2026-10-08"; // čtvrtek
const BALL = { interni: ["me", "me", "done"], klient: ["me", "me", "client", "done"], tisk: ["me", "me", "client", "supplier", "me", "done"] };
const NAZEV = { interni: ["Zadáno", "Dělám", "Hotovo"], klient: ["Zadáno", "Dělám", "U klienta", "Hotovo"], tisk: ["Zadáno", "Dělám", "Ke schválení", "V tisku", "Dodáno", "Předáno"] };
let poradi = 0;
const ukol = (title, over = {}) => {
  const kind = over.kind ?? "klient";
  const step = over.step ?? 0;
  const due = over.due ?? null;
  return {
    id: `u${++poradi}`, title, kind, step,
    ball: BALL[kind][step], step_name: NAZEV[kind][step],
    is_late: due !== null && due < DNES && BALL[kind][step] !== "done",
    due_at: due ? `${due}T00:00:00.000Z` : null,
    client_id: over.client ?? null, client_name: over.client ? "Klient" : null, client_color: null,
    supplier_name: over.supplier ?? null,
  };
};

const UKOLY = [
  ukol("Tisková zpráva", { due: "2026-10-05" }),
  ukol("Podklady pro značení", { due: "2026-10-07", client: "ume" }),
  ukol("Schůzka", { due: "2026-10-07" }),
  ukol("Banner na dnešek", { due: DNES, step: 1 }),
  ukol("Leták na zítřek", { due: "2026-10-09" }),
  ukol("Katalog", { due: "2026-10-11" }),
  ukol("Web", { due: "2026-11-20" }),
  ukol("Grafický manuál", {}),
  ukol("Vzorník papírů", { step: 2 }),
  ukol("Vizitky v tisku", { kind: "tisk", step: 3, due: "2026-10-12", supplier: "Indigoprint" }),
  ukol("Roll-up po termínu u tiskárny", { kind: "tisk", step: 3, due: "2026-10-06", supplier: "Indigoprint" }),
  ukol("Schválení dnes", { step: 2, due: DNES }),
  ukol("Hotová práce", { step: 3, due: "2026-10-01" }),
  ukol("Interní hotovo", { kind: "interni", step: 2 }),
];

const d = buildToday(UKOLY, DNES);
const nazvy = (seznam) => seznam.map((t) => t.title);

// --- Hoří --------------------------------------------------------------------------
zkouska("hoří: co tam je", stejne(nazvy(d.burning), ["Tisková zpráva", "Roll-up po termínu u tiskárny", "Podklady pro značení", "Schůzka", "Banner na dnešek"]), "po termínu od nejstaršího (i když leží jinde), pak moje dnešní");
zkouska("hoří: proč", d.burning[0].sub === "po termínu od 5. 10." && d.burning[1].sub === "po termínu od 6. 10. · u dodavatele" && d.burning[4].sub === "dnes · Dělám", "řádek říká, od kdy to hoří a u koho to leží");
zkouska("hoří: dnešek u klienta", !nazvy(d.burning).includes("Schválení dnes"), "co má termín dnes, ale leží u klienta, nehoří mně");

// --- Na tobě -------------------------------------------------------------------------
zkouska("na tobě: skupiny", stejne(d.mine.map((g) => [g.bucket, nazvy(g.items)]), [["tomorrow", ["Leták na zítřek"]], ["week", ["Katalog"]], ["later", ["Web"]], ["none", ["Grafický manuál"]]]), "zítra, tento týden, později, bez termínu");
zkouska("na tobě: popisek", d.mine[0].items[0].sub === "Pá 9. 10. · Zadáno" && d.mine[3].items[0].sub === "Zadáno", "termín se dnem v týdnu a krok; bez termínu jen krok");

// --- Čeká se na jiné --------------------------------------------------------------------
zkouska("čeká se: co tam je", stejne(nazvy(d.waiting), ["Schválení dnes", "Vizitky v tisku", "Vzorník papírů"]), "u klienta a u dodavatele, nejbližší termín první");
zkouska("čeká se: popisek", d.waiting[0].sub === "U klienta · termín dnes" && d.waiting[1].sub === "V tisku · Indigoprint · termín 12. 10." && d.waiting[2].sub === "U klienta", "krok, dodavatel a termín");

// --- Nic se neztratí ani neopakuje ---------------------------------------------------------
const vse = [...nazvy(d.burning), ...d.mine.flatMap((g) => nazvy(g.items)), ...nazvy(d.waiting)];
zkouska("každý právě jednou", vse.length === new Set(vse).size && vse.length === 12 && !vse.includes("Hotová práce") && !vse.includes("Interní hotovo"), "dvanáct otevřených úkolů, každý jednou; hotové tu nejsou");
zkouska("počty", stejne(d.counts, { late: 4, today: 1, mine: 8, noDue: 1, waiting: 4, client: 2, supplier: 2, done: 2 }), "po termínu, dnešní, na tobě, bez termínu, u jiných a uzavřené");

// --- Termín jako štítek a postup jako dílky ---------------------------------------------------
const kus = (title) => [...d.burning, ...d.mine.flatMap((g) => g.items), ...d.waiting].find((t) => t.title === title);
zkouska("termín: po termínu", kus("Tisková zpráva").dueLabel === "5. 10." && kus("Tisková zpráva").dueTone === "late" && kus("Tisková zpráva").lateDays === 3, "datum, červená a počet dní po termínu");
zkouska("termín: dnes a zítra", kus("Banner na dnešek").dueLabel === "dnes" && kus("Banner na dnešek").dueTone === "today" && kus("Leták na zítřek").dueLabel === "zítra" && kus("Leták na zítřek").dueTone === "soon", "nejbližší dny slovem");
zkouska("termín: tento týden a dál", kus("Katalog").dueLabel === "Ne 11. 10." && kus("Web").dueLabel === "20. 11.", "do týdne se dnem v týdnu, pak jen datum");
zkouska("termín: žádný", kus("Grafický manuál").dueLabel === null && kus("Grafický manuál").dueTone === "none" && kus("Grafický manuál").lateDays === 0, "bez termínu");
zkouska("dílky: klientský úkol", kus("Banner na dnešek").step === 1 && stejne(kus("Banner na dnešek").steps.map((s) => s.owner), ["me", "me", "client", "done"]) && kus("Banner na dnešek").ball === "me", "čtyři kroky, stojí na druhém, míč je u mě");
zkouska("dílky: tisk", kus("Vizitky v tisku").steps.length === 6 && kus("Vizitky v tisku").step === 3 && kus("Vizitky v tisku").ball === "supplier" && kus("Vizitky v tisku").stepName === "V tisku" && kus("Vizitky v tisku").supplierName === "Indigoprint" && kus("Banner na dnešek").supplierName === null, "šest kroků tiskové štafety, míč u dodavatele a jeho jméno");

// --- Tlačítka na řádku ------------------------------------------------------------------------
const najdi = (title) => [...d.burning, ...d.mine.flatMap((g) => g.items), ...d.waiting].find((t) => t.title === title);
zkouska("krok: ze zadání", stejne(najdi("Tisková zpráva").next, { step: 1, label: "Dělám" }) && stejne(najdi("Tisková zpráva").finish, { step: 3, label: "Hotovo" }), "další krok je „Dělám“, zkratka rovnou na „Hotovo“");
zkouska("krok: rozdělaný", stejne(najdi("Banner na dnešek").next, { step: 2, label: "U klienta" }) && stejne(najdi("Banner na dnešek").finish, { step: 3, label: "Hotovo" }), "z „Dělám“ ke klientovi, nebo rovnou hotovo");
zkouska("krok: u klienta", stejne(najdi("Vzorník papírů").next, { step: 3, label: "Hotovo" }) && najdi("Vzorník papírů").finish === null, "poslední krok je hned další — druhé tlačítko není potřeba");
zkouska("krok: tisk", stejne(najdi("Vizitky v tisku").next, { step: 4, label: "Dodáno" }) && stejne(najdi("Vizitky v tisku").finish, { step: 5, label: "Předáno" }), "tisková štafeta má vlastní kroky");

// --- Strop a pořadí ------------------------------------------------------------------------------
const mnoho = Array.from({ length: TODAY_MINE_ROWS + 5 }, (_, i) => ukol(`Bez termínu ${String(i).padStart(2, "0")}`));
let v = buildToday([ukol("Zítřejší", { due: "2026-10-09" }), ...mnoho], DNES);
zkouska("strop", v.mine.reduce((n, g) => n + g.items.length, 0) === TODAY_MINE_ROWS && v.mineHidden === 6 && v.mine[0].items[0].title === "Zítřejší", "ukáže se jen osm řádků, termínované první; zbytek je spočítaný za odkazem");
v = buildToday([ukol("B úkol", { due: "2026-10-05" }), ukol("A úkol", { due: "2026-10-05" }), ukol("Hlavní klient", { due: "2026-10-05", client: "ume" })], DNES, new Set(["ume"]));
zkouska("hlavní klient", stejne(nazvy(v.burning), ["Hlavní klient", "A úkol", "B úkol"]), "při stejném termínu jde první hlavní klient, pak abecedně");
v = buildToday([], DNES);
zkouska("prázdno", v.burning.length === 0 && v.mine.length === 0 && v.waiting.length === 0 && v.mineHidden === 0 && Object.values(v.counts).every((n) => n === 0), "bez úkolů nic nespadne");

// --- Pošta na řádku: iniciály a čas ----------------------------------------------------------------
zkouska("iniciály", initials("Jana Nováková", "jana@x.cz") === "JN" && initials("Ing. Petr van Svoboda", "p@x.cz") === "IS" && initials("Tiskárna", "t@x.cz") === "TI" && initials(null, "eva.mala@firma.cz") === "EV" && initials("  ", "@") === "?" && initials("Šárka Žáková", "s@x.cz") === "ŠŽ", "ze jména první a poslední slovo, jinak začátek adresy; s háčky");
const TED = new Date("2026-10-08T10:30:00Z"); // čtvrtek 12:30 v Praze
zkouska("čas zprávy", mailWhen("2026-10-08T07:04:00Z", TED) === "9:04" && mailWhen("2026-10-07T21:30:00Z", TED) === "včera" && mailWhen("2026-10-07T22:30:00Z", TED) === "0:30" && mailWhen("2026-10-05T08:00:00Z", TED) === "5. 10." && mailWhen("nesmysl", TED) === "", "dnes hodinou podle Prahy, včera slovem, jinak datem");

// Žádná otevřená spojení, proces doběhne sám.
console.log(chyby === 0 ? "\nDnes: zařazení úkolů i tlačítka drží." : `\nProblémů: ${chyby}`);
process.exitCode = chyby === 0 ? 0 : 1;
