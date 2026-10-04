import type { MailAttachment } from "./mail-body.ts";

/**
 * Přílohy e-mailu pro AI — čistá logika bez sítě a bez databáze.
 *
 * Přílohu AI přečte jen na výslovné kliknutí u jedné zprávy a jen když to
 * majitel schránky povolil zvlášť (`mail_accounts.ai_files_at`). Automatické
 * třídění přílohy nečte nikdy.
 *
 * Tady se rozhoduje, které přílohy k AI smějí:
 *
 *  - jen PDF a obrázky (JPG, PNG, WEBP) — nic jiného Gemini jako dokument
 *    nečte, a tabulku nebo Word převádět nechceme;
 *  - typ se nebere z toho, co tvrdí odesílatel, ale z prvních bajtů souboru;
 *  - stropy na počet, velikost a délku, aby jedna příloha nespálila kredit.
 *
 * A skládá se věta pro člověka: co AI četla a co ne. Aby při kontrole návrhu
 * věděl, z čeho vychází.
 */

/** Kolik příloh z jedné zprávy jde nejvýš k AI. */
export const FILES_MAX = 4;

/** Největší jedna příloha. */
export const FILE_MAX_BYTES = 5 * 1024 * 1024;

/** Všechny přílohy jedné zprávy dohromady. */
export const FILES_TOTAL_BYTES = 10 * 1024 * 1024;

/**
 * Strop na délku: kolik tokenů smějí přílohy jedné zprávy stát dohromady.
 * Strana PDF vyjde na 560 tokenů, obrázek asi na 1 100 (změřeno přes
 * `countTokens`), takže je to zhruba 20 stran. Na větším modelu to dělá
 * nejvýš kolem 20 haléřů za jedno kliknutí.
 */
export const FILES_MAX_TOKENS = 12_000;

export type FileMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

const BY_EXT: Record<string, FileMime> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const READABLE = new Set<string>(Object.values(BY_EXT));

/** Typy, pod kterými poštovní programy posílají „nějaký soubor“ — rozhodne přípona. */
const GENERIC = new Set(["", "application/octet-stream", "application/x-download", "binary/octet-stream"]);

/**
 * Typ, který by příloha měla mít: podle hlavičky, a když je hlavička obecná,
 * podle přípony. `null` = tenhle typ AI nečte. Je to jen odhad před stažením;
 * co soubor doopravdy je, řekne až `sniffMime`.
 */
export function expectedMime(file: { filename: string; mimeType: string }): FileMime | null {
  const declared = file.mimeType.toLowerCase().split(";")[0].trim();
  if (declared === "image/jpg" || declared === "image/pjpeg") return "image/jpeg";
  if (declared === "application/x-pdf") return "application/pdf";
  if (READABLE.has(declared)) return declared as FileMime;
  if (!GENERIC.has(declared)) return null;

  const ext = /\.([a-z0-9]+)\s*$/i.exec(file.filename)?.[1]?.toLowerCase();
  return (ext && BY_EXT[ext]) || null;
}

function startsWith(bytes: Uint8Array, sig: number[], at = 0): boolean {
  if (bytes.length < at + sig.length) return false;
  return sig.every((b, i) => bytes[at + i] === b);
}

/**
 * Co soubor doopravdy je, podle prvních bajtů. Jméno i typ v hlavičce volí
 * odesílatel; tohle je jediné, co se podvrhnout nedá. `null` = nic z toho,
 * co AI čte.
 */
export function sniffMime(bytes: Uint8Array): FileMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";

  // „%PDF-“ nemusí být úplně na začátku — norma dovoluje pár bajtů před ním.
  const head = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= head; i++) {
    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d], i)) return "application/pdf";
  }
  return null;
}

/**
 * Jméno souboru do zadání pro AI i do hlášky pro člověka. Volí ho odesílatel,
 * takže z něj mizí všechno, co by v zadání vypadalo jako značka nebo další
 * řádek, a zkracuje se.
 */
