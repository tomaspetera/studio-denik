import { daysBetweenKeys } from "./domain.ts";

/**
 * Jak zpráva vypadá v seznamu — iniciály odesílatele a krátký údaj, kdy
 * přišla. Čistá logika bez sítě a bez databáze.
 *
 * Čas se počítá podle Prahy a na serveru: kdyby si ho prohlížeč počítal sám,
 * napsal by v jiném pásmu jinou hodinu než server a stránka by poskočila.
 */

const prvni = (slovo: string) => Array.from(slovo)[0] ?? "";

/** Dvě písmena do kolečka: ze jména první a poslední slovo, jinak začátek adresy. */
export function initials(name: string | null, email: string): string {
  const slova = (name ?? "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((s) => s.length > 0);
  if (slova.length >= 2) return (prvni(slova[0]) + prvni(slova[slova.length - 1])).toUpperCase();
  if (slova.length === 1) return Array.from(slova[0]).slice(0, 2).join("").toUpperCase();
  const pred = Array.from(email.split("@")[0] ?? "").filter((z) => /[\p{L}\p{N}]/u.test(z));
  return (pred.slice(0, 2).join("") || "?").toUpperCase();
}

/** Kdy zpráva přišla: dnes hodinou, včera slovem, jinak datem bez roku. */
export function mailWhen(iso: string, now: Date = new Date()): string {
  const kdy = new Date(iso);
  if (Number.isNaN(kdy.getTime())) return "";

  const den = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(d);
  const prisla = den(kdy);
  const dnes = den(now);
  if (prisla === dnes) {
    return new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", hour: "numeric", minute: "2-digit" }).format(kdy);
  }
  if (daysBetweenKeys(prisla, dnes) === 1) return "včera";
  const [, m, d] = prisla.split("-").map(Number);
  return `${d}. ${m}.`;
}
