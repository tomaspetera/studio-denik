/**
 * Šablony úkolů a opakované úkoly — čistá logika bez databáze a bez
 * závislostí na zbytku appky, aby šla otestovat sama (Node umí TypeScript
 * bez překladu) a aby formulář i server říkaly totéž.
 *
 * Pravidla opakování zrcadlí SQL funkci `create_due_recurring_tasks`
 * (migrace 0016): týdně v den v týdnu (ISO, 1 = pondělí), nebo měsíčně
 * v den v měsíci 1–28.
 */

export type PresetKind = "interni" | "klient" | "tisk";
export type Frequency = "weekly" | "monthly";

export const PRESET_KINDS: readonly PresetKind[] = ["interni", "klient", "tisk"];

export type Schedule = {
  frequency: Frequency;
  /** ISO: 1 = pondělí … 7 = neděle. Jen u týdenního pravidla. */
  weekday: number | null;
  /** 1–28. Jen u měsíčního pravidla. */
  monthDay: number | null;
};

/** Tvar po "každé / každý / každou" — česky se ve 4. pádu liší rodem dne. */
const WEEKDAY_EVERY = [
  "", // ISO dny začínají jedničkou
  "každé pondělí",
  "každé úterý",
  "každou středu",
  "každý čtvrtek",
  "každý pátek",
  "každou sobotu",
  "každou neděli",
] as const;

export const WEEKDAY_SHORT = ["", "Po", "Út", "St", "Čt", "Pá", "So", "Ne"] as const;

/** Nejvyšší den v měsíci, který se nabízí — 29.–31. by v kratším měsíci tiše vypadly. */
export const MAX_MONTH_DAY = 28;

export function describeSchedule(s: Schedule): string {
  if (s.frequency === "weekly" && s.weekday !== null) return WEEKDAY_EVERY[s.weekday] ?? "";
  if (s.frequency === "monthly" && s.monthDay !== null) return `každého ${s.monthDay}. v měsíci`;
  return "";
}

/** ISO den v týdnu pro klíč dne "RRRR-MM-DD". */
export function isoWeekday(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

function toKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return toKey(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Nejbližší den od `from` (včetně), kdy pravidlo úkol založí. */
export function nextOccurrence(s: Schedule, from: string): string {
  if (s.frequency === "weekly" && s.weekday !== null) {
    return addDays(from, (s.weekday - isoWeekday(from) + 7) % 7);
  }
  if (s.frequency === "monthly" && s.monthDay !== null) {
    const [y, m, d] = from.split("-").map(Number);
    // Další měsíc: měsíc je tu 1–12, `Date.UTC` bere 0–11, takže `m` samo je příští.
    return s.monthDay >= d ? toKey(new Date(Date.UTC(y, m - 1, s.monthDay))) : toKey(new Date(Date.UTC(y, m, s.monthDay)));
  }
  return from;
}

type Fail = { ok: false; message: string };

export function normalizeSchedule(input: {
  frequency: string;
  weekday?: number | null;
  monthDay?: number | null;
}): ({ ok: true } & Schedule) | Fail {
  if (input.frequency === "weekly") {
    const wd = input.weekday;
    if (typeof wd !== "number" || !Number.isInteger(wd) || wd < 1 || wd > 7) {
      return { ok: false, message: "Vyber den v týdnu." };
    }
    return { ok: true, frequency: "weekly", weekday: wd, monthDay: null };
  }
  if (input.frequency === "monthly") {
    const md = input.monthDay;
    if (typeof md !== "number" || !Number.isInteger(md) || md < 1 || md > MAX_MONTH_DAY) {
      return { ok: false, message: `Den v měsíci musí být od 1 do ${MAX_MONTH_DAY}.` };
    }
    return { ok: true, frequency: "monthly", weekday: null, monthDay: md };
  }
  return { ok: false, message: "Vyber, jak často se úkol opakuje." };
}

export type Preset = {
  title: string;
  kind: PresetKind;
  size: number;
  dueOffsetDays: number | null;
};

/**
 * Společná pole šablony i pravidla. Prázdný termín znamená "bez termínu",
 * ne chybu.
 */
export function normalizePreset(input: {
  title: string;
  kind: string;
  size: number;
  dueOffsetDays?: number | string | null;
}): ({ ok: true } & Preset) | Fail {
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Potřebuje název." };

  if (!(PRESET_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, message: "Vyber typ úkolu." };
  }

  if (!Number.isInteger(input.size) || input.size < 1 || input.size > 3) {
    return { ok: false, message: "Velikost je 1 až 3." };
  }

  let days: number | null = null;
  const raw = input.dueOffsetDays;
  if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
    days = Number(String(raw).trim());
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      return { ok: false, message: "Termín je počet dní od založení, 0 až 365." };
    }
  }

  return { ok: true, title, kind: input.kind as PresetKind, size: input.size, dueOffsetDays: days };
}
