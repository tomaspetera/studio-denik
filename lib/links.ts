/**
 * Odkazy v poznámce u úkolu — čistá logika.
 *
 * Poznámka je obyčejný text. Když je v něm adresa (podklady na Disku, zadání
 * ve WeTransferu, e-mail v Gmailu), má se dát rozkliknout. Nic jiného se
 * z textu nevykládá — žádné formátování, žádné HTML.
 */

export type NotePart = { kind: "text"; text: string } | { kind: "link"; url: string; label: string };

const ADRESA = /https?:\/\/[^\s<>"']+/g;
/** Co za adresou obvykle následuje jako interpunkce věty, ne jako její část. */
const KONEC = /[.,;:!?)\]]+$/;

/** Krátký popisek odkazu: u Gmailu slovy, jinak doména a začátek cesty. */
export function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "mail.google.com") return "e-mail v Gmailu";
    const cesta = `${u.pathname}${u.search}`.replace(/\/$/, "");
    const zbytek = cesta.length > 26 ? `${cesta.slice(0, 25)}…` : cesta;
    return `${host}${zbytek}`;
  } catch {
    return url;
  }
}

/** Rozdělí text na obyčejné úseky a odkazy. Jen `http(s)` — nic, co by šlo zneužít. */
export function noteParts(text: string | null | undefined): NotePart[] {
  const zdroj = text ?? "";
  const out: NotePart[] = [];
  let odkud = 0;

  for (const m of zdroj.matchAll(ADRESA)) {
    const zacatek = m.index ?? 0;
    const url = m[0].replace(KONEC, "");
    if (zacatek > odkud) out.push({ kind: "text", text: zdroj.slice(odkud, zacatek) });
    out.push({ kind: "link", url, label: linkLabel(url) });
    odkud = zacatek + url.length;
  }
  if (odkud < zdroj.length) out.push({ kind: "text", text: zdroj.slice(odkud) });
  return out;
}

/**
 * Řádek do poznámky u úkolu, který vznikl z e-mailu: odkaz na vlákno
 * v Gmailu. Účet se vybírá adresou schránky, ne pořadím přihlášení; „#all“,
 * protože zpráva přesunutá pod štítek v doručené není.
 */
export function gmailThreadUrl(threadId: string, account: string): string {
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account)}#all/${threadId}`;
}

/** Připojí k poznámce odkaz na e-mail — jednou, i když se volá opakovaně. */
export function withMailLink(note: string | null | undefined, threadId: string, account: string): string {
  const odkaz = gmailThreadUrl(threadId, account);
  const stara = (note ?? "").trim();
  if (stara.includes(odkaz)) return stara;
  return stara ? `${stara}\nE-mail: ${odkaz}` : `E-mail: ${odkaz}`;
}
