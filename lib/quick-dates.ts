import { addDaysKey, type DateKey } from "./domain.ts";
import { isoWeekday } from "./presets.ts";
import { shortDateLabel } from "./buckets.ts";

/**
 * Termín na jedno kliknutí — čistá logika bez databáze.
 *
 * Úkol bez termínu se na Dnes snadno ztratí, a kalendář je na „do pátku“
 * zbytečně pomalý: otevřít, najít den, kliknout. Většina termínů je přitom
 * jeden ze čtyř: dnes, zítra, do konce týdne, příští týden.
 */

export type QuickDate = {
  key: DateKey;
  /** „Dnes“, „Zítra“, „V pátek“, „Příští týden“. */
  label: string;
  /** Den slovy vedle popisku, ať je jasné, o které datum jde: „Pá 9. 10.“. */
  hint: string;
};

/**
 * Nabídka termínů od `today`. Každé datum je v ní nejvýš jednou — pátek se
 * nenabízí, když je dnes nebo zítra, a „příští týden“ (pondělí) se v neděli
 * kryje se zítřkem.
 */
export function quickDates(today: DateKey): QuickDate[] {
  const den = isoWeekday(today); // 1 = pondělí … 7 = neděle
  const volby: { key: DateKey; label: string }[] = [
    { key: today, label: "Dnes" },
    { key: addDaysKey(today, 1), label: "Zítra" },
  ];
  if (den <= 3) volby.push({ key: addDaysKey(today, 5 - den), label: "V pátek" });
  if (den !== 7) volby.push({ key: addDaysKey(today, 8 - den), label: "Příští týden" });
  return volby.map((v) => ({ ...v, hint: shortDateLabel(v.key) }));
}
