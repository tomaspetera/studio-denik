import "server-only";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseAdmin, supabaseServer } from "./supabase/server";
import { decryptToken, encryptToken } from "./mail-crypto";
import {
  GmailAuthExpired,
  GmailError,
  accessTokenFrom,
  exchangeCode,
  fetchAttachment,
  fetchEmailAddress,
  fetchInbox,
  fetchLabels,
  fetchMessage,
  isGmailConfigured,
  revokeToken,
} from "./gmail";
import { triage, type ClientContact, type MailStatus } from "./mail-rules";
import { prepareBody, type MailAttachment, type PreparedBody } from "./mail-body";
import {
  checkBytes,
  expectedMime,
  fileNotes,
  fitBudget,
  planFiles,
  type SkipReason,
  type SkippedFile,
} from "./mail-files";
import { MAIL_MAX_TASKS, buildMailPrompt, finishMailProposals } from "./mail-capture";
import {
  REPLY_JSON_SCHEMA,
  SIGNATURE_MAX,
  assembleReply,
  buildReplyPrompt,
  cleanSignature,
  missingParts,
  riskyParts,
  riskyWarning,
  unverifiedNumbers,
} from "./mail-reply";
import { LEAD_JSON_SCHEMA, buildLeadPrompt, finishLeadDraft, sanitizeLeadDraft, type LeadDraft } from "./mail-lead";
import { createLead } from "./leads";
import { CAPTURE_JSON_SCHEMA, normalizeProposals, type CaptureResult } from "./capture";
import { createProposedTasks, knownAiError } from "./capture-data";
import {
  AiNoCredit,
  AiNotConfigured,
  AiQuotaExceeded,
  availableProviders,
  countFileTokens,
  extractJson,
  type AiFile,
  type ExtractOptions,
} from "./ai";
import { TRIAGE_BODY_MAX, TRIAGE_JSON_SCHEMA, buildTriagePrompt, finishTriage } from "./mail-triage";
import { mailCounts, type MailCounts, type MailPriority } from "./mail-buckets";
import { pickLabels, readLabels, type MailLabel } from "./mail-labels";
import { listCategories, listClients } from "./tasks";
import { dateKeyPrague, todayKeyPrague } from "./domain";

/**
 * Pošta — ukládání a čtení.
 *
 * Z Gmailu se ukládají jen hlavičky (odesílatel, předmět, datum) a stav.
 * Text zprávy se neukládá nikdy. Do AI jde jediná věc: text jedné zprávy,
 * u které majitel schránky klikl na „Udělat úkol“, a jen když návrh úkolu
 * pomocí AI sám povolil (`ai_consent_at`). Viz `proposeFromMail`.
 *
 * Přílohy té zprávy (PDF a obrázky) jdou k AI jen se zvláštním souhlasem
 * (`ai_files_at`) a taky jen na kliknutí. Neukládají se. Viz `nactiPrilohy`.
 */

export type MailAccount = {
  email: string;
  lastSyncAt: string | null;
  /** Kdy majitel povolil, aby AI četla text zprávy při návrhu úkolu. */
  aiConsentAt: string | null;
  /** Kdy majitel povolil automatické třídění pošty podle priority. */
  aiAutoAt: string | null;
  /** Kdy majitel povolil, aby AI na kliknutí četla i přílohy zprávy (PDF, obrázky). */
  aiFilesAt: string | null;
  /** Kdy majitel povolil ranní načítání pošty bez kliknutí (`mail-schedule.ts`). */
  autoSyncAt: string | null;
  /** Štítky Gmailu, ze kterých se pošta načítá navíc k doručené (`mail-labels.ts`). */
  labels: MailLabel[];
};

/**
 * Klient databáze, se kterým pošta pracuje: běžně ten přihlášeného člověka
 * (platí pro něj přístupová práva), u ranního běhu servisní. Proto každý
 * dotaz na poštu filtruje podle `user_id` výslovně a nespoléhá na práva.
 */
