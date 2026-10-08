/**
 * Značky jako klienti, poznámky s odkazy, záloha a podklad pro fakturaci —
 * čistá logika bez sítě a bez databáze.
 *
 * Nejvíc záleží na přeřazování úkolů podle názvu: appka ho jen navrhuje, ale
 * špatný návrh by přestěhoval práci pod cizí značku. Test proto hlídá hlavně
 * to, kdy se návrh udělat NEMÁ.
 */
import { labelClientName, matchBrand, normalizeName, planLabelClients, suggestMoves } from "../lib/brand-match.ts";
import { gmailThreadUrl, linkLabel, noteParts, withMailLink } from "../lib/links.ts";
import { csvDate, toCsv } from "../lib/csv.ts";
import { buildInvoice, invoiceText, isMonthKey, monthLabel, shiftMonth } from "../lib/invoice.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(26)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(26)}ŠPATNĚ — ${popis}`); }
};
const stejne = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- Jméno klienta ze štítku -------------------------------------------------------------------
zkouska("štítek: jméno", labelClientName("Ultra_Marine/MRL") === "MRL" && labelClientName("Ultra_Marine/Tiskarna UME") === "Tiskarna UME" && labelClientName("Ultra_Marine") === "Ultra Marine" && labelClientName("  A/B/  Zdravě  žít ") === "Zdravě žít", "poslední část štítku, podtržítka jako mezery");
zkouska("bez háčků", normalizeName("Tiskárna ÚME") === "tiskarna ume", "háčky a velikost písmen nerozhodují");

const PALETA = ["#111111", "#222222", "#333333"];
const STAVAJICI = [{ id: "ume", name: "ULTRA MARINE EUROPE s.r.o.", color: "#111111" }, { id: "tisk", name: "Tiskárna UME", color: "#999999" }];
let plan = planLabelClients(
  [{ id: "L1", name: "Ultra_Marine/MRL" }, { id: "L2", name: "Ultra_Marine/Tiskarna UME" }, { id: "L3", name: "Jine/MRL" }, { id: "L4", name: "Metstrade" }],
  STAVAJICI, PALETA,
);
zkouska("štítky: co založit", stejne(plan.create, [{ labelId: "L1", name: "MRL", color: "#222222" }, { labelId: "L4", name: "Metstrade", color: "#333333" }]), "nový klient jen jednou, s barvou, kterou ještě nikdo nemá");
zkouska("štítky: stávající", stejne(plan.reuse, { L2: "tisk" }), "klient stejného jména (i bez háčků) se nezakládá podruhé");
plan = planLabelClients([{ id: "A", name: "A" }, { id: "B", name: "B" }, { id: "C", name: "C" }, { id: "D", name: "D" }], [], ["#1", "#2"]);
zkouska("štítky: došly barvy", plan.create.length === 4 && plan.create[0].color === "#1" && plan.create[1].color === "#2" && plan.create.every((c) => c.color), "když paleta dojde, barvy se začnou opakovat — bez barvy nezůstane nikdo");
zkouska("štítky: prázdno", planLabelClients([], STAVAJICI, PALETA).create.length === 0 && planLabelClients([{ id: "X", name: "//" }], [], PALETA).create.length === 0, "bez štítků nebo bez jména se nic nezakládá");

// --- Komu úkol podle názvu patří -----------------------------------------------------------------
const KLIENTI = [
  { id: "ume", name: "ULTRA MARINE EUROPE s.r.o." },
  { id: "mrl", name: "MR.LETTER" },
  { id: "met", name: "Metstrade" },
  { id: "tisk", name: "Tiskárna UME" },
  { id: "u", name: "UME" },
];
zkouska("název: značka", matchBrand("Zpracovat tiskovou zprávu pro METSTRADE", KLIENTI) === "met" && matchBrand("Banner pro MR.LETTER", KLIENTI) === "mrl" && matchBrand("banner mr letter – web", KLIENTI) === "mrl", "bez ohledu na velikost písmen a tečku ve jméně");
zkouska("název: celé slovo", matchBrand("Dokument pro klienta", KLIENTI) === null && matchBrand("Newsletter říjen", KLIENTI) === null && matchBrand("Katalog UME 2027", KLIENTI) === "u", "„UME“ není v „dokument“, „letter“ není v „newsletter“");
zkouska("název: delší vyhrává", matchBrand("Korektura pro Tiskárnu UME", KLIENTI) === "u" && matchBrand("Korektura — tiskarna ume", KLIENTI) === "tisk", "víceslovné jméno má přednost před jeho částí; skloněné jméno se nepozná");
zkouska("název: firma", matchBrand("Podklady pro Ultra Marine", KLIENTI) === "ume" && matchBrand("Podklady pro Europe", KLIENTI) === null, "„s.r.o.“ a „Europe“ se do jména nepočítají — a samy nestačí");
zkouska("název: shoda", matchBrand("Leták Alfa", [{ id: "a1", name: "Alfa" }, { id: "a2", name: "ALFA s.r.o." }]) === null, "dva klienti stejného jména — nehádá se");
zkouska("název: nic", matchBrand("", KLIENTI) === null && matchBrand("Banner", []) === null && matchBrand("X", [{ id: "x", name: "s.r.o." }]) === null, "prázdný název, žádní klienti, jméno jen z obecných slov");