export function fileLabel(filename: string): string {
  const s = filename
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<{3,}/g, "‹‹‹")
    .replace(/>{3,}/g, "›››")
    .replace(/\[\[|\]\]/g, "")
    .replace(/[„“”"]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return s.slice(0, 80).trimEnd() || "bez názvu";
}

/**
 * Proč AI přílohu nečetla:
 * type — typ, který neumí; size — moc velká; total — přílohy dohromady moc
 * velké; count — víc příloh, než čte; long — moc dlouhá (stran);
 * failed — nešla stáhnout, zkontrolovat, nebo není tím, za co se vydává.
 */
export type SkipReason = "type" | "size" | "total" | "count" | "long" | "failed";

export type SkippedFile = { name: string; reason: SkipReason };

export type PlannedFile = { file: MailAttachment; name: string; mime: FileMime };

/**
 * Které přílohy má smysl vůbec stahovat. Rozhoduje se podle toho, co o nich
 * říká Gmail (typ, velikost), v pořadí, v jakém jsou ve zprávě.
 */
export function planFiles(files: MailAttachment[]): { take: PlannedFile[]; skipped: SkippedFile[] } {
  const take: PlannedFile[] = [];
  const skipped: SkippedFile[] = [];
  let total = 0;

  for (const file of files) {
    const name = fileLabel(file.filename);
    const mime = expectedMime(file);

    if (!mime) skipped.push({ name, reason: "type" });
    else if (file.size > FILE_MAX_BYTES) skipped.push({ name, reason: "size" });
    else if (take.length >= FILES_MAX) skipped.push({ name, reason: "count" });
    else if (total + file.size > FILES_TOTAL_BYTES) skipped.push({ name, reason: "total" });
    else {
      total += file.size;
      take.push({ file, name, mime });
    }
  }
  return { take, skipped };
}

/**
 * Kontrola staženého souboru. Vrací skutečný typ, nebo důvod, proč k AI
 * nepůjde: prázdný, větší, než Gmail tvrdil, nebo něco jiného než PDF
 * a obrázek, i když se tak jmenuje.
 */
export function checkBytes(bytes: Uint8Array): { mime: FileMime } | { reason: SkipReason } {
  if (bytes.length === 0) return { reason: "failed" };
  if (bytes.length > FILE_MAX_BYTES) return { reason: "size" };
  const mime = sniffMime(bytes);
  return mime ? { mime } : { reason: "failed" };
}

/**
 * Které soubory se vejdou do stropu na délku. Bere se popořadě; co se
 * nevejde, se přeskočí, ale kratší soubor za ním ještě projít může.
 */
export function fitBudget<T extends { name: string; tokens: number }>(
  items: T[],
  max: number = FILES_MAX_TOKENS,
): { keep: T[]; skipped: SkippedFile[] } {
  const keep: T[] = [];
  const skipped: SkippedFile[] = [];
  let used = 0;

  for (const item of items) {
    if (!Number.isFinite(item.tokens) || item.tokens <= 0) skipped.push({ name: item.name, reason: "failed" });
    else if (used + item.tokens > max) skipped.push({ name: item.name, reason: "long" });
    else {
      used += item.tokens;
      keep.push(item);
    }
  }
  return { keep, skipped };
}

const MB = (bytes: number) => Math.round(bytes / (1024 * 1024));

/** Důvod slovy — pro jednu přílohu a pro víc. */
const WHY: Record<SkipReason, [string, string]> = {
  type: ["tenhle typ souboru neumí, čte jen PDF a obrázky", "tyhle typy souborů neumí, čte jen PDF a obrázky"],
  size: [`je větší než ${MB(FILE_MAX_BYTES)} MB`, `jsou větší než ${MB(FILE_MAX_BYTES)} MB`],
  total: [`přílohy dohromady by přesáhly ${MB(FILES_TOTAL_BYTES)} MB`, `přílohy dohromady by přesáhly ${MB(FILES_TOTAL_BYTES)} MB`],
  count: [`čte nejvýš ${FILES_MAX} přílohy z jedné zprávy`, `čte nejvýš ${FILES_MAX} přílohy z jedné zprávy`],
  long: ["je moc dlouhá, dohromady čte asi 20 stran", "jsou moc dlouhé, dohromady čte asi 20 stran"],
  failed: ["nepodařilo se ji načíst", "nepodařilo se je načíst"],
};

const ORDER: SkipReason[] = ["type", "size", "total", "count", "long", "failed"];

const quoted = (names: string[]) => names.map((n) => `„${n}“`).join(", ");

/**
 * Co o přílohách říct člověku, který bude návrh kontrolovat.
 *
 * `allowed`: majitel schránky čtení příloh povolil. `readable`: mezi
 * přílohami je aspoň jedna, kterou by AI přečíst uměla — jen pak má smysl
 * radit, kde se čtení zapíná.
 */
export function fileNotes(o: {
  total: number;
  allowed: boolean;
  readable: boolean;
  read: string[];
  skipped: SkippedFile[];
}): string[] {
  if (o.total <= 0) return [];
  if (!o.allowed) {
    return [
      o.readable
        ? "E-mail má přílohy — ty AI nečte. Čtení PDF a obrázků se zapíná v nastavení pošty."
        : "E-mail má přílohy — ty AI nečte.",
    ];
  }

  const out: string[] = [];
  if (o.read.length === 1) out.push(`AI četla i přílohu ${quoted(o.read)}.`);
  else if (o.read.length > 1) out.push(`AI četla i přílohy ${quoted(o.read)}.`);

  for (const reason of ORDER) {
    const names = o.skipped.filter((s) => s.reason === reason).map((s) => s.name);
    if (names.length === 1) out.push(`Přílohu ${quoted(names)} AI nečetla — ${WHY[reason][0]}.`);
    else if (names.length > 1) out.push(`Přílohy ${quoted(names)} AI nečetla — ${WHY[reason][1]}.`);
  }
  return out;
}
