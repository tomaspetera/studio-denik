/**
 * Text zprávy z Gmailu — čistá logika bez sítě a bez databáze.
 *
 * Gmail vrací zprávu jako strom částí (MIME). Tady se z něj vybere čitelný
 * text té jedné zprávy: bez příloh, bez citované starší korespondence
 * a zkrácený na rozumnou délku. Nic z toho se neukládá — výsledek jde jen
 * do návrhu úkolu a pak se zahodí.
 *
 * Přílohy se tu jen vyjmenují (jméno, typ, velikost). Jejich obsah tenhle
 * modul nečte; co z nich smí k AI, rozhoduje `mail-files.ts`.
 */

export type GmailHeader = { name?: string; value?: string };

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

/**
 * Příloha tak, jak ji popisuje Gmail — bez obsahu. Ten se stahuje zvlášť
 * a jen tehdy, když majitel schránky povolil čtení příloh (`mail-files.ts`).
 */
export type MailAttachment = {
  /** Jméno souboru, jak ho pojmenoval odesílatel. */
  filename: string;
  /** Typ, který uvádí odesílatel — obsahu odpovídat nemusí. */
  mimeType: string;
  /** Velikost v bajtech podle Gmailu; 0, když ji neuvádí. */
  size: number;
  /** Klíč, kterým se obsah přílohy stahuje. */
  attachmentId: string | null;
  /** Obsah v base64url, když ho Gmail u malé přílohy poslal rovnou se zprávou. */
  data: string | null;
};

export type PreparedBody = {
  text: string;
  /** Text byl delší než limit a je uříznutý. */
  truncated: boolean;
  /** Počet příloh. Do textu zprávy se jejich obsah nebere nikdy. */
  attachments: number;
  /** Přílohy jednotlivě — jen popis, bez obsahu. */
  files: MailAttachment[];
};

/** Kolik znaků textu jde nejvýš do AI. Delší e-mail se uřízne. */
export const MAIL_BODY_MAX_CHARS = 6000;

/** Strop před jakýmkoli zpracováním — obří newsletter nesmí zdržet server. */
const RAW_MAX_CHARS = 200_000;

/* ------------------------------------------------------------------ */
/* Dekódování                                                           */
/* ------------------------------------------------------------------ */

function header(part: GmailPart, name: string): string {
  const h = part.headers?.find((x) => (x.name ?? "").toLowerCase() === name);
  return h?.value ?? "";
}

/** Gmail posílá těla v base64url. Poškozený vstup = prázdný text, ne pád. */
function fromBase64Url(data: string): Uint8Array {
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

function charsetOf(part: GmailPart): string | null {
  const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(header(part, "content-type"));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Bajty na text. Nejdřív se zkusí UTF-8 — když sedí beze zbytku, je to ono
 * (starší česká kódování platné UTF-8 prakticky nikdy nedají). Jinak platí
 * kódování z hlavičky a jako poslední možnost windows-1250, ve kterém chodí
 * česká pošta ze starších programů.
 */
export function decodeBytes(bytes: Uint8Array, declared: string | null): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // není to UTF-8
  }
  for (const label of [declared, "windows-1250"]) {
    if (!label || label === "utf-8" || label === "utf8") continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // kódování, které tenhle stroj nezná — zkusí se další
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/* ------------------------------------------------------------------ */
/* HTML na text                                                         */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ndash: "–", mdash: "—", hellip: "…", bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  laquo: "«", raquo: "»", euro: "€", copy: "©", reg: "®", trade: "™", deg: "°", times: "×",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", yacute: "ý",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Yacute: "Ý",
  scaron: "š", Scaron: "Š", ccaron: "č", Ccaron: "Č", zcaron: "ž", Zcaron: "Ž",
  rcaron: "ř", Rcaron: "Ř", ecaron: "ě", Ecaron: "Ě", ncaron: "ň", Ncaron: "Ň",
  tcaron: "ť", Tcaron: "Ť", dcaron: "ď", Dcaron: "Ď", uring: "ů", Uring: "Ů",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return all;
      try {
        return String.fromCodePoint(code);
      } catch {
        return all;
      }
    }
    return ENTITIES[body] ?? ENTITIES[body.toLowerCase()] ?? all;
  });
}

