import { CS_WEEKDAYS_SHORT, FLOWS, addDaysKey, dateKeyUTC, type Ball, type TaskKind } from "./domain.ts";
import { isoWeekday } from "./presets.ts";
import { dueChip, type DueTone } from "./today.ts";

/**
 * Můj týden — čistá logika bez databáze.
 *
 * Termín říká, dokdy má být úkol hotový. Tady jde o něco jiného: na který den
 * si ho člověk zařadil. Stránka ukazuje pondělí až pátek a víkend dohromady;
 * vlevo je, co ještě naplánované není.
 *
 * Tři pravidla, která nejsou vidět na první pohled:
 *  - Plánuje se jen vlastní práce. Úkol, který leží u klienta nebo
 *    u dodavatele, v týdnu není — není co na něm dělat.
 *  - Co bylo naplánované na den, který už uplynul, a hotové to není, se samo
 *    přesune na dnešek a je označené jako přenesené. Plán se tak nerozpadne
 *    jen proto, že se v úterý nestihlo všechno.
 *  - Úkol naplánovaný na jiný týden, než je ten zobrazený, není „nenaplánovaný“.
 */

/** Sloupce, které Můj týden potřebuje: řádek z `tasks_view` a k němu plán z tabulky. */
export type WeekInput = {
  id: string;
  title: string;
  kind: TaskKind;
  step: number;
  ball: Ball;
  is_late: boolean;
  due_at: string | null;
  step_name: string;
  client_name: string | null;
  client_color: string | null;
  /** Den "RRRR-MM-DD", na který je úkol naplánovaný; `null` = nenaplánováno. */
  planned_for: string | null;
};

export type WeekTask = {
  id: string;
  title: string;
  stepName: string;
  clientName: string | null;
  clientColor: string | null;
  dueKey: string | null;
  dueLabel: string | null;
  dueTone: DueTone;
  /** Poslední krok štafety — kam úkol posune fajfka. */
  finish: { step: number; label: string };
  /** Na kterém kroku stojí — aby šla fajfka vrátit. */
  step: number;
  /** Den, na který je naplánovaný (původní, i když se zobrazuje dnes). */
  plannedKey: string | null;
  /** Byl naplánovaný na dřívější den a nestihl se — zobrazuje se dnes. */
  carried: boolean;
};

export type WeekDay = {
  /** Den, na který se úkol naplánuje, když se sem přetáhne. U víkendu sobota. */
  key: string;
  /** „Po“, „Út“ … „Víkend“. */
  label: string;
  /** „5. 10.“; u víkendu „10.–11. 10.“. */
  dateLabel: string;
  isToday: boolean;
  /** Celý den už uplynul — plánovat na něj nedává smysl. */
  isPast: boolean;
  items: WeekTask[];
};

export type WeekPlan = {
  /** Pondělí zobrazeného týdne. */
  start: string;
  /** „5.–11. 10.“ */
  rangeLabel: string;
  /** Je to týden, ve kterém je dnešek? */
  isCurrent: boolean;
  days: WeekDay[];
  unplanned: WeekTask[];
  /** Kolik úkolů je naplánovaných na jiný týden — nejsou vidět, ale nejsou ani „nenaplánované“. */
  elsewhere: number;
};

/** Pondělí týdne, do kterého den patří. */
export function weekStartOf(key: string): string {
  return addDaysKey(key, 1 - isoWeekday(key));
}

const denMesic = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  return `${d}. ${m}.`;
};

/** „5.–11. 10.“, přes hranici měsíce „28. 9. – 4. 10.“. */
function rozsah(od: string, po: string): string {
  const [, m1, d1] = od.split("-").map(Number);
  const [, m2] = po.split("-").map(Number);
  return m1 === m2 ? `${d1}.–${denMesic(po)}` : `${denMesic(od)} – ${denMesic(po)}`;
}

type Radek = WeekInput & { dueKey: string | null };

