import { CS_MONTHS_FULL, SIZE_LABEL, dateKeyPrague } from "./domain.ts";

/**
 * Podklad pro fakturaci — čistá logika bez databáze a bez AI.
 *
 * Co se za měsíc uzavřelo, po klientech (značkách). Není to faktura a nejsou
 * v tom ceny ani hodiny — appka je neeviduje. Je to seznam hotové práce, ze
 * kterého se faktura píše: co, pro koho a kdy bylo hotové.
 *
 * Měsíc se počítá podle Prahy: úkol uzavřený 31. v 23:30 našeho času patří
 * do toho měsíce, i když je na serveru už další den.
 */

export type InvoiceInput = {
  id: string;
  title: string;
  client_id: string | null;
  client_name: string | null;
  client_color: string | null;
  /** Okamžik uzavření (ISO); `null` u otevřeného úkolu. */
  closed_at: string | null;
  size: number;
};

export type InvoiceItem = { id: string; title: string; closedKey: string; closedLabel: string; size: string };

export type InvoiceGroup = {
  clientId: string | null;
  client: string;
  color: string | null;
  items: InvoiceItem[];
};

export type InvoiceBasis = {
  /** „2026-10“ */
  month: string;
  /** „říjen 2026“ */
  label: string;
  prev: string;
  next: string;
  groups: InvoiceGroup[];
  total: number;
};

const MESIC = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string | null | undefined): value is string {
  return typeof value === "string" && MESIC.test(value);
}

/** Měsíc o `delta` dál nebo zpátky. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${CS_MONTHS_FULL[m - 1].toLowerCase()} ${y}`;
}

const den = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  return `${d}. ${m}.`;
};

/** Práce bez klienta má vlastní skupinu na konci — do faktury obvykle nepatří. */
const BEZ_KLIENTA = "Bez klienta (interní)";

export function buildInvoice(tasks: InvoiceInput[], month: string): InvoiceBasis {
  const skupiny = new Map<string, InvoiceGroup>();

  for (const t of tasks) {
    if (!t.closed_at) continue;
    const closedKey = dateKeyPrague(t.closed_at);
    if (closedKey.slice(0, 7) !== month) continue;

    const klic = t.client_id ?? "";
    const skupina = skupiny.get(klic) ?? {
      clientId: t.client_id,
      client: t.client_id ? (t.client_name ?? "Klient") : BEZ_KLIENTA,
      color: t.client_color,
      items: [],
    };
    skupina.items.push({ id: t.id, title: t.title, closedKey, closedLabel: den(closedKey), size: SIZE_LABEL[t.size] ?? "" });
    skupiny.set(klic, skupina);
  }

  const groups = [...skupiny.values()]
    .map((g) => ({ ...g, items: g.items.sort((a, b) => a.closedKey.localeCompare(b.closedKey) || a.title.localeCompare(b.title, "cs")) }))
    // Klienti abecedně, práce bez klienta nakonec.
    .sort((a, b) => Number(a.clientId === null) - Number(b.clientId === null) || a.client.localeCompare(b.client, "cs"));

  return {
    month,
    label: monthLabel(month),
    prev: shiftMonth(month, -1),
    next: shiftMonth(month, 1),
    groups,
    total: groups.reduce((n, g) => n + g.items.length, 0),
  };
}

const ukolu = (n: number) => (n === 1 ? "1 úkol" : n >= 2 && n <= 4 ? `${n} úkoly` : `${n} úkolů`);

/** Text ke zkopírování — celý měsíc, nebo jen jeden klient (`onlyClient`). */
export function invoiceText(basis: InvoiceBasis, onlyClient?: string | null): string {
  const groups = onlyClient === undefined ? basis.groups : basis.groups.filter((g) => g.clientId === onlyClient);
  const radky = [`Hotová práce — ${basis.label}`];

  for (const g of groups) {
    radky.push("", `${g.client} (${ukolu(g.items.length)})`);
    for (const t of g.items) radky.push(`– ${t.closedLabel} ${t.title}`);
  }
  if (groups.length === 0) radky.push("", "V tomhle měsíci se neuzavřel žádný úkol.");
  else if (groups.length > 1) radky.push("", `Celkem ${ukolu(groups.reduce((n, g) => n + g.items.length, 0))}.`);

  return radky.join("\n");
}