const UKOLY = [
  { id: "1", title: "Tisková zpráva pro METSTRADE", client_id: "ume" },
  { id: "2", title: "Banner MR.LETTER", client_id: null },
  { id: "3", title: "Katalog METSTRADE", client_id: "met" },
  { id: "4", title: "Faktura", client_id: "ume" },
  { id: "5", title: "Metstrade — plakát", client_id: "mrl" },
];
const navrhy = suggestMoves(UKOLY, KLIENTI);
zkouska("přeřazení: návrh", stejne(navrhy, [{ clientId: "met", tasks: [{ id: "1", title: "Tisková zpráva pro METSTRADE" }, { id: "5", title: "Metstrade — plakát" }] }, { clientId: "mrl", tasks: [{ id: "2", title: "Banner MR.LETTER" }] }]), "jen úkoly, které patří jinam; správně zařazený a úkol bez značky se nehýbou");
zkouska("přeřazení: prázdno", suggestMoves([], KLIENTI).length === 0 && suggestMoves(UKOLY, []).length === 0, "bez úkolů nebo bez klientů žádný návrh");

// --- Odkazy v poznámce ------------------------------------------------------------------------------
let casti = noteParts("Podklady: https://drive.google.com/drive/folders/abc123?usp=sharing, zadání viz e-mail.");
zkouska("poznámka: odkaz", casti.length === 3 && casti[0].text === "Podklady: " && casti[1].kind === "link" && casti[1].url === "https://drive.google.com/drive/folders/abc123?usp=sharing" && casti[2].text === ", zadání viz e-mail.", "adresa je odkaz, čárka za ní už ne");
zkouska("poznámka: popisek", casti[1].label === "drive.google.com/drive/folders/abc123?usp…" && linkLabel("https://www.wetransfer.com/") === "wetransfer.com" && linkLabel("nesmysl") === "nesmysl", "doména a začátek cesty, bez www");
casti = noteParts("(viz https://a.cz/x) a http://b.cz.");
zkouska("poznámka: závorka", casti.filter((c) => c.kind === "link").map((c) => c.url).join(" ") === "https://a.cz/x http://b.cz", "závorka a tečka na konci k adrese nepatří");
zkouska("poznámka: jen http", noteParts("javascript:alert(1) ftp://x.cz <a href=x>").every((c) => c.kind === "text") && noteParts(null).length === 0 && noteParts("").length === 0, "nic jiného než http(s) se odkazem nestane");
const ODKAZ = gmailThreadUrl("abc123", "tomas+prace@example.com");
zkouska("e-mail: odkaz", ODKAZ === "https://mail.google.com/mail/u/?authuser=tomas%2Bprace%40example.com#all/abc123" && linkLabel(ODKAZ) === "e-mail v Gmailu", "vlákno v Gmailu pod správným účtem");
zkouska("e-mail: do poznámky", withMailLink(null, "abc123", "a@b.cz") === "E-mail: https://mail.google.com/mail/u/?authuser=a%40b.cz#all/abc123" && withMailLink("  Ze zprávy klienta  ", "t", "a@b.cz").startsWith("Ze zprávy klienta\nE-mail: https://") && withMailLink(withMailLink("X", "t", "a@b.cz"), "t", "a@b.cz") === withMailLink("X", "t", "a@b.cz"), "za stávající poznámku, a jen jednou");

// --- Záloha do Excelu ---------------------------------------------------------------------------------
const csv = toCsv(["Název", "Klient", "Hotovo"], [["Leták; A5", "Pekárna \"U Lípy\"", true], ["=SUM(A1)", null, false], ["Víc\nřádků", 3, undefined], ["-5 %", "+420", "@x"]]);
zkouska("csv: hlavička", csv.startsWith("﻿Název;Klient;Hotovo\r\n") && csv.endsWith("\r\n"), "BOM pro Excel, středníky a konce řádků pro Windows");
zkouska("csv: uvozovky", csv.includes('"Leták; A5";"Pekárna ""U Lípy""";ano') && csv.includes('"Víc\nřádků";3;'), "středník, uvozovky a nový řádek uvnitř buňky");
zkouska("csv: vzorce", csv.includes("'=SUM(A1);;ne") && csv.includes("'-5 %;'+420;'@x"), "buňka, která by se spustila jako vzorec, dostane apostrof");
zkouska("csv: datum", csvDate("2026-10-08") === "8. 10. 2026" && csvDate("2026-10-08T22:00:00Z") === "8. 10. 2026" && csvDate(null) === "" && csvDate("nesmysl") === "", "datum česky, prázdné když chybí");

