import { BALL_LABEL, csRange, isoWeek, shareByCategory, type Ball } from "./domain.ts";

/**
 * Jádro týdenního reportu — čistá logika bez databáze a bez AI, aby šla
 * otestovat sama: co z úkolů patří do týdne, jak se rozpadnou, a jaké
 * podklady z toho dostane AI.
 *
 * Report je buď za celé studio, nebo zúžený na jednoho klienta (`client`).
 * Zúžený report je to, co se posílá klientovi nebo zaměstnavateli: nesmí
 * v něm být práce pro nikoho jiného — ani v číslech, ani v podkladech pro
 * shrnutí. Proto se úkoly filtrují i tady, ne jen v dotazu do databáze.
 */

export type ReportClient = { id: string; name: string };

/** Řádek pohledu `tasks_view`, jak ho report čte. */
export type ReportRow = {
  title: string;
  client_id: string | null;
  client_name: string | null;
  supplier_name: string | null;
  ball: Ball;
  step_name: string;
  size: number;
  is_late: boolean;
  due_at: string | null;
  closed_at: string | null;
  category_id: string | null;
};

export type ReportItem = {
  title: string;
  clientName: string | null;
  categoryName: string | null;
  supplierName: string | null;
  ball: Ball;
  stepName: string;
  size: number;
  isLate: boolean;
  dueAt: string | null;
};

export type ReportData = {
  starts: Date;
  ends: Date;
  label: string;
  rangeText: string;
  /** Klient, na kterého je report zúžený. `null` = celé studio. */
  client: ReportClient | null;
  /** Uzavřené v období — to, co jde do „co se udělalo“. */
  done: ReportItem[];
  /** Otevřené — to, co jde do „čeká se na“. */
  open: ReportItem[];
  counts: { done: number; me: number; client: number; supplier: number; late: number };
  byCategory: { category: string; percent: number; count: number }[];
  byClient: { client: string; items: ReportItem[]; percent: number }[];
};

export function aggregateReport(
  allRows: ReportRow[],
  categoryName: Map<string, string>,
  range: { start: Date; end: Date },
  client: ReportClient | null = null,
): ReportData {
  const { start, end } = range;
  const rows = client ? allRows.filter((r) => r.client_id === client.id) : allRows;

  const all = rows.map((r): ReportItem => ({
    title: r.title,
    clientName: r.client_name,
    categoryName: r.category_id ? categoryName.get(r.category_id) ?? null : null,
    supplierName: r.supplier_name,
    ball: r.ball,
    stepName: r.step_name,
    size: r.size,
    isLate: r.is_late,
    dueAt: r.due_at,
  }));

  // Uzavřené počítáme podle razítka `closed_at`, ne podle stavu — úkol
  // uzavřený minulý měsíc nepatří do tohohle týdne.
  const closedInRange = rows
    .map((r, i) => ({ r, item: all[i] }))
    .filter(({ r }) => {
      if (!r.closed_at) return false;
      const t = new Date(r.closed_at).getTime();
      return t >= start.getTime() && t <= end.getTime();
    })
    .map(({ item }) => item);

  const open = all.filter((t) => t.ball !== "done");

  const byCategory = shareByCategory(
    closedInRange.map((t) => ({ category: t.categoryName ?? "Nezařazeno", size: t.size })),
  );

  // Rozpad po klientech — příjemce reportu čte právě tohle.
  const clientGroups = new Map<string, ReportItem[]>();
  for (const t of [...closedInRange, ...open]) {
    const key = t.clientName ?? "Interní a provozní";
    clientGroups.set(key, [...(clientGroups.get(key) ?? []), t]);
  }
  const clientShares = shareByCategory(
    [...clientGroups.entries()].flatMap(([name, items]) => items.map((t) => ({ category: name, size: t.size }))),
  );
  const byClient = [...clientGroups.entries()]
    .map(([name, items]) => ({
      client: name,
      items,
      percent: clientShares.find((s) => s.category === name)?.percent ?? 0,
    }))
    .sort((a, b) => b.percent - a.percent);

  return {
    starts: start,
    ends: end,
    label: isoWeek(start).label,
    rangeText: csRange(start, end),
    client,
    done: closedInRange,
    open,
    counts: {
      done: closedInRange.length,
      me: open.filter((t) => t.ball === "me").length,
      client: open.filter((t) => t.ball === "client").length,
      supplier: open.filter((t) => t.ball === "supplier").length,
      late: open.filter((t) => t.isLate).length,
    },
    byCategory,
    byClient,
  };
}

/* ================================================================== */
/* Podklady pro AI                                                     */
/* ================================================================== */

export const REPORT_SYSTEM = `Píšeš týdenní report grafického studia pro nadřízeného nebo klienta.

Píšeš česky, věcně a bez vaty. Žádné oslovení, žádný závěrečný pozdrav — text
se vkládá do hotového dokumentu, který hlavičku i patičku už má.

Dva až tři odstavce. První shrne, čím byl týden tažený a kde leželo těžiště
práce. Druhý pokryje zbytek, typicky administrativu a komunikaci. Pokud něco
uvázlo na cizí straně, patří to do posledního odstavce a musí být zřejmé, že
to není zdržení na naší straně.

Vycházej jen z dodaných dat. Nic si nedomýšlej, nepřidávej čísla, která
v podkladech nejsou, a nepiš marketingové fráze o skvělé spolupráci.`;

export function buildReportPrompt(data: ReportData): string {
  const lines: string[] = [];
  // U reportu pro jednoho klienta by jeho jméno u každé položky jen překáželo.
  const tag = (t: ReportItem) => (!data.client && t.clientName ? ` [${t.clientName}]` : "");

  lines.push(`Období: ${data.rangeText}`);
  if (data.client) {
    lines.push(
      `Report je jen o práci pro klienta: ${data.client.name}. Je určený jemu — piš o tom, co se pro něj udělalo, a jeho jméno v textu neopakuj.`,
    );
  }
  lines.push(
    `Čísla: ${data.counts.done} uzavřeno, ${data.counts.me} rozpracováno, ` +
      `${data.counts.client} čeká na klienta, ${data.counts.supplier} u dodavatele, ` +
      `${data.counts.late} po termínu.`,
  );

  if (data.byCategory.length) {
    lines.push(
      "\nRozdělení práce: " +
        data.byCategory.map((c) => `${c.category} ${c.percent} %`).join(", "),
    );
  }

  lines.push("\nUzavřeno v období:");
  if (data.done.length === 0) {
    lines.push("  (nic)");
  } else {
    for (const t of data.done) {
      lines.push(`  - ${t.title}${tag(t)}`);
    }
  }

  const waiting = data.open.filter((t) => t.ball === "client" || t.ball === "supplier");
  if (waiting.length) {
    lines.push("\nČeká se na cizí straně:");
    for (const t of waiting) {
      lines.push(
        `  - ${t.title}${tag(t)} — ${BALL_LABEL[t.ball]}` +
          `${t.supplierName ? `, ${t.supplierName}` : ""}${t.isLate ? ", PO TERMÍNU" : ""}`,
      );
    }
  }

  const mine = data.open.filter((t) => t.ball === "me");
  if (mine.length) {
    lines.push("\nRozpracováno u nás:");
    for (const t of mine) {
      lines.push(`  - ${t.title}${tag(t)} (${t.stepName})`);
    }
  }

  return lines.join("\n");
}
