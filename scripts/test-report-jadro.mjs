/**
 * Jádro týdenního reportu — co do týdne patří, jak se to rozpadne a jaké
 * podklady dostane AI. Bez databáze a bez AI.
 *
 * Nejdůležitější je report zúžený na jednoho klienta: posílá se jemu, takže
 * v něm nesmí být práce pro nikoho jiného — ani v číslech, ani v podkladech
 * pro shrnutí, ani kdyby dotaz do databáze vrátil víc, než měl.
 */
import { aggregateReport, buildReportPrompt, REPORT_SYSTEM } from "../lib/report-core.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(28)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(28)}ŠPATNĚ — ${popis}`); }
};

// Týden 28. 9. – 4. 10. 2026.
const TYDEN = { start: new Date("2026-09-28T00:00:00"), end: new Date("2026-10-04T23:59:59.999") };
const KATEGORIE = new Map([["tisk", "Tisk"], ["grafika", "Grafika"], ["admin", "Administrativa"]]);
const UME = { id: "ume", name: "ULTRA MARINE EUROPE s.r.o." };

const ukol = (over = {}) => ({
  title: "Úkol",
  client_id: null,
  client_name: null,
  supplier_name: null,
  ball: "me",
  step_name: "Dělám",
  size: 2,
  is_late: false,
  due_at: null,
  closed_at: null,
  category_id: null,
  ...over,
});
const proUme = (over) => ukol({ client_id: "ume", client_name: UME.name, ...over });
const proLipu = (over) => ukol({ client_id: "lipa", client_name: "Pekárna U Lípy", ...over });
const hotovo = (kdy) => ({ ball: "done", step_name: "Hotovo", closed_at: kdy });

const RADKY = [
  proUme({ title: "Katalog jaro, sazba", category_id: "grafika", size: 3, ...hotovo("2026-09-30T10:00:00") }),
  proUme({ title: "Vizitky pro obchodníky", category_id: "tisk", size: 1, ...hotovo("2026-10-02T15:00:00") }),
  proUme({ title: "Bannery na web", category_id: "grafika", ball: "client", step_name: "U klienta" }),
  proUme({ title: "Roll-up 2 ks", category_id: "tisk", ball: "supplier", step_name: "V tisku", supplier_name: "Tiskárna Nová", is_late: true }),
  proUme({ title: "Ceník 2027", category_id: "grafika", ball: "me", step_name: "Dělám" }),
  proUme({ title: "Starý leták", category_id: "tisk", ...hotovo("2026-09-10T10:00:00") }),
  proLipu({ title: "Letáky A5", category_id: "tisk", size: 2, ...hotovo("2026-10-01T09:00:00") }),
  proLipu({ title: "Cenovky", category_id: "grafika", ball: "client", step_name: "U klienta" }),
  ukol({ title: "Vyúčtování za září", category_id: "admin", size: 1, ...hotovo("2026-10-01T12:00:00") }),
  ukol({ title: "Objednat papír", category_id: "admin", ball: "me", step_name: "Zadáno" }),
];
const nazvy = (items) => items.map((t) => t.title);

// --- Report za celé studio ---------------------------------------------------------
let d = aggregateReport(RADKY, KATEGORIE, TYDEN);
zkouska("studio: uzavřeno", JSON.stringify(nazvy(d.done)) === JSON.stringify(["Katalog jaro, sazba", "Vizitky pro obchodníky", "Letáky A5", "Vyúčtování za září"]), "čtyři úkoly uzavřené v týdnu; uzavřený 10. 9. do něj nepatří");
zkouska("studio: čísla", d.counts.done === 4 && d.counts.me === 2 && d.counts.client === 2 && d.counts.supplier === 1 && d.counts.late === 1, "uzavřeno 4, u nás 2, u klienta 2, u dodavatele 1, po termínu 1");
zkouska("studio: po klientech", d.byClient.length === 3 && d.byClient.map((g) => g.client).includes("Interní a provozní") && d.byClient.reduce((s, g) => s + g.percent, 0) >= 99, "tři skupiny včetně interní práce, podíly dávají dohromady celek");
zkouska("studio: kam šel týden", d.byCategory.find((c) => c.category === "Grafika")?.count === 1 && d.byCategory.find((c) => c.category === "Tisk")?.count === 2 && d.byCategory.find((c) => c.category === "Administrativa")?.count === 1, "kategorie se počítají jen z uzavřených");
zkouska("studio: bez zúžení", d.client === null && d.label.length > 0 && d.rangeText.length > 0, "report za studio nemá klienta");

