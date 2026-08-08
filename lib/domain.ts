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

export function isLate(dueAt: string | null, ball: Ball, now = new Date()): boolean {
  if (!dueAt || ball === "done") return false;
  return new Date(dueAt).getTime() < now.getTime();
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
