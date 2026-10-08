import { FLOWS, clampStep, dateKeyPrague, dateKeyUTC, daysBetweenKeys, stepLabel, type Ball, type TaskKind } from "./domain.ts";
import { nudgedLabel } from "./nudge.ts";
import { bucketOf, shortDateLabel, type Bucket } from "./buckets.ts";

/**
 * Stránka Dnes jako jeden seznam „co mám udělat“ — čistá logika bez databáze.
 *
 * Pořadí odpovídá tomu, co člověk potřebuje vidět nejdřív:
 *
 *  1. hoří     — po termínu (ať leží u kohokoli) a moje úkoly s termínem dnes;
 *  2. na tobě  — zbytek toho, co nikdo jiný neposune, podle termínu;
 *  3. čeká se  — úkoly u klienta a u dodavatele.
 *
 * Každý úkol je v seznamu právě jednou. A každý nese i to, kam ho posune
 * tlačítko přímo na řádku — posun o krok nesmí znamenat rozbalování úkolu,
 * jinak se nedělá a „u koho leží míč“ přestane říkat pravdu.
 */

/** Sloupce z `tasks_view`, které Dnes potřebuje. */
export type TodayInput = {
  id: string;
  title: string;
  kind: TaskKind;
  step: number;
  ball: Ball;
  is_late: boolean;
  due_at: string | null;
  step_name: string;
  client_id: string | null;
  client_name: string | null;
  client_color: string | null;
  supplier_name: string | null;
  /** Od kdy úkol stojí na současném kroku (ISO) — z historie, jen u těch, které čekají jinde. */
  step_since?: string | null;
  /** Kdy se v současném čekání naposledy urgovalo (ISO). */
  nudged_at?: string | null;
  /** Den "RRRR-MM-DD", na který si úkol člověk naplánoval (Můj týden). */
  planned_for?: string | null;
};

export type TodayStep = { step: number; label: string };

/** Jak moc termín tlačí — podle toho má štítek s termínem barvu. */
export type DueTone = "late" | "today" | "soon" | "none";

export type TodayTask = {
  id: string;
  title: string;
  /** Řádek pod názvem: proč je úkol právě tady. */
  sub: string;
  late: boolean;
  dueKey: string | null;
  /** Termín pro štítek vpravo: „5. 10.“, „dnes“, „zítra“, „Pá 16. 10.“; `null` = bez termínu. */
  dueLabel: string | null;
  dueTone: DueTone;
  /** Kolik dní je úkol po termínu; 0, když není. */
  lateDays: number;
  /** U koho úkol leží. */
  ball: Ball;
  /** Na kterém kroku štafety úkol stojí (od nuly) a jaké kroky štafeta má. */
  step: number;
  steps: readonly { label: string; owner: Ball }[];
  stepName: string;
  /** Dodavatel, u kterého úkol právě leží; jinak `null`. */
  supplierName: string | null;
  /** Kolik dní úkol leží u klienta nebo u dodavatele; `null`, když neleží nebo se to neví. */
  waitDays: number | null;
  /** Den, od kterého tam leží — pro text připomínky. */
  waitSince: string | null;
  /** „urgováno včera“; `null`, když se v tomhle čekání neurgovalo. */
  nudged: string | null;
  /** Naplánováno na dnešek (Můj týden) — včetně toho, co se nestihlo dřív a přeneslo se. */
  plannedToday: boolean;
  clientName: string | null;
  clientColor: string | null;
  /** Další krok štafety — kam úkol posune hlavní tlačítko. */
  next: TodayStep | null;
  /** Poslední krok, pokud to není hned ten další — tlačítko „rovnou hotovo“. */
  finish: TodayStep | null;
};

export type TodayGroup = { bucket: Bucket; items: TodayTask[] };

