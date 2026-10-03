import "server-only";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import { decryptToken, encryptToken } from "./mail-crypto";
import {
  GmailAuthExpired,
  GmailError,
  accessTokenFrom,
  exchangeCode,
  fetchEmailAddress,
  fetchInbox,
  fetchMessage,
  isGmailConfigured,
  revokeToken,
} from "./gmail";
import { triage, type ClientContact, type MailStatus } from "./mail-rules";
import { prepareBody, type PreparedBody } from "./mail-body";
import { MAIL_MAX_TASKS, buildMailPrompt, finishMailProposals } from "./mail-capture";
import {
  REPLY_JSON_SCHEMA,
  assembleReply,
  buildReplyPrompt,
  missingParts,
  riskyParts,
  riskyWarning,
  unverifiedNumbers,
} from "./mail-reply";
import { LEAD_JSON_SCHEMA, buildLeadPrompt, finishLeadDraft, sanitizeLeadDraft, type LeadDraft } from "./mail-lead";
import { createLead } from "./leads";
import { CAPTURE_JSON_SCHEMA, normalizeProposals, type CaptureResult } from "./capture";
import { createProposedTasks, knownAiError } from "./capture-data";
import { availableProviders, extractJson } from "./ai";
import { listCategories, listClients } from "./tasks";
import { dateKeyPrague, todayKeyPrague } from "./domain";

/**
 * Pošta — ukládání a čtení.
 *
 * Z Gmailu se ukládají jen hlavičky (odesílatel, předmět, datum) a stav.
 * Text zprávy se neukládá nikdy. Do AI jde jediná věc: text jedné zprávy,
 * u které majitel schránky klikl na „Udělat úkol“, a jen když návrh úkolu
 * pomocí AI sám povolil (`ai_consent_at`). Viz `proposeFromMail`.
 */

export type MailAccount = {
  email: string;
  lastSyncAt: string | null;
  /** Kdy majitel povolil, aby AI četla text zprávy při návrhu úkolu. */
  aiConsentAt: string | null;
};

export type MailRow = {
  id: string;
  gmailId: string;
  threadId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  receivedAt: string;
  status: MailStatus;
  clientId: string | null;
  clientName: string | null;
  handledAt: string | null;
  taskId: string | null;
};

export type ActionResult = { ok: true } | { ok: false; message: string };

/** Kolik dní zpětně se pošta stahuje. */
const OKNO_DNI = 7;

function klicProSifrovani(): string {
  const k = process.env.MAIL_TOKEN_KEY;
  if (!k) throw new GmailError("Chybí MAIL_TOKEN_KEY.");
  return k;
}

function chybaText(e: unknown): string {
  if (e instanceof GmailAuthExpired) return e.message;
  if (e instanceof GmailError) return e.message;
  console.error("Pošta selhala:", e);
  return "Nepodařilo se spojit s Gmailem. Zkus to za chvíli znovu.";
}

export { isGmailConfigured };

/**
 * Úkol z e-mailu čte výhradně Gemini — je to jediná služba, o které zásady
 * soukromí u pošty mluví. I kdyby byl nastavený i jiný poskytovatel, obsah
 * z Gmailu se mu nepošle.
 */
export function isMailAiAvailable(): boolean {
  return availableProviders().includes("gemini");
}

export async function loadMailAccount(userId: string): Promise<MailAccount | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("mail_accounts")
    .select("email, last_sync_at, ai_consent_at")
    .eq("user_id", userId)
    .maybeSingle();

  return data
    ? {
        email: data.email as string,
        lastSyncAt: (data.last_sync_at as string | null) ?? null,
        aiConsentAt: (data.ai_consent_at as string | null) ?? null,
      }
    : null;
}

/**
 * Dokončení připojení: kód z přesměrování se vymění za trvalé přihlášení,
 * které se uloží zašifrované. V čitelné podobě nikde nezůstane.
 */
