import { addDaysKey, daysBetweenKeys } from "./domain.ts";
import { isValidDateKey } from "./attention.ts";
import { FOREIGN_TEXT_RULE, bodyLines, dayWithName, oneLine, senderLine } from "./mail-capture.ts";

/**
 * Poptávka z e-mailu — zadání pro AI a dotažení toho, co vrátí.
 *
 * Čistá logika bez sítě a bez databáze. Poptávka je v appce krok před
 * založeným klientem: kdo se ozval, co chce a co se má stát dál. AI z e-mailu
 * vytáhne podklady, člověk je zkontroluje a potvrdí — nic se nezaloží samo.
 *
 * Dvě věci AI neurčuje nikdy: adresu (bere se ze skutečné hlavičky zprávy,
 * ne z textu) a částku (tu z e-mailu nejde poznat a hádat ji by bylo horší
 * než ji nechat prázdnou).
 */

/** Když e-mail neříká, do kdy, další krok se navrhne stejně jako úkol. */
export const LEAD_DEFAULT_STEP_DAYS = 2;
export const LEAD_DEFAULT_STEP = "Odpovědět na poptávku";

const NAME_MAX = 200;
const FIELD_MAX = 200;
export const LEAD_NOTE_MAX = 1000;

export const LEAD_JSON_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Co poptávají — stručně, do osmi slov." },
    company: { type: "string", description: "Název firmy z e-mailu, nebo prázdný řetězec." },
    contact: { type: "string", description: "Jméno osoby, která píše, nebo prázdný řetězec." },
    phone: { type: "string", description: "Telefon z e-mailu, nebo prázdný řetězec." },
    note: { type: "string", description: "Dvě až tři věty, co přesně chtějí." },
    next_step: { type: "string", description: "Co má grafik udělat jako další krok." },
    next_step_due: { type: "string", description: "Do kdy, RRRR-MM-DD, nebo prázdný řetězec." },
  },
  required: ["name", "company", "contact", "phone", "note", "next_step", "next_step_due"],
  additionalProperties: false,
} as const;

/** Poptávka připravená k potvrzení. Další krok a datum jdou vždycky spolu. */
export type LeadDraft = {
  name: string;
  company: string | null;
  contact: string | null;
  email: string;
  phone: string | null;
  note: string | null;
  nextStep: string;
  nextStepAt: string;
};

export type LeadMail = {
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  /** Den odeslání podle Prahy, "RRRR-MM-DD". */
  sentOn: string;
  body: string;
  truncated: boolean;
  attachments: number;
};

const LEAD_SYSTEM = `Čteš e-mail od možného nového zákazníka grafického studia a připravuješ z něj záznam poptávky.

${FOREIGN_TEXT_RULE}

Pole:
- name: co poptávají — stručně, do osmi slov, bez uvozovek. Například „Logo, vizitky a web pro kavárnu“.
- company: název firmy nebo organizace, pokud v e-mailu stojí (v textu nebo v podpisu). Z e-mailové adresy ho neodvozuj. Jinak prázdný řetězec.
- contact: jméno osoby, která píše. Jinak prázdný řetězec.
- phone: telefon, pokud je v e-mailu uveden. Jinak prázdný řetězec.
- note: dvě až tři věty — co přesně chtějí a co je k tomu důležité (rozsah, počty, formáty, termín, rozpočet). Jen to, co v e-mailu opravdu stojí.
- next_step: co má grafik udělat jako další krok, stručný příkaz. Například „Poslat cenovou nabídku“ nebo „Zavolat a upřesnit zadání“.
- next_step_due: do kdy má další krok být, RRRR-MM-DD — jen když to z e-mailu plyne („do středy“ ano, „co nejdřív“ ne). Relativní údaje počítej od data ODESLÁNÍ e-mailu, ne od dnešního dne. Jinak prázdný řetězec.

Nic nevymýšlej. Když údaj v e-mailu není, vrať prázdný řetězec.`;