export type TodaySections = {
  burning: TodayTask[];
  mine: TodayGroup[];
  /** Kolik úkolů „na tobě“ se nevešlo — jsou za odkazem do Úkolů. */
  mineHidden: number;
  waiting: TodayTask[];
  counts: {
    /** Po termínu — ať leží u kohokoli. */
    late: number;
    /** Moje úkoly s termínem dnes. */
    today: number;
    /** Všechno, co leží na mně (včetně toho, co hoří). */
    mine: number;
    /** Na mně bez termínu — to, co se snadno ztratí. */
    noDue: number;
    /** Na mně a naplánováno na dnešek. */
    planned: number;
    waiting: number;
    client: number;
    supplier: number;
    done: number;
  };
};

/** Kolik úkolů „na tobě“ se na Dnes ukáže — zbytek je za odkazem. */
export const TODAY_MINE_ROWS = 8;

const MINE_BUCKETS: readonly Bucket[] = ["tomorrow", "week", "later", "none"];

const WHERE: Record<Ball, string> = { me: "", client: "u klienta", supplier: "u dodavatele", done: "" };

/** Den bez roku a bez dne v týdnu — „5. 10.“. */
function dayLabel(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d}. ${m}.`;
}

function steps(t: TodayInput): Pick<TodayTask, "next" | "finish"> {
  const last = FLOWS[t.kind].length - 1;
  const now = clampStep(t.kind, t.step);
  if (now >= last) return { next: null, finish: null };
  const next = { step: now + 1, label: stepLabel(t.kind, now + 1) };
  return { next, finish: now + 1 < last ? { step: last, label: stepLabel(t.kind, last) } : null };
}

type Sorted = TodayInput & { dueKey: string | null; bucket: Bucket; priority: boolean };

/** Hlavní klient první, pak nejbližší termín, pak abecedně. */
function byUrgency(a: Sorted, b: Sorted): number {
  if (a.dueKey !== b.dueKey) {
    if (a.dueKey === null) return 1;
    if (b.dueKey === null) return -1;
    return a.dueKey < b.dueKey ? -1 : 1;
  }
  if (a.priority !== b.priority) return a.priority ? -1 : 1;
  return a.title.localeCompare(b.title, "cs");
}

/**
 * Štítek termínu a jeho barva — stejně pro Dnes i pro Úkoly. Termín tak
 * krátce, jak to jde: dnes a zítra slovem, do týdne se dnem v týdnu, jinak
 * jen datum.
 */
export function dueChip(dueKey: string | null, late: boolean, today: string): { label: string | null; tone: DueTone } {
  if (!dueKey) return { label: null, tone: "none" };
  if (late) return { label: dayLabel(dueKey), tone: "late" };
  const zaDni = daysBetweenKeys(today, dueKey);
  if (zaDni === 0) return { label: "dnes", tone: "today" };
  if (zaDni === 1) return { label: "zítra", tone: "soon" };
  return { label: zaDni > 1 && zaDni <= 7 ? shortDateLabel(dueKey) : dayLabel(dueKey), tone: "soon" };
}

/** Vlastní úkol naplánovaný na dnešek nebo dřív — co se nestihlo, platí pro dnešek. */
function naDnes(t: TodayInput, today: string): boolean {
  return t.ball === "me" && Boolean(t.planned_for) && (t.planned_for as string) <= today;
}

function row(t: Sorted, sub: string, today: string): TodayTask {
  const zaDni = t.dueKey ? daysBetweenKeys(today, t.dueKey) : null;
  const stitek = dueChip(t.dueKey, t.bucket === "late", today);
  // Čekání se počítá podle Prahy — je to okamžik, ne termín zadaný jako den.
  const ceka = t.ball === "client" || t.ball === "supplier";
  const odKdy = ceka && t.step_since ? dateKeyPrague(t.step_since) : null;
  return {
    id: t.id,
    title: t.title,
    sub,
    late: t.bucket === "late",
    dueKey: t.dueKey,
    dueLabel: stitek.label,
    dueTone: stitek.tone,
    lateDays: t.bucket === "late" && zaDni !== null ? Math.max(1, -zaDni) : 0,
    ball: t.ball,
    step: clampStep(t.kind, t.step),
    steps: FLOWS[t.kind],
    stepName: t.step_name,
    supplierName: t.ball === "supplier" ? t.supplier_name : null,
    waitDays: odKdy ? Math.max(0, daysBetweenKeys(odKdy, today)) : null,
    waitSince: odKdy,
    nudged: ceka && t.nudged_at ? nudgedLabel(dateKeyPrague(t.nudged_at), today) : null,
    plannedToday: naDnes(t, today),
    clientName: t.client_name,
    clientColor: t.client_color,
    ...steps(t),
  };
}

export function buildToday(
  tasks: TodayInput[],
  today: string,
  priorityClientIds: ReadonlySet<string> = new Set(),
  mineRows: number = TODAY_MINE_ROWS,
): TodaySections {
  const open: Sorted[] = tasks
    .filter((t) => t.ball !== "done")
    .map((t) => {
      const dueKey = t.due_at ? dateKeyUTC(t.due_at) : null;
      return {
        ...t,
        dueKey,
        bucket: bucketOf({ dueKey, isLate: t.is_late }, today),
        priority: t.client_id ? priorityClientIds.has(t.client_id) : false,
      };
    });

  const isBurning = (t: Sorted) => t.bucket === "late" || (t.bucket === "today" && t.ball === "me");

  const burning = open
    .filter(isBurning)
    .sort(byUrgency)
    .map((t) => {
      const kde = WHERE[t.ball] ? ` · ${WHERE[t.ball]}` : "";
      if (t.bucket === "today") return row(t, `dnes · ${t.step_name}`, today);
      return row(t, `${t.dueKey ? `po termínu od ${dayLabel(t.dueKey)}` : "po termínu"}${kde}`, today);
    });

  const mineAll = open.filter((t) => t.ball === "me" && !isBurning(t));
  let zbyva = Math.max(0, mineRows);
  const mine: TodayGroup[] = [];

  // Co si člověk naplánoval na dnešek, jde první — ať má termín kdykoli.
  const planovane = mineAll
    .filter((t) => naDnes(t, today))
    .sort(byUrgency)
    .slice(0, zbyva)
    .map((t) => row(t, t.dueKey ? `${shortDateLabel(t.dueKey)} · ${t.step_name}` : t.step_name, today));
  if (planovane.length > 0) mine.push({ bucket: "today", items: planovane });
  zbyva -= planovane.length;

  for (const bucket of MINE_BUCKETS) {
    const items = mineAll
      .filter((t) => t.bucket === bucket && !naDnes(t, today))
      .sort(byUrgency)
      .slice(0, zbyva)
      .map((t) => row(t, t.dueKey ? `${shortDateLabel(t.dueKey)} · ${t.step_name}` : t.step_name, today));
    if (items.length > 0) mine.push({ bucket, items });
    zbyva -= items.length;
  }
  const mineShown = mine.reduce((n, g) => n + g.items.length, 0);

  const waiting = open
    .filter((t) => (t.ball === "client" || t.ball === "supplier") && !isBurning(t))
    .sort(byUrgency)
    .map((t) => {
      const casti = [t.step_name];
      if (t.ball === "supplier" && t.supplier_name) casti.push(t.supplier_name);
      if (t.dueKey) casti.push(t.dueKey === today ? "termín dnes" : `termín ${dayLabel(t.dueKey)}`);
      return row(t, casti.join(" · "), today);
    });

  return {
    burning,
    mine,
    mineHidden: mineAll.length - mineShown,
    waiting,
    counts: {
      late: open.filter((t) => t.bucket === "late").length,
      today: open.filter((t) => t.bucket === "today" && t.ball === "me").length,
      mine: open.filter((t) => t.ball === "me").length,
      noDue: open.filter((t) => t.ball === "me" && !t.dueKey).length,
      planned: open.filter((t) => naDnes(t, today)).length,
      waiting: open.filter((t) => t.ball === "client" || t.ball === "supplier").length,
      client: open.filter((t) => t.ball === "client").length,
      supplier: open.filter((t) => t.ball === "supplier").length,
      done: tasks.length - open.length,
    },
  };
}
