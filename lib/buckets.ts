import { addDaysKey, CS_WEEKDAYS_SHORT } from "./domain.ts";
import { isoWeekday } from "./presets.ts";

/**
 * Rozdělení úkolů podle termínu pro Dnes. Čistá funkce bez databáze, aby
 * šla otestovat sama.
 *
 * Pořadí skupin odpovídá tomu, jak naléhavé věci jsou. Uvnitř skupiny jde
 * první hlavní klient, pak nejbližší termín, pak abecedně.
 *
 * "Po termínu" bere to, co databáze (`is_task_late`) označí jako pozdní —
 * porovnává kalendářní dny v Praze, ne okamžiky. Termín v minulosti
 * označený jako nepozdní by znamenal rozjetá pásma, proto se pro jistotu
 * počítá taky jako po termínu.
 */
export type Bucket = "late" | "today" | "tomorrow" | "week" | "later" | "none";

export const BUCKET_ORDER: readonly Bucket[] = ["late", "today", "tomorrow", "week", "later", "none"];

export const BUCKET_LABEL: Record<Bucket, string> = {
  late: "Po termínu",
  today: "Dnes",
  tomorrow: "Zítra",
  week: "Tento týden",
  later: "Později",
  none: "Bez termínu",
};

export type BucketItem = {
  /** Termín jako klíč dne "RRRR-MM-DD", nebo `null`. */
  dueKey: string | null;
  isLate: boolean;
  /** Úkol hlavního klienta. */
  priority: boolean;
  title: string;
};

export function bucketOf(item: Pick<BucketItem, "dueKey" | "isLate">, today: string): Bucket {
  if (item.isLate) return "late";
  if (!item.dueKey) return "none";
  if (item.dueKey < today) return "late";
  if (item.dueKey === today) return "today";
  if (item.dueKey === addDaysKey(today, 1)) return "tomorrow";

  // Týden končí nedělí. V neděli je "tento týden" prázdný — zítřek už patří
  // do příštího a ukáže se jako "Zítra".
  const weekEnd = addDaysKey(today, 7 - isoWeekday(today));
  return item.dueKey <= weekEnd ? "week" : "later";
}

/** "Pá 3. 10." — krátce, ať se vejde do řádku vedle názvu. */
export function shortDateLabel(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${CS_WEEKDAYS_SHORT[isoWeekday(key) - 1]} ${d}. ${m}.`;
}

function compare<T extends BucketItem>(a: T, b: T): number {
  if (a.priority !== b.priority) return a.priority ? -1 : 1;
  if (a.dueKey !== b.dueKey) {
    if (a.dueKey === null) return 1;
    if (b.dueKey === null) return -1;
    return a.dueKey < b.dueKey ? -1 : 1;
  }
  return a.title.localeCompare(b.title, "cs");
}

/** Jen neprázdné skupiny, v pořadí naléhavosti. */
export function groupByBucket<T extends BucketItem>(items: T[], today: string): { bucket: Bucket; items: T[] }[] {
  return BUCKET_ORDER
    .map((bucket) => ({
      bucket,
      items: items.filter((i) => bucketOf(i, today) === bucket).sort(compare),
    }))
    .filter((g) => g.items.length > 0);
}
