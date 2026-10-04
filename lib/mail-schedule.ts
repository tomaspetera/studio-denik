import { plural } from "./domain.ts";
import { isoWeekday } from "./presets.ts";
import type { MailCounts } from "./mail-buckets.ts";

/**
 * Ranní načítání pošty — kdy běží a co se o něm říká. Čistá logika bez sítě
 * a bez databáze.
 *
 * Pošta se jinak načítá jen na kliknutí („Obnovit“). Ranní běh ji načte sám,
 * ale jen ve vybrané dny a jen schránkám, jejichž majitel si to zapnul
 * (`mail_accounts.auto_sync_at`). V ostatní dny se nic samo neděje.
 */

/** Dny, kdy se pošta ráno načítá sama: úterý, středa, čtvrtek (1 = pondělí). */
export const MAIL_AUTO_DAYS: readonly number[] = [2, 3, 4];

/** Slovy, pro texty v nastavení a v zásadách soukromí. */
export const MAIL_AUTO_DAYS_LABEL = "v úterý, ve středu a ve čtvrtek";

/** Je den s klíčem "RRRR-MM-DD" dnem ranního načítání? */
export function isMailAutoDay(dateKey: string): boolean {
  return MAIL_AUTO_DAYS.includes(isoWeekday(dateKey));
}

/** Kus ranního upozornění o poště. `null`, když na odpověď nic nečeká. */
export function mailPushPart(c: MailCounts): string | null {
  if (c.waiting <= 0) return null;
  return c.urgent > 0 ? `pošta čeká ${c.waiting}, spěchá ${c.urgent}` : `pošta čeká ${c.waiting}`;
}

/**
 * Text ranního upozornění pro jednoho člověka: souhrn úkolů studia a k němu
 * jeho vlastní pošta. `counts` se předává jen majiteli schránky — kolegům
 * do upozornění cizí pošta nepatří. `null`, když není co hlásit.
 */
export function morningPushBody(taskParts: string[], counts: MailCounts | null | undefined): string | null {
  const posta = counts ? mailPushPart(counts) : null;
  const parts = posta ? [...taskParts, posta] : taskParts;
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Řádek o poště na stránce Dnes. `null`, když na odpověď nic nečeká. */
export function mailLine(c: MailCounts): string | null {
  if (c.waiting <= 0) return null;
  const ceka = `${plural(c.waiting, "Čeká", "Čekají", "Čeká")} ${c.waiting} ${plural(c.waiting, "zpráva", "zprávy", "zpráv")}`;
  if (c.urgent <= 0) return ceka;
  return c.urgent === c.waiting && c.waiting === 1 ? `${ceka} a spěchá` : `${ceka}, ${c.urgent} ${plural(c.urgent, "spěchá", "spěchají", "spěchá")}`;
}

/**
 * Kdy se pošta naposledy načetla, slovy: dnes s hodinou, jinak datem. Počítá
 * se podle Prahy — server běží v jiném pásmu než čtenář.
 */
export function lastSyncLabel(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const kdy = new Date(iso);
  if (Number.isNaN(kdy.getTime())) return null;

  const den = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(d);
  if (den(kdy) === den(now)) {
    const cas = new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", hour: "numeric", minute: "2-digit" }).format(kdy);
    return `dnes v ${cas}`;
  }
  const [, m, d] = den(kdy).split("-").map(Number);
  return `${d}. ${m}.`;
}
