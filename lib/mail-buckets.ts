/**
 * Kam zpráva v přehledu pošty patří a v jakém pořadí se ukazuje.
 *
 * Samostatný soubor bez závislostí, protože ho potřebuje i přehled
 * v prohlížeči — a `mail-triage.ts` za sebou táhne zadání pro AI, které tam
 * nemá co dělat.
 *
 * Zásada pro nejistotu: zprávu raději nechat mezi těmi, které čekají na
 * odpověď, než ji schovat. Proto zpráva, která tříděním ještě neprošla
 * (nebo je třídění vypnuté), platí za „čeká na odpověď“.
 */

/**
 * urgent = po mně se něco chce a spěchá to
 * reply  = chce se odpověď nebo práce, ale nespěchá
 * info   = nic se po mně nechce (poděkování, oznámení, newsletter)
 */
export type MailPriority = "urgent" | "reply" | "info";

/**
 *  - handled  — ručně vyřízená (nebo z ní vznikl úkol či poptávka)
 *  - answered — poslední slovo ve vlákně je moje, na nic se nečeká
 *  - urgent   — čeká na mě a spěchá
 *  - reply    — čeká na mě (sem patří i zpráva, která tříděním ještě neprošla)
 *  - fyi      — poslední slovo je jejich, ale nic po mně nechtějí
 */
export type MailBucket = "handled" | "answered" | "urgent" | "reply" | "fyi";

export type TriageRow = {
  status: "waiting" | "info";
  handledAt: string | null;
  priority: MailPriority | null;
  receivedAt: string;
};

export function mailBucket(row: TriageRow): MailBucket {
  if (row.handledAt) return "handled";
  if (row.status !== "waiting") return "answered";
  if (row.priority === "info") return "fyi";
  if (row.priority === "urgent") return "urgent";
  return "reply";
}

export type MailCounts = {
  /** Kolik zpráv čeká na odpověď — včetně těch, které spěchají. */
  waiting: number;
  /** Kolik z nich spěchá. */
  urgent: number;
};

/**
 * Počty pro stránku Dnes a ranní upozornění. Zprávy „jen pro informaci“,
 * odpovězené a vyřízené se nepočítají — stejně jako v přehledu pošty.
 */
export function mailCounts(rows: Pick<TriageRow, "status" | "handledAt" | "priority">[]): MailCounts {
  let waiting = 0;
  let urgent = 0;
  for (const r of rows) {
    const bucket = mailBucket({ ...r, receivedAt: "" });
    if (bucket === "urgent") urgent++;
    if (bucket === "urgent" || bucket === "reply") waiting++;
  }
  return { waiting, urgent };
}

/** Čeká na odpověď: nejdřív to, co spěchá, pak od nejnovější. */
export function sortWaiting<T extends TriageRow>(rows: T[]): T[] {
  const rank = (r: T) => (mailBucket(r) === "urgent" ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.receivedAt.localeCompare(a.receivedAt));
}
