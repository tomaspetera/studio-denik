import "server-only";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import { writeProse, streamProse, availableProviders, type Provider } from "./ai";
import { weekRange, type Ball } from "./domain";
import {
  REPORT_SYSTEM,
  aggregateReport,
  buildReportPrompt,
  type ReportClient,
  type ReportData,
  type ReportRow,
} from "./report-core";

export type { ReportClient, ReportData, ReportItem } from "./report-core";

/* ================================================================== */
/* Podklady                                                            */
/* ================================================================== */

/**
 * Podklady reportu za týden. S `client` jen úkoly toho jednoho klienta —
 * filtruje se už v dotazu (ať se zbytečně nenačítá cizí práce) a pro jistotu
 * ještě jednou v `aggregateReport`.
 */
export async function collectReport(
  orgId: string,
  anchor = new Date(),
  client: ReportClient | null = null,
): Promise<ReportData> {
  const supabase = await supabaseServer();
  const range = weekRange(anchor);

  let dotaz = supabase
    .from("tasks_view")
    .select("title,client_id,client_name,supplier_name,ball,step_name,size,is_late,due_at,closed_at,category_id")
    .eq("org_id", orgId);
  if (client) dotaz = dotaz.eq("client_id", client.id);

  const [{ data: rows }, { data: cats }] = await Promise.all([
    dotaz,
    supabase.from("categories").select("id, name").eq("org_id", orgId),
  ]);

  const catName = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));
  return aggregateReport((rows ?? []) as unknown as ReportRow[], catName, range, client);
}

/**
 * Klient pro zúžený report — jen když do organizace opravdu patří. Cizí nebo
 * vymyšlené `id` dá `null` a report se pak nezúží na nic, co uživatel nesmí vidět.
 */
export async function findReportClient(orgId: string, clientId: string | null | undefined): Promise<ReportClient | null> {
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return null;
  const supabase = await supabaseServer();
  const { data } = await supabase.from("clients").select("id, name").eq("org_id", orgId).eq("id", clientId).maybeSingle();
  return data ? { id: data.id as string, name: data.name as string } : null;
}

/* ================================================================== */
/* Generování textu                                                    */
/* ================================================================== */

export type GenerateResult =
  | { ok: true; summary: string; provider: Provider }
  | { ok: false; message: string };

const NO_KEY = "Není nastavený žádný AI klíč. Doplň ANTHROPIC_API_KEY nebo GEMINI_API_KEY do .env.local.";

function nothingToWrite(client: ReportClient | null): string {
  return client
    ? `Pro klienta ${client.name} tenhle týden nejsou žádné úkoly, není z čeho psát.`
    : "Za tohle období nejsou žádné úkoly, není z čeho psát.";
}