let p = buildReportPrompt(d);
zkouska("studio: podklady", p.includes("- Katalog jaro, sazba [ULTRA MARINE EUROPE s.r.o.]") && p.includes("- Letáky A5 [Pekárna U Lípy]") && p.includes("- Vyúčtování za září\n") && !p.includes("Report je jen o práci"), "u položek je klient v závorce, interní práce bez něj");
zkouska("studio: čeká se", p.includes("- Roll-up 2 ks [ULTRA MARINE EUROPE s.r.o.] — U dodavatele, Tiskárna Nová, PO TERMÍNU") && p.includes("- Cenovky [Pekárna U Lípy] — U klienta"), "kdo to má a že je to po termínu");

// --- Report pro jednoho klienta -----------------------------------------------------
d = aggregateReport(RADKY, KATEGORIE, TYDEN, UME);
zkouska("klient: uzavřeno", JSON.stringify(nazvy(d.done)) === JSON.stringify(["Katalog jaro, sazba", "Vizitky pro obchodníky"]), "jen jeho práce uzavřená v týdnu");
zkouska("klient: čísla", d.counts.done === 2 && d.counts.me === 1 && d.counts.client === 1 && d.counts.supplier === 1 && d.counts.late === 1, "čísla jen z jeho úkolů");
zkouska("klient: nic cizího", ![...d.done, ...d.open].some((t) => t.clientName !== UME.name), "práce pro jiné klienty ani interní úkoly v něm nejsou");
zkouska("klient: jedna skupina", d.byClient.length === 1 && d.byClient[0].client === UME.name && d.byClient[0].percent === 100, "rozpad má jedinou skupinu");
zkouska("klient: kategorie", d.byCategory.length === 2 && !d.byCategory.some((c) => c.category === "Administrativa"), "administrativa studia do jeho reportu nepatří");
zkouska("klient: zúžení v datech", d.client?.id === "ume" && d.client?.name === UME.name, "report ví, pro koho je");

p = buildReportPrompt(d);
zkouska("klient: podklady", p.includes("Report je jen o práci pro klienta: ULTRA MARINE EUROPE s.r.o.") && p.includes("- Katalog jaro, sazba\n") && !p.includes("["), "věta, pro koho report je; jméno klienta se u položek neopakuje");
zkouska("klient: bez cizí práce", !p.includes("Pekárna") && !p.includes("Letáky A5") && !p.includes("Vyúčtování") && !p.includes("Objednat papír") && !p.includes("Cenovky"), "v podkladech pro shrnutí není nic od jiných klientů ani interního");
zkouska("klient: čeká se", p.includes("- Roll-up 2 ks — U dodavatele, Tiskárna Nová, PO TERMÍNU") && p.includes("- Bannery na web — U klienta") && p.includes("- Ceník 2027 (Dělám)"), "co čeká a co je rozpracované");

// --- Krajní případy -------------------------------------------------------------------
d = aggregateReport(RADKY, KATEGORIE, TYDEN, { id: "nikdo", name: "Klient bez úkolů" });
zkouska("klient bez úkolů", d.done.length === 0 && d.open.length === 0 && d.byClient.length === 0 && d.counts.done === 0, "prázdný report, ne report za všechny");
zkouska("prázdné podklady", buildReportPrompt(d).includes("Uzavřeno v období:\n  (nic)"), "AI se řekne, že nic uzavřeno není");

d = aggregateReport(
  [
    ukol({ title: "Na začátku", ...hotovo(TYDEN.start.toISOString()) }),
    ukol({ title: "Na konci", ...hotovo(TYDEN.end.toISOString()) }),
    ukol({ title: "Těsně před", ...hotovo(new Date(TYDEN.start.getTime() - 1).toISOString()) }),
    ukol({ title: "Těsně po", ...hotovo(new Date(TYDEN.end.getTime() + 1).toISOString()) }),
  ],
  KATEGORIE,
  TYDEN,
);
zkouska("hranice týdne", JSON.stringify(nazvy(d.done)) === JSON.stringify(["Na začátku", "Na konci"]), "první i poslední okamžik týdne do něj patří, milisekunda vedle už ne");
zkouska("bez kategorie", d.byCategory.length === 1 && d.byCategory[0].category === "Nezařazeno", "úkoly bez kategorie mají vlastní řádek");

zkouska("zadání pro AI", REPORT_SYSTEM.includes("Vycházej jen z dodaných dat") && REPORT_SYSTEM.includes("Žádné oslovení"), "pravidla psaní zůstala");

// Žádná otevřená spojení, proces doběhne sám.
console.log(chyby === 0 ? "\nJádro reportu drží." : `\nProblémů: ${chyby}`);
process.exitCode = chyby === 0 ? 0 : 1;
