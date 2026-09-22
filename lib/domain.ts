/**
 * Doménový model — zrcadlo funkcí `ball_of` a `step_label` z databáze.
 *
 * Tenhle soubor a `supabase/migrations/0001_schema.sql` musí říkat totéž.
 * Kdyby se rozešly, aplikace by ukazovala jiný stav než na jakém stojí
 * přístupová práva a reporty. Test v `lib/domain.test.ts` to hlídá.
 */

export type TaskKind = "interni" | "klient" | "tisk";
export type Ball = "me" | "client" | "supplier" | "done";

export type Step = { label: string; owner: Ball };

/** Kolik kroků má štafeta, se řídí typem úkolu — ne naopak. */
export const FLOWS: Record<TaskKind, readonly Step[]> = {
  interni: [
    { label: "Zadáno", owner: "me" },
    { label: "Dělám", owner: "me" },
    { label: "Hotovo", owner: "done" },
  ],
  klient: [
    { label: "Zadáno", owner: "me" },
    { label: "Dělám", owner: "me" },
    { label: "U klienta", owner: "client" },
    { label: "Hotovo", owner: "done" },
  ],
  tisk: [
    { label: "Zadáno", owner: "me" },
    { label: "Dělám", owner: "me" },
    { label: "Ke schválení", owner: "client" },
    { label: "V tisku", owner: "supplier" },
    { label: "Dodáno", owner: "me" },
    { label: "Předáno", owner: "done" },
  ],
} as const;

export function stepCount(kind: TaskKind): number {
  return FLOWS[kind].length;
}

/** U koho leží míč. Odvozené, nikdy ukládané. */
export function ballOf(kind: TaskKind, step: number): Ball {
  return FLOWS[kind][clampStep(kind, step)].owner;
}

export function stepLabel(kind: TaskKind, step: number): string {
  return FLOWS[kind][clampStep(kind, step)].label;
}

export function clampStep(kind: TaskKind, step: number): number {
  const max = FLOWS[kind].length - 1;
  return Math.min(Math.max(Math.trunc(step), 0), max);
}

export function isFinalStep(kind: TaskKind, step: number): boolean {
  return clampStep(kind, step) === FLOWS[kind].length - 1;
}

/**
 * Krok, na který spadne úkol daného typu, když ho někdo přetáhne do skupiny
 * `ball` (viz kanban v Úkolech). `null`, když štafeta toho typu takový krok
 * vůbec nemá — třeba interní úkol nemá krok u klienta ani u dodavatele,
 * a přetažení tam proto musí selhat, ne skočit na nejbližší náhodný krok.
 */
export function firstStepForBall(kind: TaskKind, ball: Ball): number | null {
  const i = FLOWS[kind].findIndex((s) => s.owner === ball);
  return i === -1 ? null : i;
}

/** Popisky pro uživatele. Držíme je na jednom místě, ať se nerozcházejí. */
export const BALL_LABEL: Record<Ball, string> = {
  me: "Na tobě",
  client: "U klienta",
  supplier: "U dodavatele",
  done: "Uzavřeno",
};

export const BALL_SENTENCE: Record<Ball, string> = {
  me: "Na tahu jsi ty",
  client: "Čeká se na klienta",
  supplier: "Čeká se na dodavatele",
  done: "Uzavřeno",
};

/** Vysvětlení pod nadpisem skupiny — proč ta skupina existuje. */
export const BALL_HINT: Record<Ball, string> = {
  me: "tyhle nikdo jiný neposune",
  client: "urguj, ale není to na tobě",
  supplier: "hlídá se termín dodání",
  done: "projde do reportu",
};

export const BALL_ORDER: readonly Ball[] = ["me", "client", "supplier", "done"];

export const KIND_LABEL: Record<TaskKind, string> = {
  interni: "Interní",
  klient: "S klientem",
  tisk: "Tiskový",
};

/** Velikost místo vykazování hodin — jedno kliknutí, ne stopky. */
export const SIZE_LABEL: Record<number, string> = {
  1: "malý",
  2: "střední",
  3: "velký",
};