export function buildLeadPrompt(mail: LeadMail, today: string): { system: string; prompt: string } {
  const lines = [
    `Dnešní datum: ${dayWithName(today)}`,
    `E-mail odeslán: ${dayWithName(mail.sentOn)}`,
    "",
    `Odesílatel: ${senderLine(mail.fromName, mail.fromEmail)}`,
    `Předmět: ${oneLine(mail.subject, 300) || "(bez předmětu)"}`,
  ];
  if (mail.attachments > 0) lines.push(`Přílohy: ${mail.attachments} (jejich obsah nevidíš)`);
  lines.push("", ...bodyLines(mail));

  return { system: LEAD_SYSTEM, prompt: lines.join("\n") };
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Předmět bez „Re:“ a „Fwd:“ — nouzový název poptávky, když AI žádný nedala. */
function bareSubject(subject: string | null | undefined): string {
  return clean(subject ?? "", 300).replace(/^((re|fwd?|fw|pd|př)\s*:\s*)+/i, "").slice(0, NAME_MAX);
}

/**
 * Telefon jen tehdy, když to jako telefon vypadá: 9 až 15 číslic, nanejvýš
 * s plusem, mezerami, pomlčkami a závorkami. Cokoli jiného (věta, IČO
 * s textem okolo) se zahodí — špatný telefon je horší než žádný.
 */
export function cleanPhone(v: unknown): string | null {
  const s = clean(v, 40);
  if (!s || !/^[\d\s+\-/().]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return null;
  return s.replace(/\s+/g, " ");
}

/**
 * Dotažení návrhu poptávky do tvaru, který jde rovnou založit:
 *
 * - adresa je vždycky skutečná adresa odesílatele;
 * - název se vezme od AI, jinak z předmětu, jinak podle odesílatele;
 * - další krok má vždycky i datum — z e-mailu, jinak za dva dny, a člověk se
 *   dozví, že je odhadnuté. Nesmyslné datum se bere jako chybějící.
 */
export function finishLeadDraft(
  raw: unknown,
  opts: {
    today: string;
    sender: { name: string | null; email: string };
    subject: string | null;
    truncated: boolean;
    attachments: number;
  },
): { draft: LeadDraft; warnings: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const warnings: string[] = [];

  const senderName = clean(opts.sender.name, FIELD_MAX) || null;
  const email = opts.sender.email.replace(/\s+/g, "").slice(0, 320);

  const name =
    clean(r.name, NAME_MAX) || bareSubject(opts.subject) || `Poptávka od ${senderName ?? email}`.slice(0, NAME_MAX);

  const due = clean(r.next_step_due, 10);
  const offset = isValidDateKey(due) ? daysBetweenKeys(opts.today, due) : null;
  const sane = offset !== null && offset >= -31 && offset <= 730;

  let nextStepAt = due;
  if (!sane) {
    nextStepAt = addDaysKey(opts.today, LEAD_DEFAULT_STEP_DAYS);
    warnings.push("Termín v e-mailu není, další krok navrhuji za dva dny.");
  } else if (offset < 0) {
    warnings.push("Termín z e-mailu už uplynul.");
  }

  if (opts.truncated) warnings.push("E-mail je dlouhý, AI četla jen jeho začátek.");
  if (opts.attachments > 0) warnings.push("E-mail má přílohy — ty AI nečte.");

  return {
    draft: {
      name,
      company: clean(r.company, FIELD_MAX) || null,
      contact: clean(r.contact, FIELD_MAX) || senderName,
      email,
      phone: cleanPhone(r.phone),
      note: clean(r.note, LEAD_NOTE_MAX) || null,
      nextStep: clean(r.next_step, FIELD_MAX) || LEAD_DEFAULT_STEP,
      nextStepAt,
    },
    warnings,
  };
}

/**
 * Kontrola toho, co přišlo z prohlížeče, před založením. Návrh šel přes
 * člověka a mohl se cestou upravit nebo poslat mimo formulář.
 */
export function sanitizeLeadDraft(
  input: unknown,
): { ok: true; fields: LeadDraft } | { ok: false; message: string } {
  const p = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  const name = clean(p.name, NAME_MAX);
  if (!name) return { ok: false, message: "Poptávka potřebuje název." };

  const email = clean(p.email, 320).replace(/\s+/g, "");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "E-mail nemá platný tvar." };

  const nextStep = clean(p.nextStep, FIELD_MAX);
  const nextStepAt = clean(p.nextStepAt, 10);
  if (!nextStep) return { ok: false, message: "Další krok potřebuje popis, co se má stát." };
  if (!isValidDateKey(nextStepAt)) return { ok: false, message: "Další krok potřebuje platné datum." };

  const phoneRaw = clean(p.phone, 40);
  const phone = phoneRaw ? cleanPhone(phoneRaw) : null;
  if (phoneRaw && !phone) return { ok: false, message: "Telefon nemá platný tvar." };

  return {
    ok: true,
    fields: {
      name,
      company: clean(p.company, FIELD_MAX) || null,
      contact: clean(p.contact, FIELD_MAX) || null,
      email,
      phone,
      note: clean(p.note, LEAD_NOTE_MAX) || null,
      nextStep,
      nextStepAt,
    },
  };
}