export async function connectMailbox(orgId: string, userId: string, code: string, origin: string): Promise<ActionResult> {
  try {
    const { refreshToken, accessToken } = await exchangeCode(code, origin);
    const email = await fetchEmailAddress(accessToken);

    const supabase = await supabaseServer();

    // Souhlas s AI i stažená pošta patří ke konkrétní schránce. Když se
    // člověk připojí jinou adresou, začíná od nuly — souhlas dá znovu
    // a zprávy z té staré zmizí.
    const { data: drive } = await supabase.from("mail_accounts").select("email").eq("user_id", userId).maybeSingle();
    const jinaSchranka = Boolean(drive) && (drive?.email as string) !== email;
    if (jinaSchranka) await supabase.from("mail_messages").delete().eq("user_id", userId);

    const { error } = await supabase.from("mail_accounts").upsert(
      {
        org_id: orgId,
        user_id: userId,
        email,
        token_enc: encryptToken(refreshToken, klicProSifrovani()),
        last_sync_at: null,
        ...(jinaSchranka ? { ai_consent_at: null } : {}),
      },
      { onConflict: "user_id" },
    );
    if (error) return { ok: false, message: error.message };

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: chybaText(e) };
  }
}

/** Odpojení: zruší přístup u Googlu a smaže uložené přihlášení i staženou poštu. */
export async function disconnectMailbox(userId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("mail_accounts").select("token_enc").eq("user_id", userId).maybeSingle();

  if (data?.token_enc) {
    try {
      await revokeToken(decryptToken(data.token_enc as string, klicProSifrovani()));
    } catch {
      // I kdyby odvolání u Googlu selhalo, uložené přihlášení mažeme —
      // přístup jde zrušit i ručně v nastavení účtu Google.
    }
  }

  await supabase.from("mail_messages").delete().eq("user_id", userId);
  const { error } = await supabase.from("mail_accounts").delete().eq("user_id", userId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Adresy, podle kterých se pozná, komu zpráva patří: z karty klienta i z kontaktů. */
async function nactiKontakty(orgId: string): Promise<ClientContact[]> {
  const supabase = await supabaseServer();
  const [{ data: klienti }, { data: kontakty }] = await Promise.all([
    supabase.from("clients").select("id, email").eq("org_id", orgId).eq("archived", false),
    supabase.from("client_contacts").select("client_id, email").eq("org_id", orgId),
  ]);

  const podleKlienta = new Map<string, string[]>();
  const pridej = (id: string | null, email: string | null) => {
    if (!id || !email?.trim()) return;
    podleKlienta.set(id, [...(podleKlienta.get(id) ?? []), email.trim()]);
  };

  for (const k of klienti ?? []) pridej(k.id as string, k.email as string | null);
  for (const c of kontakty ?? []) pridej(c.client_id as string, c.email as string | null);

  return [...podleKlienta].map(([clientId, emails]) => ({ clientId, emails }));
}

/**
 * Stažení pošty. Vlákna, která už v doručených nejsou, se z appky smažou —
 * přehled má zrcadlit schránku, ne si držet vlastní historii.
 */
export async function syncMailbox(orgId: string, userId: string): Promise<ActionResult & { count?: number }> {
  const supabase = await supabaseServer();

  const { data: ucet } = await supabase
    .from("mail_accounts")
    .select("email, token_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (!ucet) return { ok: false, message: "Schránka není připojená." };

  try {
    const accessToken = await accessTokenFrom(decryptToken(ucet.token_enc as string, klicProSifrovani()));
    const syrove = await fetchInbox(accessToken, OKNO_DNI, ucet.email as string);

    const [kontakty, { data: ignorovani }, { data: stavajici }] = await Promise.all([
      nactiKontakty(orgId),
      supabase.from("mail_ignored").select("pattern").eq("user_id", userId),
      supabase.from("mail_messages").select("gmail_id, handled_at, task_id").eq("user_id", userId),
    ]);

    const zpravy = triage(syrove, {
      myEmail: ucet.email as string,
      contacts: kontakty,
      ignored: (ignorovani ?? []).map((i) => i.pattern as string),
    });

    // Ruční zásahy („vyřízeno“, vzniklý úkol) se při obnovení nesmí ztratit.
    const drive = new Map(
      (stavajici ?? []).map((r) => [r.gmail_id as string, { handledAt: r.handled_at as string | null, taskId: r.task_id as string | null }]),
    );

    if (zpravy.length > 0) {
      const { error } = await supabase.from("mail_messages").upsert(
        zpravy.map((z) => ({
          org_id: orgId,
          user_id: userId,
          gmail_id: z.gmailId,
          thread_id: z.threadId,
          from_email: z.fromEmail,
          from_name: z.fromName,
          subject: z.subject,
          received_at: z.receivedAt,
          status: z.status,
          client_id: z.clientId,
          handled_at: drive.get(z.gmailId)?.handledAt ?? null,
          task_id: drive.get(z.gmailId)?.taskId ?? null,
        })),
        { onConflict: "user_id,gmail_id" },
      );
      if (error) return { ok: false, message: error.message };
    }

    const ponechat = new Set(zpravy.map((z) => z.gmailId));
    const kSmazani = [...drive.keys()].filter((id) => !ponechat.has(id));
    if (kSmazani.length > 0) {
      await supabase.from("mail_messages").delete().eq("user_id", userId).in("gmail_id", kSmazani);
    }

    await supabase.from("mail_accounts").update({ last_sync_at: new Date().toISOString() }).eq("user_id", userId);

    revalidatePath("/", "layout");
    return { ok: true, count: zpravy.length };
  } catch (e) {
    return { ok: false, message: chybaText(e) };
  }
}

export async function listMail(userId: string): Promise<MailRow[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("mail_messages")
    .select("id, gmail_id, thread_id, from_email, from_name, subject, received_at, status, client_id, handled_at, task_id, clients(name)")
    .eq("user_id", userId)
    .order("received_at", { ascending: false });

  type Row = {
    id: string; gmail_id: string; thread_id: string; from_email: string; from_name: string | null;
    subject: string | null; received_at: string; status: MailStatus; client_id: string | null;
    handled_at: string | null; task_id: string | null; clients: { name: string } | { name: string }[] | null;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    gmailId: r.gmail_id,
    threadId: r.thread_id,
    fromEmail: r.from_email,
    fromName: r.from_name,
    subject: r.subject,
    receivedAt: r.received_at,
    status: r.status,
    clientId: r.client_id,
    clientName: Array.isArray(r.clients) ? (r.clients[0]?.name ?? null) : (r.clients?.name ?? null),
    handledAt: r.handled_at,
    taskId: r.task_id,
  }));
}

export async function setHandled(id: string, handled: boolean): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("mail_messages")
    .update({ handled_at: handled ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "Zpráva se nenašla." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Odesílatel, kterého už nechceš vídat. Jeho zprávy se rovnou smažou. */
export async function ignoreSender(orgId: string, userId: string, pattern: string): Promise<ActionResult> {
  const vzorec = pattern.trim().toLowerCase().replace(/^@/, "");
  if (!vzorec) return { ok: false, message: "Chybí adresa nebo doména." };

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("mail_ignored")
    .upsert({ org_id: orgId, user_id: userId, pattern: vzorec }, { onConflict: "user_id,pattern" });
  if (error) return { ok: false, message: error.message };

  const jeDomena = !vzorec.includes("@");
  const dotaz = supabase.from("mail_messages").delete().eq("user_id", userId);
  await (jeDomena ? dotaz.like("from_email", `%@${vzorec}`) : dotaz.eq("from_email", vzorec));

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Ze zprávy úkol bez AI: jen z předmětu a odesílatele. Příznak „vyřízeno“
 * se nastaví rovnou — zpráva je tím vyřešená, dál ji hlídá úkol.
 */
export async function taskFromMail(orgId: string, userId: string, mailId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data: zprava } = await supabase
    .from("mail_messages")
    .select("subject, from_name, from_email, client_id, task_id")
    .eq("id", mailId)
    .maybeSingle();
  if (!zprava) return { ok: false, message: "Zpráva se nenašla." };
  // Dvojí kliknutí nesmí založit úkol dvakrát.
  if (zprava.task_id) return { ok: false, message: "Z téhle zprávy už úkol vznikl." };

  const kdo = (zprava.from_name as string | null)?.trim() || (zprava.from_email as string);
  const predmet = (zprava.subject as string | null)?.trim();
  const nazev = (predmet ? `Odpovědět: ${predmet}` : `Odpovědět: ${kdo}`).slice(0, 200);

  const zaDvaDny = new Date();
  zaDvaDny.setUTCDate(zaDvaDny.getUTCDate() + 2);

  const { data: ukol, error } = await supabase
    .from("tasks")
    .insert({
      org_id: orgId,
      title: nazev,
      // S klientem jen tehdy, když víme s kým; jinak je to interní úkol.
      kind: zprava.client_id ? "klient" : "interni",
      step: 0,
      size: 1,
      client_id: zprava.client_id,
      assignee_id: userId,
      created_by: userId,
      due_at: `${zaDvaDny.toISOString().slice(0, 10)}T00:00:00.000Z`,
    })
    .select("id")
    .single();

  if (error || !ukol) return { ok: false, message: error?.message ?? "Úkol se nepodařilo založit." };

  await supabase
    .from("mail_messages")
    .update({ task_id: ukol.id, handled_at: new Date().toISOString() })
    .eq("id", mailId);

  revalidatePath("/", "layout");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Úkol z e-mailu pomocí AI                                             */
/* ------------------------------------------------------------------ */

/**
 * Zapnutí nebo vypnutí návrhu úkolu pomocí AI. Souhlas dává majitel schránky
 * a jen za sebe — řádek `mail_accounts` nikdo jiný změnit nemůže.
 */
export async function setMailAiConsent(userId: string, on: boolean): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("mail_accounts")
    .update({ ai_consent_at: on ? new Date().toISOString() : null })
    .eq("user_id", userId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "Schránka není připojená." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Neúspěch u čehokoli, kde AI čte e-mail. `needsConsent`: nejde o chybu, jen se nejdřív musí zeptat na souhlas. */
type AiFail = { ok: false; message: string; needsConsent?: boolean };

/** Zpráva i s textem, připravená pro AI. Text se nikam neukládá. */
type MailWithBody = {
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  receivedAt: string;
  clientId: string | null;
  telo: PreparedBody;
};

/**
 * Společný začátek všeho, k čemu AI potřebuje číst e-mail: návrh úkolu,
 * poptávky i odpovědi.
 *
 * Jediné místo, kde appka čte text zprávy a odkud data z Gmailu míří k AI.
 * Proto se tu souhlas kontroluje na serveru a dřív, než se cokoli z Gmailu
 * načte — tlačítko v prohlížeči je jen pohodlí, ne pojistka.
 */
async function nactiProAi(
  userId: string,
  mailId: string,
  opts: { bezUkolu?: boolean } = {},
): Promise<({ ok: true } & MailWithBody) | AiFail> {
  const supabase = await supabaseServer();

  const [{ data: ucet }, { data: zprava }] = await Promise.all([
    supabase.from("mail_accounts").select("token_enc, ai_consent_at").eq("user_id", userId).maybeSingle(),
    supabase
      .from("mail_messages")
      .select("gmail_id, from_name, from_email, subject, received_at, client_id, task_id")
      .eq("id", mailId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!ucet) return { ok: false, message: "Schránka není připojená." };
  if (!ucet.ai_consent_at) return { ok: false, needsConsent: true, message: "Pomoc AI s e-mailem není povolená." };
  if (!zprava) return { ok: false, message: "Zpráva se nenašla." };
  if (opts.bezUkolu && zprava.task_id) return { ok: false, message: "Z téhle zprávy už úkol vznikl." };
  if (!isMailAiAvailable()) return { ok: false, message: "Na serveru chybí klíč ke Gemini (GEMINI_API_KEY)." };

  let telo: PreparedBody;
  try {
    const accessToken = await accessTokenFrom(decryptToken(ucet.token_enc as string, klicProSifrovani()));
    telo = prepareBody(await fetchMessage(accessToken, zprava.gmail_id as string), zprava.subject as string | null);
  } catch (e) {
    if (e instanceof GmailError && e.status === 404) {
      return { ok: false, message: "Zpráva už v Gmailu není. Klikni na Obnovit." };
    }
    return { ok: false, message: chybaText(e) };
  }

  if (!telo.text) {
    return {
      ok: false,
      message:
        telo.attachments > 0
          ? "E-mail nemá žádný text, jen přílohy — a ty AI nečte."
          : "E-mail nemá žádný text, který by šel přečíst.",
    };
  }

  return {
    ok: true,
    fromName: zprava.from_name as string | null,
    fromEmail: zprava.from_email as string,
    subject: zprava.subject as string | null,
    receivedAt: zprava.received_at as string,
    clientId: zprava.client_id as string | null,
    telo,
  };
}

/** Známou chybu AI řekne přesně, neznámou obecně. `rada` je, co zkusit místo toho. */
function aiSelhala(e: unknown, co: string, rada: string): AiFail {
  const known = knownAiError(e);
  // Do záznamu jen druh chyby — nikdy nic, co by mohlo nést obsah e-mailu.
  if (!known) console.error(`${co} selhal:`, e instanceof Error ? e.name : typeof e);
  return { ok: false, message: known ?? `AI se nepodařilo e-mail zpracovat. ${rada}` };
}

/** Co AI neviděla — ať se podle toho člověk při kontrole zařídí. */
function coNevidela(telo: PreparedBody): string[] {
  const out: string[] = [];
  if (telo.truncated) out.push("E-mail je dlouhý, AI četla jen jeho začátek.");
  if (telo.attachments > 0) out.push("E-mail má přílohy — ty AI nečte.");
  return out;
}

export type MailProposeResult = ({ ok: true } & CaptureResult) | AiFail;

/** E-mail → návrh úkolů. Nic nezakládá a nic neukládá. */
export async function proposeFromMail(orgId: string, userId: string, mailId: string): Promise<MailProposeResult> {
  const z = await nactiProAi(userId, mailId, { bezUkolu: true });
  if (!z.ok) return z;

  const [clients, categories] = await Promise.all([listClients(orgId), listCategories(orgId)]);
  const ctx = {
    today: todayKeyPrague(),
    clients: clients.map((c) => ({ id: c.id, name: c.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
  };

  // Klient poznaný podle adresy se použije jen tehdy, když ještě existuje
  // a není archivovaný — jinak by se úkol při zakládání odmítl.
  const klient = ctx.clients.find((c) => c.id === z.clientId) ?? null;

  const { system, prompt } = buildMailPrompt(
    {
      fromName: z.fromName,
      fromEmail: z.fromEmail,
      subject: z.subject,
      sentOn: dateKeyPrague(z.receivedAt),
      body: z.telo.text,
      truncated: z.telo.truncated,
      attachments: z.telo.attachments,
      clientName: klient?.name ?? null,
    },
    ctx,
  );

  try {
    const raw = await extractJson("gemini", system, prompt, CAPTURE_JSON_SCHEMA as unknown as Record<string, unknown>);
    const navrh = normalizeProposals(raw, ctx, { quietUnknownClient: Boolean(klient) });
    return {
      ok: true,
      ...finishMailProposals(navrh, {
        today: ctx.today,
        defaultClientId: klient?.id ?? null,
        truncated: z.telo.truncated,
        attachments: z.telo.attachments,
        sender: { name: z.fromName, email: z.fromEmail },
      }),
    };
  } catch (e) {
    return aiSelhala(e, "Návrh úkolu z e-mailu", "Zkus to znovu, nebo založ úkol bez AI.");
  }
}

export type MailReplyResult =
  | {
      ok: true;
      reply: string;
      /** Co musí člověk doplnit sám, než odpověď odešle. */
      missing: string[];
      /** Upozornění na platební údaj, odkaz nebo adresu, které v pokynu nebyly. */
      risk: string | null;
      /** Čísla v návrhu, která nejsou z pokynu — ke kontrole před odesláním. */
      numbers: string[];
      warnings: string[];
    }
  | AiFail;

/**
 * E-mail → návrh odpovědi. Appka ho neodesílá ani neukládá: je to koncept,
 * který si člověk přečte, upraví a v Gmailu odešle sám. `hint` je to, co
 * chce sdělit, stačí heslovitě; může být prázdný.
 */
export async function draftReplyFromMail(userId: string, mailId: string, hint: unknown): Promise<MailReplyResult> {
  const z = await nactiProAi(userId, mailId);
  if (!z.ok) return z;

  const supabase = await supabaseServer();
  const { data: profil } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();

  const pokyn = typeof hint === "string" ? hint : "";

  const { system, prompt } = buildReplyPrompt({
    today: todayKeyPrague(),
    fromName: z.fromName,
    fromEmail: z.fromEmail,
    subject: z.subject,
    sentOn: dateKeyPrague(z.receivedAt),
    body: z.telo.text,
    truncated: z.telo.truncated,
    attachments: z.telo.attachments,
    hint: pokyn,
    // Pro každé volání nový kód: ohraničuje pokyn uživatele tak, aby ho
    // odesílatel e-mailu nemohl napodobit (viz `mail-reply.ts`).
    nonce: randomBytes(8).toString("hex"),
  });

  try {
    // Opatrné volání: návrh půjde ven pod jménem uživatele a e-mail psal
    // někdo cizí — lehký model se tu dá textem e-mailu přemluvit.
    const raw = await extractJson("gemini", system, prompt, REPLY_JSON_SCHEMA as unknown as Record<string, unknown>, {
      careful: true,
    });
    const slozeno = assembleReply(raw, (profil?.full_name as string | null) ?? null);
    if (!slozeno) return { ok: false, message: "AI nevrátila žádný text. Zkus to znovu." };
    return {
      ok: true,
      reply: slozeno.text,
      missing: missingParts(slozeno.text),
      risk: riskyWarning(riskyParts(slozeno.text, pokyn)),
      numbers: unverifiedNumbers(slozeno.text, pokyn),
      warnings: coNevidela(z.telo),
    };
  } catch (e) {
    return aiSelhala(e, "Návrh odpovědi", "Zkus to znovu.");
  }
}

export type MailLeadResult = { ok: true; draft: LeadDraft; warnings: string[] } | AiFail;

/** E-mail → návrh poptávky. Nic nezakládá a nic neukládá. */
export async function proposeLeadFromMail(orgId: string, userId: string, mailId: string): Promise<MailLeadResult> {
  const z = await nactiProAi(userId, mailId, { bezUkolu: true });
  if (!z.ok) return z;

  const today = todayKeyPrague();
  const { system, prompt } = buildLeadPrompt(
    {
      fromName: z.fromName,
      fromEmail: z.fromEmail,
      subject: z.subject,
      sentOn: dateKeyPrague(z.receivedAt),
      body: z.telo.text,
      truncated: z.telo.truncated,
      attachments: z.telo.attachments,
    },
    today,
  );

  try {
    const raw = await extractJson("gemini", system, prompt, LEAD_JSON_SCHEMA as unknown as Record<string, unknown>);
    const { draft, warnings } = finishLeadDraft(raw, {
      today,
      sender: { name: z.fromName, email: z.fromEmail },
      subject: z.subject,
      truncated: z.telo.truncated,
      attachments: z.telo.attachments,
    });

    // Otevřená poptávka od stejné adresy už existuje — tohle je nejspíš její
    // pokračování, ne nová. Jen upozornění, rozhodnutí je na člověku.
    const supabase = await supabaseServer();
    const { data: stejna } = await supabase
      .from("leads")
      .select("name")
      .eq("org_id", orgId)
      .ilike("email", draft.email.replace(/[\\%_]/g, "\\$&"))
      .in("status", ["poptavka", "nabidka"])
      .limit(1);
    if (stejna?.length) warnings.unshift(`Od téhle adresy už otevřenou poptávku máš: „${stejna[0].name as string}“.`);

    return { ok: true, draft, warnings };
  } catch (e) {
    return aiSelhala(e, "Návrh poptávky z e-mailu", "Zkus to znovu, nebo poptávku založ ručně v Poptávkách.");
  }
}

/**
 * Založení poptávky navržené z e-mailu. Návrh prošel přes prohlížeč, takže
 * se před založením kontroluje znovu. Zpráva se tím označí za vyřízenou —
 * dál ji hlídá další krok u poptávky.
 */
export async function createLeadFromMail(
  orgId: string,
  userId: string,
  mailId: string,
  input: unknown,
): Promise<ActionResult> {
  const check = sanitizeLeadDraft(input);
  if (!check.ok) return check;

  const supabase = await supabaseServer();
  const { data: zprava } = await supabase
    .from("mail_messages")
    .select("handled_at")
    .eq("id", mailId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!zprava) return { ok: false, message: "Zpráva se nenašla." };
  // Dvojí kliknutí nesmí založit poptávku dvakrát.
  if (zprava.handled_at) return { ok: false, message: "Tahle zpráva už je vyřízená." };

  const f = check.fields;
  const zalozeno = await createLead({
    orgId,
    name: f.name,
    company: f.company,
    contact: f.contact,
    email: f.email || null,
    phone: f.phone,
    note: f.note,
    nextStep: f.nextStep,
    nextStepAt: f.nextStepAt,
  });
  if (!zalozeno.ok) return zalozeno;

  await supabase
    .from("mail_messages")
    .update({ handled_at: new Date().toISOString() })
    .eq("id", mailId)
    .eq("user_id", userId);

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Založení úkolů navržených z e-mailu. Návrh prošel přes prohlížeč, takže
 * se před založením kontroluje znovu, stejně jako u rychlého zápisu. Zpráva
 * se označí za vyřízenou a odkáže na první z úkolů.
 */
export async function createTasksFromMail(
  orgId: string,
  userId: string,
  mailId: string,
  input: unknown,
): Promise<ActionResult & { created?: number }> {
  if (Array.isArray(input) && input.length > MAIL_MAX_TASKS) {
    return { ok: false, message: `Z jednoho e-mailu jde založit nejvýš ${MAIL_MAX_TASKS} úkolů.` };
  }

  const supabase = await supabaseServer();
  const { data: zprava } = await supabase
    .from("mail_messages")
    .select("task_id")
    .eq("id", mailId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!zprava) return { ok: false, message: "Zpráva se nenašla." };
  // Dvojí kliknutí nesmí založit úkoly dvakrát.
  if (zprava.task_id) return { ok: false, message: "Z téhle zprávy už úkol vznikl." };

  const zalozeno = await createProposedTasks(orgId, input);
  if (!zalozeno.ok) return zalozeno;

  await supabase
    .from("mail_messages")
    .update({ task_id: zalozeno.ids[0] ?? null, handled_at: new Date().toISOString() })
    .eq("id", mailId)
    .eq("user_id", userId);

  revalidatePath("/", "layout");
  return { ok: true, created: zalozeno.created };
}

export async function listIgnored(userId: string): Promise<{ id: string; pattern: string }[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("mail_ignored").select("id, pattern").eq("user_id", userId).order("pattern");
  return (data ?? []).map((r) => ({ id: r.id as string, pattern: r.pattern as string }));
}

export async function unignore(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("mail_ignored").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