/** Po termínu první, pak nejbližší termín, bez termínu nakonec; při shodě abecedně. */
function podleTerminu(a: Radek, b: Radek): number {
  if (a.is_late !== b.is_late) return a.is_late ? -1 : 1;
  if (a.dueKey !== b.dueKey) {
    if (a.dueKey === null) return 1;
    if (b.dueKey === null) return -1;
    return a.dueKey < b.dueKey ? -1 : 1;
  }
  return a.title.localeCompare(b.title, "cs");
}

/**
 * Týden od pondělí `weekStart`. `today` rozhoduje, co je minulost a kam se
 * přenáší nestihnuté — přenáší se jen v týdnu, ve kterém dnešek je.
 */
export function buildWeek(tasks: WeekInput[], today: string, weekStart: string = weekStartOf(today)): WeekPlan {
  const start = weekStartOf(weekStart);
  const sobota = addDaysKey(start, 5);
  const nedele = addDaysKey(start, 6);
  const isCurrent = today >= start && today <= nedele;

  /** Sloupec, do kterého den patří: všední den sám sebe, víkend sobotu. */
  const sloupec = (key: string) => (key === nedele ? sobota : key);

  const moje: Radek[] = tasks
    .filter((t) => t.ball === "me")
    .map((t) => ({ ...t, dueKey: t.due_at ? dateKeyUTC(t.due_at) : null }));

  const karta = (t: Radek, carried: boolean): WeekTask => {
    const stitek = dueChip(t.dueKey, t.is_late, today);
    const posledni = FLOWS[t.kind].length - 1;
    return {
      id: t.id,
      title: t.title,
      stepName: t.step_name,
      clientName: t.client_name,
      clientColor: t.client_color,
      dueKey: t.dueKey,
      dueLabel: stitek.label,
      dueTone: stitek.tone,
      finish: { step: posledni, label: FLOWS[t.kind][posledni].label },
      step: t.step,
      plannedKey: t.planned_for,
      carried,
    };
  };

  const doDne = new Map<string, WeekTask[]>();
  const unplanned: Radek[] = [];
  let elsewhere = 0;

  for (const t of [...moje].sort(podleTerminu)) {
    const plan = t.planned_for;
    if (!plan) {
      unplanned.push(t);
      continue;
    }
    // Nestihnuté z dřívějška se přenáší na dnešek — ale jen v týdnu, kde dnešek je.
    const prenes = plan < today;
    if (prenes && !isCurrent) {
      elsewhere++;
      continue;
    }
    const den = prenes ? today : plan;
    if (den < start || den > nedele) {
      elsewhere++;
      continue;
    }
    const kam = sloupec(den);
    doDne.set(kam, [...(doDne.get(kam) ?? []), karta(t, prenes)]);
  }

  const days: WeekDay[] = [0, 1, 2, 3, 4].map((i) => {
    const key = addDaysKey(start, i);
    return {
      key,
      label: CS_WEEKDAYS_SHORT[i],
      dateLabel: denMesic(key),
      isToday: key === today,
      isPast: key < today,
      items: doDne.get(key) ?? [],
    };
  });
  days.push({
    key: sobota,
    label: "Víkend",
    dateLabel: rozsah(sobota, nedele),
    isToday: today === sobota || today === nedele,
    isPast: nedele < today,
    items: doDne.get(sobota) ?? [],
  });

  return {
    start,
    rangeLabel: rozsah(start, nedele),
    isCurrent,
    days,
    unplanned: unplanned.map((t) => karta(t, false)),
    elsewhere,
  };
}

/**
 * Den, na který se úkol opravdu naplánuje, když ho člověk pustí do sloupce.
 * Na den, který už uplynul, se neplánuje — takový úkol by se stejně hned
 * přenesl na dnešek, tak se tam zapíše rovnou.
 */
export function planTarget(dayKey: string, today: string): string {
  return dayKey < today ? today : dayKey;
}