/**
 * Paleta pro odlišení klientů. Vychází ze stejného tiskařského světa jako
 * zbytek aplikace, ale v tlumenější poloze — barva klienta nesmí přebít
 * barvu stavu, jinak by přestalo být poznat, u koho leží míč.
 *
 * Žije tady, ne v datové vrstvě: potřebuje ji i formulář v prohlížeči.
 */
export const CLIENT_COLORS = [
  "#B5673E", "#3D7F72", "#6F5A9B", "#33638F",
  "#9C7838", "#57737E", "#A8556B", "#4F7A3E",
] as const;

/* ------------------------------------------------------------------ */
/* Role v týmu                                                         */
/* ------------------------------------------------------------------ */
/* Popisky žijí tady, ne v datové vrstvě — potřebuje je i formulář
   v prohlížeči, a ten se k serverovým modulům nedostane.              */

export type Role = "admin" | "member" | "viewer";

export const ROLES: readonly Role[] = ["admin", "member", "viewer"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Správce",
  member: "Člen týmu",
  viewer: "Příjemce",
};

export const ROLE_HINT: Record<Role, string> = {
  admin: "Vidí a mění všechno včetně týmu a pozvánek.",
  member: "Zapisuje úkoly, hlídá tisk, píše reporty. Nespravuje tým.",
  viewer: "Vidí jen publikované reporty. Do provozních dat se nedostane.",
};

/* ------------------------------------------------------------------ */
/* Poptávky a nabídky (pipeline)                                        */
/* ------------------------------------------------------------------ */
/* Krok před založeným klientem. Malá pevná sada stavů, na kterou appka
   přímo větví (vyhráno nabídne založení klienta) — proto enum, ne volný
   text jako `clients.relationship`. */

export type LeadStatus = "poptavka" | "nabidka" | "vyhrano" | "prohrano";

export const LEAD_STATUSES: readonly LeadStatus[] = ["poptavka", "nabidka", "vyhrano", "prohrano"];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  poptavka: "Poptávka",
  nabidka: "Poslaná nabídka",
  vyhrano: "Vyhráno",
  prohrano: "Prohráno",
};

export const LEAD_STATUS_HINT: Record<LeadStatus, string> = {
  poptavka: "ozvali se, zatím nic poslané",
  nabidka: "čeká se na jejich rozhodnutí",
  vyhrano: "jde založit jako klienta",
  prohrano: "nezajímalo je to, nebo vybrali jinde",
};

/** Kč bez desetin — poptávky se odhadují na stovky/tisíce, ne na haléře. */
export function czk(amount: number): string {
  return `${Math.round(amount).toLocaleString("cs-CZ")} Kč`;
}

/**
 * Podíl kategorií v reportu. Váží se velikostí úkolu, ne časem —
 * hodiny by znamenaly stopky a ty nikdo dlouhodobě nevykazuje.
 */
export function shareByCategory(
  tasks: readonly { category: string; size: number }[],
): { category: string; percent: number; count: number }[] {
  const acc = new Map<string, { weight: number; count: number }>();
  for (const t of tasks) {
    const row = acc.get(t.category) ?? { weight: 0, count: 0 };
    row.weight += t.size;
    row.count += 1;
    acc.set(t.category, row);
  }
  const total = [...acc.values()].reduce((s, r) => s + r.weight, 0);
  if (total === 0) return [];

  const rows = [...acc.entries()]
    .map(([category, r]) => ({
      category,
      count: r.count,
      exact: (r.weight / total) * 100,
      percent: Math.floor((r.weight / total) * 100),
    }))
    .sort((a, b) => b.exact - a.exact);

  // Zaokrouhlování dolů utne pár procent — zbytek rozdám podle největšího
  // desetinného zbytku, aby součet seděl přesně na 100 %.
  let remainder = 100 - rows.reduce((s, r) => s + r.percent, 0);
  const byFraction = [...rows].sort(
    (a, b) => (b.exact - b.percent) - (a.exact - a.percent),
  );
  for (let i = 0; remainder > 0 && i < byFraction.length; i++, remainder--) {
    byFraction[i].percent += 1;
  }

  return rows.map(({ category, percent, count }) => ({ category, percent, count }));
}

/** ISO týden — používá se jako `label` reportu (2026-W32). */
export function isoWeek(d: Date): { year: number; week: number; label: string } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const year = t.getUTCFullYear();
  return { year, week, label: `${year}-W${String(week).padStart(2, "0")}` };
}