const FORWARD_MARK = /^-{2,}\s*(forwarded message|přeposlaná zpráva|preposlana zprava)\s*-{2,}/im;

/**
 * HTML zprávy na prostý text. `keepQuoted` nechá citovaný blok být — u
 * přeposlané zprávy je totiž právě on tím, o co jde.
 */
export function htmlToText(html: string, keepQuoted = false): string {
  if (!html) return "";
  let s = html.slice(0, RAW_MAX_CHARS);

  // Co se v e-mailu nezobrazuje jako text.
  s = s.replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");

  if (!keepQuoted) {
    // Gmail balí citovanou korespondenci do `gmail_quote`, ostatní do <blockquote>.
    const quote = s.search(/<div[^>]+class\s*=\s*["'][^"']*\bgmail_quote\b/i);
    if (quote > 0) s = s.slice(0, quote);
    // Od nejvnitřnějšího ven; strop na počet kol, ať rozbité HTML nezacyklí.
    for (let i = 0; i < 20; i++) {
      const next = s.replace(/<blockquote\b[^>]*>(?:(?!<blockquote\b)[\s\S])*?<\/blockquote\s*>/gi, "\n");
      if (next === s) break;
      s = next;
    }
  }

  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|table|ul|ol|section|article|header|footer)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<\/(td|th)\s*>/gi, " ")
    .replace(/<[^>]+>/g, "");

  return decodeEntities(s);
}

/* ------------------------------------------------------------------ */
/* Výběr textové části                                                  */
/* ------------------------------------------------------------------ */

type Found = { plain: GmailPart | null; html: GmailPart | null; files: MailAttachment[] };

function walk(part: GmailPart, found: Found, depth: number): void {
  if (depth > 12) return;

  const mime = (part.mimeType ?? "").toLowerCase();
  if (part.filename) {
    // Obrázek vložený do podpisu má jméno souboru taky, ale příloha to není.
    // Platí to jen pro obrázky: PDF, které poštovní program označil jako
    // „inline“ (Apple Mail to dělá běžně), přílohou je.
    const inline =
      mime.startsWith("image/") &&
      (header(part, "content-disposition").toLowerCase().startsWith("inline") || Boolean(header(part, "content-id")));
    if (!inline) {
      found.files.push({
        filename: part.filename,
        mimeType: mime,
        size: typeof part.body?.size === "number" && part.body.size > 0 ? part.body.size : 0,
        attachmentId: part.body?.attachmentId ?? null,
        data: part.body?.data ?? null,
      });
    }
    // Do textu zprávy se obsah souboru nebere nikdy, ani kdyby to byl text.
    return;
  }

  if (part.body?.data) {
    if (mime === "text/plain" && !found.plain) found.plain = part;
    else if (mime === "text/html" && !found.html) found.html = part;
  }
  for (const p of part.parts ?? []) walk(p, found, depth + 1);
}

/**
 * Text zprávy tak, jak ho odesílatel napsal. Přednost má prostý text;
 * když ho zpráva nemá (nebo je prázdný), převede se HTML.
 */
export function extractBody(
  payload: GmailPart | null | undefined,
  opts: { keepQuoted?: boolean } = {},
): { text: string; attachments: number; files: MailAttachment[] } {
  if (!payload) return { text: "", attachments: 0, files: [] };

  const found: Found = { plain: null, html: null, files: [] };
  walk(payload, found, 0);
  const prilohy = { attachments: found.files.length, files: found.files };

  const read = (p: GmailPart | null) =>
    p?.body?.data ? decodeBytes(fromBase64Url(p.body.data), charsetOf(p)).slice(0, RAW_MAX_CHARS) : "";

  const plain = read(found.plain);
  if (plain.trim()) return { text: plain, ...prilohy };

  const html = read(found.html);
  const keep = opts.keepQuoted || /forwarded message|přeposlaná zpráva/i.test(html);
  return { text: htmlToText(html, keep), ...prilohy };
}

/* ------------------------------------------------------------------ */
/* Úklid a citace                                                       */
/* ------------------------------------------------------------------ */

