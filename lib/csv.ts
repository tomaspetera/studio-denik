/**
 * Záloha dat jako soubor pro Excel — čistá logika.
 *
 * CSV se středníkem a s BOM na začátku: tak ho český Excel otevře rovnou do
 * sloupců a s háčky. Buňka začínající znakem vzorce (=, +, -, @) dostane
 * apostrof, aby ji Excel nespustil jako vzorec — název úkolu je cizí text.
 */

export type CsvCell = string | number | boolean | null | undefined;

const BOM = "﻿";

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "boolean" ? (value ? "ano" : "ne") : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return BOM + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** Datum pro tabulku: „8. 10. 2026“; prázdné, když chybí. */
export function csvDate(key: string | null | undefined): string {
  if (!key || !/^\d{4}-\d{2}-\d{2}/.test(key)) return "";
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return `${d}. ${m}. ${y}`;
}