export async function generateSummary(
  orgId: string,
  provider?: Provider,
  client: ReportClient | null = null,
): Promise<GenerateResult> {
  const available = availableProviders();
  if (available.length === 0) return { ok: false, message: NO_KEY };

  const chosen = provider && available.includes(provider) ? provider : available[0];
  const data = await collectReport(orgId, new Date(), client);

  if (data.done.length === 0 && data.open.length === 0) {
    return { ok: false, message: nothingToWrite(client) };
  }

  try {
    const summary = await writeProse(chosen, REPORT_SYSTEM, buildReportPrompt(data));
    await saveSummary(orgId, data, summary, chosen);
    revalidatePath("/report");
    return { ok: true, summary, provider: chosen };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Streamovaná varianta. Vydává text po částech a teprve na konci ho uloží —
 * kdyby se stream přerušil, v databázi nezůstane půlka věty.
 */
export async function* streamSummary(
  orgId: string,
  provider?: Provider,
  client: ReportClient | null = null,
): AsyncGenerator<string> {
  const available = availableProviders();
  if (available.length === 0) throw new Error(NO_KEY);

  const chosen = provider && available.includes(provider) ? provider : available[0];
  const data = await collectReport(orgId, new Date(), client);

  if (data.done.length === 0 && data.open.length === 0) {
    throw new Error(nothingToWrite(client));
  }

  let full = "";
  for await (const piece of streamProse(chosen, REPORT_SYSTEM, buildReportPrompt(data))) {
    full += piece;
    yield piece;
  }

  if (full.trim()) {
    await saveSummary(orgId, data, full.trim(), chosen);
  }
}

/* ================================================================== */
/* Uložení a publikace                                                 */
/* ================================================================== */

export type StoredReport = {
  id: string;
  label: string | null;
  starts_on: string;
  ends_on: string;
  ai_summary: string | null;
  edited_summary: string | null;
  status: "draft" | "published";
  share_token: string;
  share_until: string;
  model: string | null;
  recipient: string | null;
  /** Klient, na kterého je report zúžený. `null` = celé studio. */
  client_id: string | null;
};

const STORED_COLUMNS =
  "id,label,starts_on,ends_on,ai_summary,edited_summary,status,share_token,share_until,model,recipient,client_id";

/**
 * Uložený report za týden. Za jeden týden jich může být víc: jeden za celé
 * studio (`clientId` = `null`) a k němu nejvýš jeden na každého klienta.
 * Každý má vlastní text, vlastní stav a vlastní sdílený odkaz.
 */
export async function loadReport(
  orgId: string,
  anchor = new Date(),
  clientId: string | null = null,
): Promise<StoredReport | null> {
  const supabase = await supabaseServer();
  const { start } = weekRange(anchor);

  const dotaz = supabase
    .from("reports")
    .select(STORED_COLUMNS)
    .eq("org_id", orgId)
    .eq("period", "week")
    .eq("starts_on", isoDate(start));

  const { data } = await (clientId ? dotaz.eq("client_id", clientId) : dotaz.is("client_id", null)).maybeSingle();
  return (data as StoredReport | null) ?? null;
}

async function saveSummary(
  orgId: string,
  data: ReportData,
  summary: string,
  provider: Provider,
): Promise<void> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const clientId = data.client?.id ?? null;

  // Původní text od AI nikdy nepřepisujeme přes ruční úpravy — díky tomu
  // jde přegenerovat, aniž by se ztratilo, co uživatel dopsal.
  const obsah = {
    ends_on: isoDate(data.ends),
    label: data.label,
    ai_summary: summary,
    model: provider,
  };

  // Najít a upravit, jinak založit. Jedinečnost hlídají v databázi dva
  // částečné indexy (za studio / za klienta) a ty se v jednom příkazu
  // „vlož, nebo uprav“ použít nedají.
  const existing = await loadReport(orgId, data.starts, clientId);
  if (existing) {
    await supabase.from("reports").update(obsah).eq("id", existing.id);
    return;
  }

  const { error } = await supabase.from("reports").insert({
    org_id: orgId,
    period: "week",
    starts_on: isoDate(data.starts),
    client_id: clientId,
    created_by: user?.id ?? null,
    ...obsah,
  });

  // Dvě generování naráz: druhé narazí na jedinečnost — report už mezitím
  // vznikl, takže stačí ho upravit.
  if (error?.code === "23505") {
    const now = await loadReport(orgId, data.starts, clientId);
    if (now) await supabase.from("reports").update(obsah).eq("id", now.id);
  }
}

export async function saveEdit(reportId: string, text: string): Promise<void> {
  const supabase = await supabaseServer();
  await supabase
    .from("reports")
    .update({ edited_summary: text.trim() || null })
    .eq("id", reportId);
  revalidatePath("/report");
}

/** Zmrazená podoba reportu — to, co uvidí příjemce na sdíleném odkazu. */
export type ReportSnapshot = {
  rangeText: string;
  /** Jméno klienta, pro kterého report je. Chybí u reportu za celé studio. */
  scopeClient?: string | null;
  counts: ReportData["counts"];
  byCategory: ReportData["byCategory"];
  byClient: {
    client: string;
    percent: number;
    items: { title: string; ball: Ball; stepName: string; supplierName: string | null; isLate: boolean }[];
  }[];
  waiting: {
    title: string;
    clientName: string | null;
    supplierName: string | null;
    ball: Ball;
    isLate: boolean;
  }[];
};

/**
 * Publikace reportu.
 *
 * Kromě přepnutí stavu uloží i snímek čísel a rozpadů. Bez něj by se
 * dokument, který příjemce dostal, měnil pokaždé, když se v aplikaci
 * posune nebo smaže úkol — a to u vystaveného reportu nesmí.
 *
 * Snímek se skládá podle toho, na koho je report zúžený: report pro klienta
 * nesmí při publikaci „prosáknout“ práci pro ostatní.
 */
export async function publishReport(
  orgId: string,
  reportId: string,
  recipient: string,
): Promise<void> {
  const supabase = await supabaseServer();

  const { data: report } = await supabase
    .from("reports")
    .select("client_id")
    .eq("id", reportId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!report) return;

  const clientId = report.client_id as string | null;
  const client = await findReportClient(orgId, clientId);
  // Report je zúžený na klienta, který už neexistuje — raději nepublikovat
  // nic než omylem report za celé studio.
  if (clientId && !client) return;

  const data = await collectReport(orgId, new Date(), client);

  const snapshot: ReportSnapshot = {
    rangeText: data.rangeText,
    scopeClient: client?.name ?? null,
    counts: data.counts,
    byCategory: data.byCategory,
    byClient: data.byClient.map((g) => ({
      client: g.client,
      percent: g.percent,
      items: g.items.map((t) => ({
        title: t.title,
        ball: t.ball,
        stepName: t.stepName,
        supplierName: t.supplierName,
        isLate: t.isLate,
      })),
    })),
    waiting: data.open
      .filter((t) => t.ball === "client" || t.ball === "supplier")
      .map((t) => ({
        title: t.title,
        clientName: t.clientName,
        supplierName: t.supplierName,
        ball: t.ball,
        isLate: t.isLate,
      })),
  };

  await supabase
    .from("reports")
    .update({
      status: "published",
      recipient: recipient.trim() || null,
      published_at: new Date().toISOString(),
      snapshot,
    })
    .eq("id", reportId);

  revalidatePath("/report");
}

/* ================================================================== */
/* Veřejné čtení přes odkaz                                            */
/* ================================================================== */

export type PublicReport = {
  label: string | null;
  starts_on: string;
  ends_on: string;
  summary: string | null;
  outlook: string | null;
  recipient: string | null;
  org_name: string;
  sender: string | null;
  sender_mail: string | null;
  published_at: string | null;
  snapshot: ReportSnapshot | null;
};

/**
 * Načte report podle tokenu z odkazu.
 *
 * Podmínky (platný token, publikovaný stav, nevypršelá platnost) kontroluje
 * funkce v databázi, ne tenhle kód — jinak by je šlo obejít jiným dotazem.
 */
// `cache`: titulek záložky i obsah stránky se ptají zvlášť, dotaz ale stačí jeden.
export const loadPublicReport = cache(async (token: string): Promise<PublicReport | null> => {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("public_report", { p_token: token });
  if (error || !data) return null;
  return data as PublicReport;
});

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