/** Sjednocené konce řádků, žádné neviditelné znaky, nejvýš jeden prázdný řádek za sebou. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍⁠﻿­]/g, "")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Předmět přeposlané zprávy: „Fwd:“, „FW:“ a české obdoby. */
export function isForward(subject: string | null | undefined): boolean {
  return /^\s*(fwd?|fw|pd|př|přeposl[a-zá]*|preposl[a-z]*)\s*:/i.test(subject ?? "");
}

/** Řádek, kterým poštovní program uvádí citovanou zprávu. */
const ATTRIBUTION = [
  // Gmail anglicky: „On Mon, Sep 28, 2026 at 10:15 AM Jan <jan@firma.cz> wrote:“
  /^On .{5,300} wrote:\s*$/i,
  // Česky: „Dne … napsal(a):“ i „po 28. 9. 2026 v 10:15 odesílatel … napsal:“.
  // Datum nebo adresa v řádku odliší hlavičku citace od běžné věty.
  /^(?=.*(\d{4}|@)).{0,300}\bnapsal(\(a\)|a)?:\s*$/i,
];

const ORIGINAL_MARK =
  /^-{2,}\s*(original message|původní zpráva|puvodni zprava|původní e-mail|puvodni e-mail)\s*-{2,}\s*$/i;
const LONG_RULE = /^_{20,}\s*$/;
const FROM_LINE = /^(from|od):\s*\S/i;
const SENT_LINE = /^(sent|odesláno|odeslano|date|datum):\s*\S/i;

function isQuoteStart(lines: string[], i: number): boolean {
  const a = lines[i].trim();
  if (!a) return false;
  if (ATTRIBUTION.some((re) => re.test(a)) || ORIGINAL_MARK.test(a) || LONG_RULE.test(a)) return true;

  // Outlook: blok „Od: … Odesláno: …“ bez jakéhokoli oddělovače.
  if (FROM_LINE.test(a) && lines.slice(i + 1, i + 5).some((l) => SENT_LINE.test(l.trim()))) return true;

  // Dlouhou hlavičku citace poštovní programy zalamují na dva řádky.
  const b = (lines[i + 1] ?? "").trim();
  if (b && b.length <= 120 && /^(on |dne )|\bodesílatel\b/i.test(a)) {
    return ATTRIBUTION.some((re) => re.test(`${a} ${b}`));
  }
  return false;
}

/**
 * Ze zprávy zůstane jen to, co odesílatel napsal teď — bez citované starší
 * korespondence a bez podpisu za „-- “. U přeposlané zprávy (`keepForwarded`)
 * se neřeže nic, protože obsah je právě v té citaci.
 *
 * Když po odříznutí nezbude nic, odpověď je psaná pod citací nebo mezi
 * řádky; pak se vezme to, co není označené „>“. A když ani tak nic, celý text.
 */
export function stripQuoted(text: string, keepForwarded = false): string {
  if (keepForwarded) return text;

  const lines = text.split("\n");
  const notQuoted = (l: string) => !/^\s*>/.test(l);

  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "--" || isQuoteStart(lines, i)) {
      cut = i;
      break;
    }
  }

  const above = lines.slice(0, cut).filter(notQuoted).join("\n").trim();
  if (above) return above;

  const below = lines
    .slice(cut + 1)
    .filter((l, i, rest) => notQuoted(l) && !isQuoteStart(rest, i))
    .join("\n")
    .trim();
  return below || text;
}

/** Uříznutí na `max` znaků, pokud možno na hranici slova. */
export function clip(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };

  let cut = text.slice(0, max);
  const at = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  if (at > max * 0.8) cut = cut.slice(0, at);
  // Půlka znaku složeného ze dvou jednotek (emoji) by byla neplatný text.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return { text: cut.trimEnd(), truncated: true };
}

/**
 * Celá cesta: strom částí z Gmailu → text připravený pro návrh úkolu.
 */
export function prepareBody(
  payload: GmailPart | null | undefined,
  subject: string | null | undefined,
  max: number = MAIL_BODY_MAX_CHARS,
): PreparedBody {
  const forwardBySubject = isForward(subject);
  const { text: raw, attachments, files } = extractBody(payload, { keepQuoted: forwardBySubject });

  const cleaned = cleanText(raw);
  const forward = forwardBySubject || FORWARD_MARK.test(cleaned);
  const body = cleanText(stripQuoted(cleaned, forward));

  return { ...clip(body, max), attachments, files };
}
