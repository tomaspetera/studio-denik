import { isoWeekday } from "./presets.ts";
import type { Ball } from "./domain.ts";

/**
 * Týdenní report jako obyčejný text do e-mailu — čistá logika bez databáze
 * a bez AI.
 *
 * Report na obrazovce jde vytisknout do PDF a sdílet odkazem. Nejčastěji se
 * ale posílá prostě e-mailem, a tam je PDF i odkaz krok navíc: tenhle text se
 * zkopíruje a vloží. Říká totéž co arch na obrazovce — po klientech (značkách),
 * u každého úkolu, v jakém je stavu.
 */

export type ReportTextItem = {
  title: string;
  ball: Ball;
  stepName: string;
  supplierName: string | null;
  isLate: boolean;
};

export type ReportTextInput = {
  /** „5.–11. října 2026“. */
  rangeText: string;
  /** Klient, pro kterého report je; `null` = celé studio. */
  clientName: string | null;
  /** Shrnutí (od AI nebo upravené ručně); může být prázdné. */
  summary: string;
  byClient: { client: string; items: ReportTextItem[] }[];
  /** Jméno do podpisu. */
  signature: string | null;
};

/** Stav úkolu slovy, jak se říká klientovi — ne názvem kroku v appce. */
export function itemStatus(item: ReportTextItem, forClient: boolean): string {
  const stav =
    item.ball === "done"
      ? "hotovo"
      : item.ball === "client"
        ? forClient ? "čeká na vaše schválení" : "čeká na schválení klientem"
        : item.ball === "supplier"
          ? item.supplierName ? `u dodavatele (${item.supplierName})` : "u dodavatele"
          : item.stepName.trim().toLowerCase() === "zadáno"
            ? "v plánu"
            : "rozpracováno";
  return item.isLate ? `${stav}, po termínu` : stav;
}

export function reportMailText(input: ReportTextInput): string {
  const proKlienta = input.clientName !== null;
  const radky: string[] = ["Dobrý den,", "", `posílám přehled práce za týden ${input.rangeText}.`];

  const shrnuti = input.summary.trim();
  if (shrnuti) radky.push("", shrnuti);

  const skupiny = input.byClient.filter((g) => g.items.length > 0);
  for (const g of skupiny) {
    // U reportu pro jednoho klienta je nadpis s jeho jménem zbytečný.
    radky.push("", proKlienta ? "Co se dělalo:" : `${g.client}:`);
    for (const t of g.items) radky.push(`– ${t.title} (${itemStatus(t, proKlienta)})`);
  }
  if (skupiny.length === 0) radky.push("", "Tento týden se neuzavřel ani nerozpracoval žádný úkol.");

  // Co čeká na klienta, patří na konec zvlášť — je to jediná věc, kterou má po přečtení udělat.
  const ceka = skupiny.flatMap((g) => g.items.filter((t) => t.ball === "client").map((t) => (proKlienta ? t.title : `${t.title} (${g.client})`)));
  if (ceka.length > 0) {
    radky.push("", proKlienta ? "Od vás potřebuji schválit:" : "Čeká na schválení klientem:");
    for (const t of ceka) radky.push(`– ${t}`);
  }

  radky.push("", "S pozdravem", input.signature?.trim() || "[podpis]");
  return radky.join("\n");
}

/**
 * Páteční připomenutí v ranním upozornění. Report se posílá na konci týdne
 * a snadno se na něj zapomene; `null` mimo pátek a ve studiu bez úkolů.
 */
export function reportPushPart(today: string, taskCount: number): string | null {
  return isoWeekday(today) === 5 && taskCount > 0 ? "je pátek — pošli report" : null;
}