// --- Podklad pro fakturaci ------------------------------------------------------------------------------
const hotovy = (id, title, client, closed, size = 2) => ({ id, title, client_id: client, client_name: client ? client.toUpperCase() : null, client_color: null, closed_at: closed, size });
const HOTOVE = [
  hotovy("a", "Banner", "mrl", "2026-10-02T10:00:00Z"),
  hotovy("b", "Katalog", "mrl", "2026-10-31T22:30:00Z", 3), // v Praze už 31. 10. 23:30 — pořád říjen
  hotovy("c", "Silvestr", "mrl", "2026-10-31T23:30:00Z"),   // v Praze 1. 11. 0:30 — listopad
  hotovy("d", "Vizitky", "ume", "2026-10-15T08:00:00Z", 1),
  hotovy("e", "Úklid disku", null, "2026-10-20T08:00:00Z"),
  hotovy("f", "Zářijový", "ume", "2026-09-30T21:30:00Z"),    // v Praze 30. 9. 23:30 — září
  hotovy("g", "Rozdělaný", "ume", null),
  hotovy("h", "Aleš první", "mrl", "2026-10-02T09:00:00Z"),
];
const f = buildInvoice(HOTOVE, "2026-10");
zkouska("fakturace: měsíc", f.label === "říjen 2026" && f.prev === "2026-09" && f.next === "2026-11" && f.total === 5, "jen úkoly uzavřené v tom měsíci podle Prahy");
zkouska("fakturace: skupiny", stejne(f.groups.map((g) => [g.client, g.items.map((t) => t.title)]), [["MRL", ["Aleš první", "Banner", "Katalog"]], ["UME", ["Vizitky"]], ["Bez klienta (interní)", ["Úklid disku"]]]), "po klientech abecedně, uvnitř podle data; práce bez klienta nakonec");
zkouska("fakturace: řádek", f.groups[0].items[2].closedLabel === "31. 10." && f.groups[0].items[2].size === "velký" && f.groups[1].items[0].size === "malý", "kdy bylo hotovo a jak velký úkol to byl");
zkouska("fakturace: text", invoiceText(f) === "Hotová práce — říjen 2026\n\nMRL (3 úkoly)\n– 2. 10. Aleš první\n– 2. 10. Banner\n– 31. 10. Katalog\n\nUME (1 úkol)\n– 15. 10. Vizitky\n\nBez klienta (interní) (1 úkol)\n– 20. 10. Úklid disku\n\nCelkem 5 úkolů.", "celý měsíc jako text");
zkouska("fakturace: jeden klient", invoiceText(f, "ume") === "Hotová práce — říjen 2026\n\nUME (1 úkol)\n– 15. 10. Vizitky" && invoiceText(f, "nikdo").includes("neuzavřel žádný úkol"), "jen jedna značka, bez součtu; neznámý klient = prázdno");
zkouska("fakturace: prázdný měsíc", buildInvoice(HOTOVE, "2026-08").total === 0 && invoiceText(buildInvoice([], "2026-08")).includes("neuzavřel žádný úkol"), "měsíc bez hotové práce to řekne");
zkouska("fakturace: přes rok", shiftMonth("2026-12", 1) === "2027-01" && shiftMonth("2027-01", -1) === "2026-12" && monthLabel("2027-01") === "leden 2027" && isMonthKey("2026-10") && !isMonthKey("2026-13") && !isMonthKey("2026-1") && !isMonthKey(null), "prosinec → leden a platnost klíče měsíce");
zkouska("fakturace: listopad", buildInvoice(HOTOVE, "2026-11").groups[0].items[0].title === "Silvestr" && buildInvoice(HOTOVE, "2026-09").groups[0].items[0].title === "Zářijový", "půlnoc se počítá podle Prahy, ne podle serveru");

// Žádná otevřená spojení, proces doběhne sám.
console.log(chyby === 0 ? "\nZnačky, poznámky, záloha a fakturace drží." : `\nProblémů: ${chyby}`);
process.exitCode = chyby === 0 ? 0 : 1;