/** Pondělí–neděle týdne, do kterého datum spadá. */
export function weekRange(d: Date): { start: Date; end: Date } {
  const start = new Date(d);
  const dayNum = start.getDay() || 7;
  start.setDate(start.getDate() - dayNum + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

const CS_MONTHS = [
  "ledna", "února", "března", "dubna", "května", "června",
  "července", "srpna", "září", "října", "listopadu", "prosince",
];

/**
 * České skloňování podle počtu. Bez tohohle vzniká „1 úkolů“ nebo
 * „z 1 uzavřených úkolů“ — drobnost, která ale v reportu pro nadřízeného
 * působí, že to psal stroj.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

/** „úkol / úkoly / úkolů“ */
export function tasksWord(n: number): string {
  return plural(n, "úkol", "úkoly", "úkolů");
}

/** „z 1 uzavřeného úkolu“ vs. „z 12 uzavřených úkolů“ */
export function closedTasksPhrase(n: number): string {
  return n === 1
    ? "1 uzavřeného úkolu"
    : `${n} uzavřených úkolů`;
}

export function csDate(d: Date): string {
  return `${d.getDate()}. ${CS_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function csRange(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  return sameMonth
    ? `${start.getDate()}.–${end.getDate()}. ${CS_MONTHS[end.getMonth()]} ${end.getFullYear()}`
    : `${start.getDate()}. ${CS_MONTHS[start.getMonth()]} – ${csDate(end)}`;
}

/* ------------------------------------------------------------------ */
/* Kalendář                                                             */
/* ------------------------------------------------------------------ */
/*
 * `due_at` je uložené jako půlnoc UTC dne, který si člověk vybral v poli
 * typu „datum“ — je to datum, ne okamžik, a datum nemá časové pásmo.
 * `is_task_late` v databázi proto místo porovnání okamžiků porovnává
 * kalendářní dny v pražském čase (viz migrace 0008 — od toho se od dvou
 * ráno úkol s dnešním termínem tvářil jako "po termínu").
 *
 * Mřížka kalendáře musí ctít stejné pravidlo, jinak by tu samou chybu
 * zopakovala jinde: dny se proto počítají čistě v UTC (bez ohledu na to,
 * v jakém pásmu je prohlížeč), a "dnešek" se čte výhradně přes Europe/Prague.
 * Klíč dne je vždycky "YYYY-MM-DD" — obyčejný řetězec, se kterým se dá
 * bezpečně porovnávat i řadit.
 */
export type DateKey = string;

/** Klíč dne z ISO řetězce nebo Date, čtený z UTC složek — beze změny podle pásma prohlížeče. */
export function dateKeyUTC(value: string | Date): DateKey {
  const d = typeof value === "string" ? new Date(value) : value;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Dnešní datum v Praze — nezávisle na tom, v jakém pásmu běží prohlížeč nebo server. */
export function todayKeyPrague(): DateKey {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Klíč dne zpátky na `Date` (UTC půlnoc) — pro vstup `<input type="date">` a podobně. */
export function dateFromKey(key: DateKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDaysKey(key: DateKey, days: number): DateKey {
  const d = dateFromKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return dateKeyUTC(d);
}

/** Kladné = `b` je po `a`. */
export function daysBetweenKeys(a: DateKey, b: DateKey): number {
  return Math.round((dateFromKey(b).getTime() - dateFromKey(a).getTime()) / 86_400_000);
}

export function csDateFromKey(key: DateKey): string {
  return csDate(dateFromKey(key));
}

export const CS_MONTHS_FULL = [
  "Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
  "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec",
];

export const CS_WEEKDAYS_SHORT = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

/**
 * Šest týdnů (42 dní) měsíce `year`-`month` (0–11), pondělí jako první den —
 * včetně přesahu z okolních měsíců, přesně jako v Google Kalendáři.
 */
export function monthGridKeys(year: number, month: number): DateKey[] {
  const first = new Date(Date.UTC(year, month, 1));
  const firstWeekday = first.getUTCDay() || 7; // 1 = pondělí … 7 = neděle
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - (firstWeekday - 1));

  const days: DateKey[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(dateKeyUTC(d));
  }
  return days;
}