type Db = Awaited<ReturnType<typeof supabaseServer>> | ReturnType<typeof supabaseAdmin>;

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
  /** Zařazení od AI. `null` = zpráva tříděním neprošla (nebo je vypnuté). */
  priority: MailPriority | null;
  /** Jedna věta od AI, o co ve zprávě jde. */
  summary: string | null;
};

export type ActionResult = { ok: true } | { ok: false; message: string };

/** Kolik dní zpětně se pošta stahuje. */
const OKNO_DNI = 7;

/** Kolik zpráv se nejvýš roztřídí při jednom načtení. Zbytek počká na příští. */
const TRIDIT_NAJEDNOU = 24;
/** Kolik zpráv se třídí souběžně — zrychlí to čekání a Gmail ani AI to nezatíží. */
const TRIDIT_SOUBEZNE = 4;
/**
 * Kolik času od začátku načítání smí třídění nejvýš zabrat. Stránka má na
 * celé načtení 60 vteřin a poslední rozběhnuté volání AI může trvat až 20.
 */
const TRIDIT_NEJDELE_MS = 25_000;

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
    .select("email, last_sync_at, ai_consent_at, ai_auto_at, ai_files_at, auto_sync_at, labels")
    .eq("user_id", userId)
    .maybeSingle();

  return data
    ? {
        email: data.email as string,
        lastSyncAt: (data.last_sync_at as string | null) ?? null,
        aiConsentAt: (data.ai_consent_at as string | null) ?? null,
        aiAutoAt: (data.ai_auto_at as string | null) ?? null,
        aiFilesAt: (data.ai_files_at as string | null) ?? null,
        autoSyncAt: (data.auto_sync_at as string | null) ?? null,
        labels: readLabels(data.labels),
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
        ...(jinaSchranka ? { ai_consent_at: null, ai_auto_at: null } : {}),
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
async function nactiKontakty(supabase: Db, orgId: string): Promise<ClientContact[]> {
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
export async function syncMailbox(orgId: string, userId: string): Promise<SyncResult> {
  const res = await syncMailboxWith(await supabaseServer(), orgId, userId, Date.now() + TRIDIT_NEJDELE_MS);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

type SyncResult = ActionResult & { count?: number; /** Kolik zpráv AI nově zařadila. */ sorted?: number; note?: string };

/**
 * Vlastní stažení pošty jedné schránky. `supabase` je klient přihlášeného
 * člověka („Obnovit“), nebo servisní (ranní běh). `tridimeDo` je čas, po
 * kterém se už nezačne třídit další zpráva.
 */
async function syncMailboxWith(supabase: Db, orgId: string, userId: string, tridimeDo: number): Promise<SyncResult> {
  const { data: ucet } = await supabase
    .from("mail_accounts")
    .select("email, token_enc, ai_consent_at, ai_auto_at, labels")
    .eq("user_id", userId)
    .maybeSingle();
  if (!ucet) return { ok: false, message: "Schránka není připojená." };

  // Jen štítky, které si majitel schránky sám vybral; bez výběru jen doručená pošta.
  const stitky = readLabels(ucet.labels);

  try {
    const accessToken = await accessTokenFrom(decryptToken(ucet.token_enc as string, klicProSifrovani()));
    const { messages: syrove, missingLabels } = await fetchInbox(
      accessToken,
      OKNO_DNI,
      ucet.email as string,
      stitky.map((s) => s.id),
    );

    const [kontakty, { data: ignorovani }, { data: stavajici }] = await Promise.all([
      nactiKontakty(supabase, orgId),
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

    // Třídění jen s oběma souhlasy. Pošta je v tu chvíli už načtená a uložená,
    // takže když se třídění nepovede, přehled to nerozbije — jen zůstane po starém.
    const trideni =
      ucet.ai_consent_at && ucet.ai_auto_at
        ? await sortNewMail(supabase, userId, accessToken, tridimeDo)
        : null;

    // Štítek, který mezitím v Gmailu zanikl: zbytek se načetl, ale člověk o tom má vědět.
    const zanikle = stitky.filter((s) => missingLabels.includes(s.id)).map((s) => `„${s.name}“`);
    const poznamky = [
      trideni?.note ?? null,
      zanikle.length === 1
        ? `Štítek ${zanikle[0]} už v Gmailu není — odškrtni ho v Nastavení.`
        : zanikle.length > 1
          ? `Štítky ${zanikle.join(", ")} už v Gmailu nejsou — odškrtni je v Nastavení.`
          : null,
    ].filter((p): p is string => Boolean(p));

    return { ok: true, count: zpravy.length, sorted: trideni?.sorted ?? 0, note: poznamky.join(" ") || undefined };
  } catch (e) {
    return { ok: false, message: chybaText(e) };
  }
}

/**
 * Zařazení nových zpráv podle priority. Jediné místo, kde text zprávy jde
 * do AI bez kliknutí u konkrétní zprávy — volá se jen se souhlasem
 * `ai_auto_at` a jen pro zprávy, které čekají na odpověď a tříděním ještě
 * neprošly. Každá zpráva jde do AI zvlášť, aby text jedné nemohl ovlivnit
 * zařazení druhé.
 *
 * Ukládá se zařazení a jedna věta shrnutí. Text zprávy ne.
 */
async function sortNewMail(
  supabase: Db,
  userId: string,
  accessToken: string,
  deadline: number,
): Promise<{ sorted: number; note: string | null }> {
  const { data: cekajici } = await supabase
    .from("mail_messages")
    .select("id, gmail_id, from_name, from_email, subject, received_at")
    .eq("user_id", userId)
    .eq("status", "waiting")
    .is("handled_at", null)
    .is("ai_checked_at", null)
    .order("received_at", { ascending: false })
    .limit(TRIDIT_NAJEDNOU + 1);

  const fronta = (cekajici ?? []).slice(0, TRIDIT_NAJEDNOU);
  if (fronta.length === 0) return { sorted: 0, note: null };
  if (!isMailAiAvailable()) return { sorted: 0, note: "Třídění je zapnuté, ale na serveru chybí klíč ke Gemini." };

  const today = todayKeyPrague();
  let sorted = 0;
  let hotovo = 0;
  let dalsi = 0;
  /** Proč se přestalo dřív — chyba, kterou další pokus hned nevyřeší. */
  let stop: string | null = null;

  const oznac = (id: string, zmena: Record<string, unknown>) =>
    supabase
      .from("mail_messages")
      .update({ ...zmena, ai_checked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId);

  const pracuj = async () => {
    while (dalsi < fronta.length && !stop && Date.now() < deadline) {
      const m = fronta[dalsi++];
      try {
        const telo = prepareBody(
          await fetchMessage(accessToken, m.gmail_id as string),
          m.subject as string | null,
          TRIAGE_BODY_MAX,
        );
        // Zpráva bez textu (jen obrázek nebo příloha): není co číst, zůstane
        // mezi těmi, které čekají na odpověď, a příště se už nezkouší.
        if (!telo.text) {
          await oznac(m.id as string, {});
          hotovo++;
          continue;
        }

        const { system, prompt } = buildTriagePrompt(
          {
            fromName: m.from_name as string | null,
            fromEmail: m.from_email as string,
            subject: m.subject as string | null,
            sentOn: dateKeyPrague(m.received_at as string),
            body: telo.text,
            truncated: telo.truncated,
            attachments: telo.attachments,
          },
          today,
        );
        // Větší model: e-mail píše někdo cizí a lehký se dá textem přemluvit.
        // Bez přemýšlení — vybírá se ze tří možností a běží to u každé zprávy.
        const raw = await extractJson("gemini", system, prompt, TRIAGE_JSON_SCHEMA as unknown as Record<string, unknown>, {
          careful: true,
          thinkingBudget: 0,
        });
        const v = finishTriage(raw);
        await oznac(m.id as string, { priority: v.priority, summary: v.summary });
        sorted++;
        hotovo++;
      } catch (e) {
        if (e instanceof GmailAuthExpired) {
          stop = e.message;
        } else if (e instanceof GmailError && e.status === 404) {
          // Zpráva mezitím z Gmailu zmizela — příští načtení ji z přehledu odstraní.
          await oznac(m.id as string, {});
          hotovo++;
        } else if (e instanceof AiNoCredit || e instanceof AiNotConfigured || e instanceof AiQuotaExceeded) {
          stop = e.message;
        }
        // Cokoli jiného (přetížení, vypršení času, nečitelná odpověď) je
        // přechodné: zpráva zůstane netříděná a zkusí se při dalším načtení.
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(TRIDIT_SOUBEZNE, fronta.length) }, pracuj));

  const zbylo = (cekajici ?? []).length - hotovo;
  const note = stop
    ? `Třídění se zastavilo: ${stop}`
    : zbylo > 0
      ? "Zbylé zprávy roztřídím při dalším načtení."
      : null;
  return { sorted, note };
}

/** Kolik času před koncem ranního běhu se už nezačíná další schránka. */
const RANO_REZERVA_MS = 10_000;

/**
 * Ranní načtení pošty bez přihlášeného člověka — volá ho jen ranní cron
 * a jen ve dny, kdy se pošta načítá sama (`isMailAutoDay`).
 *
 * Běží se servisním klíčem, tedy mimo přístupová práva. O to přísněji se
 * vybírá: jen schránky, jejichž majitel si ranní načítání sám zapnul
 * (`auto_sync_at`), a každý dotaz filtruje podle majitele. Dělá přesně to,
 * co „Obnovit“ — třídí tedy jen tomu, kdo má zapnuté i třídění.
 *
 * Vrací počty čekajících zpráv podle majitele (pro jeho ranní upozornění)
 * a kolik schránek se povedlo. Do odpovědi ani do záznamu nejde nic
 * z obsahu pošty.
 */
export async function syncMailboxesForCron(
  supabase: ReturnType<typeof supabaseAdmin>,
  deadline: number,
  /** Jen schránky jednoho studia — pro zkoušku ve vývoji, kde databáze je ta ostrá. */
  onlyOrgId: string | null = null,
): Promise<{ counts: Map<string, MailCounts>; synced: number; failed: number; skipped: number }> {
  const counts = new Map<string, MailCounts>();
  let synced = 0;
  let failed = 0;
  let skipped = 0;

  if (!isGmailConfigured()) return { counts, synced, failed, skipped };

  const zapnute = supabase.from("mail_accounts").select("org_id, user_id").not("auto_sync_at", "is", null);
  const { data: ucty } = await (onlyOrgId ? zapnute.eq("org_id", onlyOrgId) : zapnute).order("auto_sync_at");

  for (const u of ucty ?? []) {
    // Na další schránku už není čas — načte se příště, nebo ručně.
    if (Date.now() > deadline - RANO_REZERVA_MS) {
      skipped++;
      continue;
    }

    const userId = u.user_id as string;
    const res = await syncMailboxWith(
      supabase,
      u.org_id as string,
      userId,
      Math.min(Date.now() + TRIDIT_NEJDELE_MS, deadline - RANO_REZERVA_MS),
    );
    if (!res.ok) {
      // Odvolaný přístup, výpadek Gmailu… Majitel to uvidí, až poštu otevře;
      // staré počty se mu ráno neposílají.
      failed++;
      continue;
    }
    synced++;

    const { data: zpravy } = await supabase
      .from("mail_messages")
      .select("status, handled_at, priority")
      .eq("user_id", userId);
    counts.set(userId, spocitej(zpravy));
  }

  return { counts, synced, failed, skipped };
}

type CountRow = { status: unknown; handled_at: unknown; priority: unknown };

function spocitej(zpravy: CountRow[] | null): MailCounts {
  return mailCounts(
    (zpravy ?? []).map((z) => ({
      status: z.status as MailStatus,
      handledAt: (z.handled_at as string | null) ?? null,
      priority: (z.priority as MailPriority | null) ?? null,
    })),
  );
}

/** Pošta na stránce Dnes: kolik zpráv čeká a kdy se naposledy načetla. `null` bez připojené schránky. */
export async function loadMailSummary(userId: string): Promise<(MailCounts & { lastSyncAt: string | null }) | null> {
  const supabase = await supabaseServer();
  const [{ data: ucet }, { data: zpravy }] = await Promise.all([
    supabase.from("mail_accounts").select("last_sync_at").eq("user_id", userId).maybeSingle(),
    supabase.from("mail_messages").select("status, handled_at, priority").eq("user_id", userId),
  ]);
  if (!ucet) return null;
  return { ...spocitej(zpravy), lastSyncAt: (ucet.last_sync_at as string | null) ?? null };
}

export async function listMail(userId: string): Promise<MailRow[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("mail_messages")
    .select("id, gmail_id, thread_id, from_email, from_name, subject, received_at, status, client_id, handled_at, task_id, priority, summary, clients(name)")
    .eq("user_id", userId)
    .order("received_at", { ascending: false });

  type Row = {
    id: string; gmail_id: string; thread_id: string; from_email: string; from_name: string | null;
    subject: string | null; received_at: string; status: MailStatus; client_id: string | null;
    handled_at: string | null; task_id: string | null; priority: MailPriority | null; summary: string | null;
    clients: { name: string } | { name: string }[] | null;
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
    priority: r.priority,
    summary: r.summary,
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
    // Vypnutím padá i automatické třídění a čtení příloh — bez základního souhlasu nesmí běžet.
    .update(
      on
        ? { ai_consent_at: new Date().toISOString() }
        : { ai_consent_at: null, ai_auto_at: null, ai_files_at: null },
    )
    .eq("user_id", userId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "Schránka není připojená." };
  if (!on) await vymazTrideni(userId);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Smaže, co AI o zprávách uložila: zařazení, shrnutí i značku, že tříděním prošly. */
async function vymazTrideni(userId: string): Promise<void> {
  const supabase = await supabaseServer();
  await supabase
    .from("mail_messages")
    .update({ priority: null, summary: null, ai_checked_at: null })
    .eq("user_id", userId);
}

/**
 * Zapnutí nebo vypnutí automatického třídění podle priority. Je to širší
 * souhlas než pomoc na kliknutí: text nových zpráv jde do AI sám při každém
 * načtení pošty. Proto se zapíná zvlášť a jen tehdy, když už je povolená
 * pomoc AI. Vypnutím se uložená zařazení a shrnutí smažou.
 */
export async function setMailAutoTriage(userId: string, on: boolean): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data: ucet } = await supabase
    .from("mail_accounts")
    .select("ai_consent_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!ucet) return { ok: false, message: "Schránka není připojená." };
  if (on && !ucet.ai_consent_at) return { ok: false, message: "Nejdřív zapni pomoc AI s e-mailem." };

  const { error } = await supabase
    .from("mail_accounts")
    .update({ ai_auto_at: on ? new Date().toISOString() : null })
    .eq("user_id", userId);
  if (error) return { ok: false, message: error.message };

  if (!on) await vymazTrideni(userId);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Zapnutí nebo vypnutí čtení příloh. Zvláštní souhlas: v přílohách bývají
 * faktury a smlouvy, tedy citlivější věci než v textu zprávy. Platí jen pro
 * zprávu, u které člověk klikne — automatické třídění přílohy nečte nikdy.
 * Nic se neukládá, takže vypnutím není co mazat.
 */
export async function setMailFiles(userId: string, on: boolean): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data: ucet } = await supabase
    .from("mail_accounts")
    .select("ai_consent_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!ucet) return { ok: false, message: "Schránka není připojená." };
  if (on && !ucet.ai_consent_at) return { ok: false, message: "Nejdřív zapni pomoc AI s e-mailem." };

  const { error } = await supabase
    .from("mail_accounts")
    .update({ ai_files_at: on ? new Date().toISOString() : null })
    .eq("user_id", userId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

export type MailLabelsResult = { ok: true; labels: MailLabel[] } | { ok: false; message: string };

/**
 * Štítky, které má majitel schránky v Gmailu — pro výběr v nastavení. Čte se
 * jen jejich seznam (jména), žádná pošta, a neukládá se.
 */
export async function listGmailLabels(userId: string): Promise<MailLabelsResult> {
  const supabase = await supabaseServer();
  const { data: ucet } = await supabase.from("mail_accounts").select("token_enc").eq("user_id", userId).maybeSingle();
  if (!ucet) return { ok: false, message: "Schránka není připojená." };

  try {
    const accessToken = await accessTokenFrom(decryptToken(ucet.token_enc as string, klicProSifrovani()));
    return { ok: true, labels: await fetchLabels(accessToken) };
  } catch (e) {
    return { ok: false, message: chybaText(e) };
  }
}

/**
 * Uložení výběru štítků, ze kterých se pošta načítá navíc k doručené.
 * Z prohlížeče přijdou jen identifikátory; jména a to, že štítek opravdu
 * existuje, se bere z Gmailu. Ukládá se jen vybrané, ne celý seznam štítků.
 */
export async function setMailLabels(userId: string, ids: unknown): Promise<MailLabelsResult> {
  const dostupne = await listGmailLabels(userId);
  if (!dostupne.ok) return dostupne;

  const labels = pickLabels(ids, dostupne.labels);
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("mail_accounts").update({ labels }).eq("user_id", userId).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "Schránka není připojená." };

  revalidatePath("/", "layout");
  return { ok: true, labels };
}

/**
 * Zapnutí nebo vypnutí ranního načítání pošty. Appka pak čte Gmail sama,
 * i když ji člověk nemá otevřenou — proto se to zapíná zvlášť. Čte se totéž
 * co při „Obnovit“ a jen ve dny z `mail-schedule.ts`.
 */
export async function setMailAutoSync(userId: string, on: boolean): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("mail_accounts")
    .update({ auto_sync_at: on ? new Date().toISOString() : null })
    .eq("user_id", userId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "Schránka není připojená." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Jméno, kterým appka podepisuje návrh odpovědi — jméno z profilu. */
export async function loadSignature(userId: string): Promise<string | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return (data?.full_name as string | null) ?? null;
}

/**
 * Změna jména pro podpis. Je to jméno v profilu, takže se pod ním člověk
 * ukazuje i kolegům v Týmu — při registraci se do něj dosadí začátek
 * e-mailové adresy a jinde v appce se změnit nedá.
 */
export async function setSignature(userId: string, name: unknown): Promise<ActionResult> {
  const jmeno = cleanSignature(name);
  if (!jmeno) {
    return { ok: false, message: `Napiš jméno, kterým se chceš podepisovat — 2 až ${SIGNATURE_MAX} znaků, bez adresy a odkazu.` };
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("profiles").update({ full_name: jmeno }).eq("id", userId).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "Jméno se nepodařilo uložit." };

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
  prilohy: MailFiles;
};

/** Přílohy připravené pro AI a co o nich říct člověku. Nic z toho se neukládá. */
type MailFiles = {
  /** Soubory, které AI dostane za e-mailem. */
  files: AiFile[];
  /** Jejich jména, ve stejném pořadí — do zadání. */
  names: string[];
  /** Které přílohy AI četla a které ne — pro člověka, který návrh kontroluje. */
  notes: string[];
};

/**
 * Přílohy jedné zprávy pro AI. Bez zvláštního souhlasu (`allowed`) se
 * z Gmailu nestáhne nic a vrátí se jen věta, že AI přílohy nečte.
 *
 * Stahují se jen PDF a obrázky do stropu na počet a velikost. U každého
 * souboru se podle prvních bajtů ověří, že je tím, za co se vydává, a spočítá
 * se, kolik by stál — co je moc dlouhé, k AI nejde. Když se některý soubor
 * nepovede, zbytek pokračuje bez něj a člověk se to dozví.
 */
async function nactiPrilohy(
  accessToken: string,
  gmailId: string,
  prilohy: MailAttachment[],
  allowed: boolean,
): Promise<MailFiles> {
  const total = prilohy.length;
  const readable = prilohy.some((p) => expectedMime(p) !== null);
  if (!allowed || total === 0) {
    return { files: [], names: [], notes: fileNotes({ total, allowed, readable, read: [], skipped: [] }) };
  }

  const plan = planFiles(prilohy);
  const skipped: SkippedFile[] = [...plan.skipped];

  type Stazena =
    | { name: string; reason: SkipReason }
    | { name: string; tokens: number; soubor: { mimeType: string; data: string } };

  const stazene = await Promise.all(
    plan.take.map(async (p): Promise<Stazena> => {
      try {
        const data =
          p.file.data ?? (p.file.attachmentId ? await fetchAttachment(accessToken, gmailId, p.file.attachmentId) : "");
        const bytes = Buffer.from(data, "base64url");
        const check = checkBytes(bytes);
        if ("reason" in check) return { name: p.name, reason: check.reason };

        const soubor = { mimeType: check.mime, data: bytes.toString("base64") };
        return { name: p.name, soubor, tokens: await countFileTokens({ label: "", ...soubor }) };
      } catch (e) {
        // Do záznamu jen druh chyby — nikdy jméno souboru ani nic z obsahu.
        console.error("Příloha se nenačetla:", e instanceof Error ? e.name : typeof e);
        return { name: p.name, reason: "failed" };
      }
    }),
  );

  const kPocitani: Extract<Stazena, { tokens: number }>[] = [];
  for (const s of stazene) {
    if ("reason" in s) skipped.push({ name: s.name, reason: s.reason });
    else kPocitani.push(s);
  }

  const { keep, skipped: dlouhe } = fitBudget(kPocitani);
  skipped.push(...dlouhe);

  return {
    files: keep.map((k, i) => ({ label: `Příloha ${i + 1} („${k.name}“):`, ...k.soubor })),
    names: keep.map((k) => k.name),
    notes: fileNotes({ total, allowed, readable, read: keep.map((k) => k.name), skipped }),
  };
}

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
    supabase.from("mail_accounts").select("token_enc, ai_consent_at, ai_files_at").eq("user_id", userId).maybeSingle(),
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
  let prilohy: MailFiles;
  try {
    const accessToken = await accessTokenFrom(decryptToken(ucet.token_enc as string, klicProSifrovani()));
    telo = prepareBody(await fetchMessage(accessToken, zprava.gmail_id as string), zprava.subject as string | null);
    // Přílohy jen se zvláštním souhlasem — bez něj se z Gmailu nestahují vůbec.
    prilohy = await nactiPrilohy(accessToken, zprava.gmail_id as string, telo.files, Boolean(ucet.ai_files_at));
  } catch (e) {
    if (e instanceof GmailError && e.status === 404) {
      return { ok: false, message: "Zpráva už v Gmailu není. Klikni na Obnovit." };
    }
    return { ok: false, message: chybaText(e) };
  }

  // Zpráva bez textu má smysl jen tehdy, když AI dostane aspoň přílohu.
  if (!telo.text && prilohy.files.length === 0) {
    if (telo.attachments === 0) return { ok: false, message: "E-mail nemá žádný text, který by šel přečíst." };
    if (ucet.ai_files_at) {
      return { ok: false, message: `E-mail nemá žádný text a z příloh AI nic přečíst nemohla. ${prilohy.notes.join(" ")}` };
    }
    const sloByTo = telo.files.some((p) => expectedMime(p) !== null);
    return {
      ok: false,
      message: `E-mail nemá žádný text, jen přílohy — a ty AI nečte.${sloByTo ? " Čtení PDF a obrázků se zapíná v nastavení pošty." : ""}`,
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
    prilohy,
  };
}

/**
 * Jak volat AI, když má číst i přílohy.
 *
 * Návrh úkolu a poptávky jinak běží na lehkém modelu. S přílohami ne: pokyn
 * schovaný v PDF si lehký model v měření nechal vnutit pokaždé (do poptávky
 * dosadil podvržený telefon, 6 ze 6), větší ani jednou (0 z 16, 3. 10. 2026).
 * Přemýšlení k tomu nepotřeboval, tak se neplatí.
 */
function sPrilohami(prilohy: MailFiles, closing: string | null): ExtractOptions {
  if (prilohy.files.length === 0) return {};
  return { careful: true, thinkingBudget: 0, files: prilohy.files, closing };
}

/** Známou chybu AI řekne přesně, neznámou obecně. `rada` je, co zkusit místo toho. */
function aiSelhala(e: unknown, co: string, rada: string): AiFail {
  const known = knownAiError(e);
  // Do záznamu jen druh chyby — nikdy nic, co by mohlo nést obsah e-mailu.
  if (!known) console.error(`${co} selhal:`, e instanceof Error ? e.name : typeof e);
  return { ok: false, message: known ?? `AI se nepodařilo e-mail zpracovat. ${rada}` };
}

/** Co AI neviděla — ať se podle toho člověk při kontrole zařídí. */
function coNevidela(telo: PreparedBody, prilohy: MailFiles): string[] {
  const out: string[] = [];
  if (telo.truncated) out.push("E-mail je dlouhý, AI četla jen jeho začátek.");
  out.push(...prilohy.notes);
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

  const { system, prompt, closing } = buildMailPrompt(
    {
      fromName: z.fromName,
      fromEmail: z.fromEmail,
      subject: z.subject,
      sentOn: dateKeyPrague(z.receivedAt),
      body: z.telo.text,
      truncated: z.telo.truncated,
      attachments: z.telo.attachments,
      files: z.prilohy.names,
      clientName: klient?.name ?? null,
    },
    ctx,
  );

  try {
    const raw = await extractJson(
      "gemini",
      system,
      prompt,
      CAPTURE_JSON_SCHEMA as unknown as Record<string, unknown>,
      sPrilohami(z.prilohy, closing),
    );
    const navrh = normalizeProposals(raw, ctx, { quietUnknownClient: Boolean(klient) });
    return {
      ok: true,
      ...finishMailProposals(navrh, {
        today: ctx.today,
        defaultClientId: klient?.id ?? null,
        truncated: z.telo.truncated,
        fileNotes: z.prilohy.notes,
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

  const podpis = await loadSignature(userId);
  const pokyn = typeof hint === "string" ? hint : "";

  const { system, prompt, closing } = buildReplyPrompt({
    today: todayKeyPrague(),
    fromName: z.fromName,
    fromEmail: z.fromEmail,
    subject: z.subject,
    sentOn: dateKeyPrague(z.receivedAt),
    body: z.telo.text,
    truncated: z.telo.truncated,
    attachments: z.telo.attachments,
    files: z.prilohy.names,
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
      files: z.prilohy.files,
      closing,
    });
    const slozeno = assembleReply(raw, podpis);
    if (!slozeno) return { ok: false, message: "AI nevrátila žádný text. Zkus to znovu." };
    return {
      ok: true,
      reply: slozeno.text,
      missing: missingParts(slozeno.text),
      risk: riskyWarning(riskyParts(slozeno.text, pokyn)),
      numbers: unverifiedNumbers(slozeno.text, pokyn),
      warnings: coNevidela(z.telo, z.prilohy),
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
  const { system, prompt, closing } = buildLeadPrompt(
    {
      fromName: z.fromName,
      fromEmail: z.fromEmail,
      subject: z.subject,
      sentOn: dateKeyPrague(z.receivedAt),
      body: z.telo.text,
      truncated: z.telo.truncated,
      attachments: z.telo.attachments,
      files: z.prilohy.names,
    },
    today,
  );

  try {
    const raw = await extractJson(
      "gemini",
      system,
      prompt,
      LEAD_JSON_SCHEMA as unknown as Record<string, unknown>,
      sPrilohami(z.prilohy, closing),
    );
    const { draft, warnings } = finishLeadDraft(raw, {
      today,
      sender: { name: z.fromName, email: z.fromEmail },
      subject: z.subject,
      truncated: z.telo.truncated,
      fileNotes: z.prilohy.notes,
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
