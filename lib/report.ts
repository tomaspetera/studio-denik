import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import { writeProse, streamProse, availableProviders, type Provider } from "./ai";
import {
  BALL_LABEL,
  csRange,
  isoWeek,
  shareByCategory,
  weekRange,
  type Ball,
} from "./domain";

/* ================================================================== */
/* Podklady                                                            */
/* ================================================================== */

export type ReportItem = {
  title: string;
  clientName: string | null;
  categoryName: string | null;
  supplierName: string | null;
  ball: Ball;
  stepName: string;
  size: number;
  isLate: boolean;
  dueAt: string | null;
};

export type ReportData = {
  starts: Date;
  ends: Date;
  label: string;
  rangeText: string;
  /** Uzavřené v období — to, co jde do „co se udělalo“. */
  done: ReportItem[];
  /** Otevřené — to, co jde do „čeká se na“. */
  open: ReportItem[];
  counts: { done: number; me: number; client: number; supplier: number; late: number };
  byCategory: { category: string; percent: number; count: number }[];
  byClient: { client: string; items: ReportItem[]; percent: number }[];
};

type ViewRow = {
  title: string;
  client_name: string | null;
  supplier_name: string | null;
  ball: Ball;
  step_name: string;
  size: number;
  is_late: boolean;
  due_at: string | null;
  closed_at: string | null;
  category_id: string | null;
};

export async function collectReport(orgId: string, anchor = new Date()): Promise<ReportData> {
  const supabase = await supabaseServer();
  const { start, end } = weekRange(anchor);

  const [{ data: rows }, { data: cats }] = await Promise.all([
    supabase
      .from("tasks_view")
      .select(
        "title,client_name,supplier_name,ball,step_name,size,is_late,due_at,closed_at,category_id",
      )
      .eq("org_id", orgId),
    supabase.from("categories").select("id, name").eq("org_id", orgId),
  ]);

  const catName = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));

  const all = ((rows ?? []) as unknown as ViewRow[]).map((r): ReportItem => ({
    title: r.title,
    clientName: r.client_name,
    categoryName: r.category_id ? catName.get(r.category_id) ?? null : null,
    supplierName: r.supplier_name,
    ball: r.ball,
    stepName: r.step_name,
    size: r.size,
    isLate: r.is_late,
    dueAt: r.due_at,
  }));

  // Uzavřené počítáme podle razítka `closed_at`, ne podle stavu — úkol
  // uzavřený minulý měsíc nepatří do tohohle týdne.
  const closedInRange = ((rows ?? []) as unknown as ViewRow[])
    .map((r, i) => ({ r, item: all[i] }))
    .filter(({ r }) => {
      if (!r.closed_at) return false;
      const t = new Date(r.closed_at).getTime();
      return t >= start.getTime() && t <= end.getTime();
    })
    .map(({ item }) => item);

  const open = all.filter((t) => t.ball !== "done");

  const byCategory = shareByCategory(
    closedInRange.map((t) => ({ category: t.categoryName ?? "Nezařazeno", size: t.size })),
  );

  // Rozpad po klientech — příjemce reportu čte právě tohle.
  const clientGroups = new Map<string, ReportItem[]>();
  for (const t of [...closedInRange, ...open]) {
    const key = t.clientName ?? "Interní a provozní";
    clientGroups.set(key, [...(clientGroups.get(key) ?? []), t]);
  }
  const clientShares = shareByCategory(
    [...clientGroups.entries()].flatMap(([client, items]) =>
      items.map((t) => ({ category: client, size: t.size })),
    ),
  );
  const byClient = [...clientGroups.entries()]
    .map(([client, items]) => ({
      client,
      items,
      percent: clientShares.find((s) => s.category === client)?.percent ?? 0,
    }))
    .sort((a, b) => b.percent - a.percent);

  return {
    starts: start,
    ends: end,
    label: isoWeek(start).label,
    rangeText: csRange(start, end),
    done: closedInRange,
    open,
    counts: {
      done: closedInRange.length,
      me: open.filter((t) => t.ball === "me").length,
      client: open.filter((t) => t.ball === "client").length,
      supplier: open.filter((t) => t.ball === "supplier").length,
      late: open.filter((t) => t.isLate).length,
    },
    byCategory,
    byClient,
  };
}

/* ================================================================== */
/* Generování textu                                                    */
/* ================================================================== */

const SYSTEM = `Píšeš týdenní report grafického studia pro nadřízeného nebo klienta.

Píšeš česky, věcně a bez vaty. Žádné oslovení, žádný závěrečný pozdrav — text
se vkládá do hotového dokumentu, který hlavičku i patičku už má.

Dva až tři odstavce. První shrne, čím byl týden tažený a kde leželo těžiště
práce. Druhý pokryje zbytek, typicky administrativu a komunikaci. Pokud něco
uvázlo na cizí straně, patří to do posledního odstavce a musí být zřejmé, že
to není zdržení na naší straně.

Vycházej jen z dodaných dat. Nic si nedomýšlej, nepřidávej čísla, která
v podkladech nejsou, a nepiš marketingové fráze o skvělé spolupráci.`;

function buildPrompt(data: ReportData): string {
  const lines: string[] = [];

  lines.push(`Období: ${data.rangeText}`);
  lines.push(
    `Čísla: ${data.counts.done} uzavřeno, ${data.counts.me} rozpracováno, ` +
      `${data.counts.client} čeká na klienta, ${data.counts.supplier} u dodavatele, ` +
      `${data.counts.late} po termínu.`,
  );

  if (data.byCategory.length) {
    lines.push(
      "\nRozdělení práce: " +
        data.byCategory.map((c) => `${c.category} ${c.percent} %`).join(", "),
    );
  }

  lines.push("\nUzavřeno v období:");
  if (data.done.length === 0) {
    lines.push("  (nic)");
  } else {
    for (const t of data.done) {
      lines.push(`  - ${t.title}${t.clientName ? ` [${t.clientName}]` : ""}`);
    }
  }

  const waiting = data.open.filter((t) => t.ball === "client" || t.ball === "supplier");
  if (waiting.length) {
    lines.push("\nČeká se na cizí straně:");
    for (const t of waiting) {
      lines.push(
        `  - ${t.title}${t.clientName ? ` [${t.clientName}]` : ""} — ${BALL_LABEL[t.ball]}` +
          `${t.supplierName ? `, ${t.supplierName}` : ""}${t.isLate ? ", PO TERMÍNU" : ""}`,
      );
    }
  }

  const mine = data.open.filter((t) => t.ball === "me");
  if (mine.length) {
    lines.push("\nRozpracováno u nás:");
    for (const t of mine) {
      lines.push(`  - ${t.title}${t.clientName ? ` [${t.clientName}]` : ""} (${t.stepName})`);
    }
  }

  return lines.join("\n");
}

export type GenerateResult =
  | { ok: true; summary: string; provider: Provider }
  | { ok: false; message: string };

export async function generateSummary(
  orgId: string,
  provider?: Provider,
): Promise<GenerateResult> {
  const available = availableProviders();
  if (available.length === 0) {
    return {
      ok: false,
      message:
        "Není nastavený žádný AI klíč. Doplň ANTHROPIC_API_KEY nebo GEMINI_API_KEY do .env.local.",
    };
  }

  const chosen = provider && available.includes(provider) ? provider : available[0];
  const data = await collectReport(orgId);

  if (data.done.length === 0 && data.open.length === 0) {
    return { ok: false, message: "Za tohle období nejsou žádné úkoly, není z čeho psát." };
  }

  try {
    const summary = await writeProse(chosen, SYSTEM, buildPrompt(data));
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
): AsyncGenerator<string> {
  const available = availableProviders();
  if (available.length === 0) {
    throw new Error(
      "Není nastavený žádný AI klíč. Doplň ANTHROPIC_API_KEY nebo GEMINI_API_KEY do .env.local.",
    );
  }

  const chosen = provider && available.includes(provider) ? provider : available[0];
  const data = await collectReport(orgId);

  if (data.done.length === 0 && data.open.length === 0) {
    throw new Error("Za tohle období nejsou žádné úkoly, není z čeho psát.");
  }

  let full = "";
  for await (const piece of streamProse(chosen, SYSTEM, buildPrompt(data))) {
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
};

export async function loadReport(orgId: string, anchor = new Date()): Promise<StoredReport | null> {
  const supabase = await supabaseServer();
  const { start } = weekRange(anchor);

  const { data } = await supabase
    .from("reports")
    .select(
      "id,label,starts_on,ends_on,ai_summary,edited_summary,status,share_token,share_until,model,recipient",
    )
    .eq("org_id", orgId)
    .eq("period", "week")
    .eq("starts_on", isoDate(start))
    .maybeSingle();

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

  // Původní text od AI nikdy nepřepisujeme přes ruční úpravy — díky tomu
  // jde přegenerovat, aniž by se ztratilo, co uživatel dopsal.
  await supabase.from("reports").upsert(
    {
      org_id: orgId,
      period: "week",
      starts_on: isoDate(data.starts),
      ends_on: isoDate(data.ends),
      label: data.label,
      ai_summary: summary,
      model: provider,
      created_by: user?.id ?? null,
    },
    { onConflict: "org_id,period,starts_on" },
  );
}

export async function saveEdit(reportId: string, text: string): Promise<void> {
  const supabase = await supabaseServer();
  await supabase
    .from("reports")
    .update({ edited_summary: text.trim() || null })
    .eq("id", reportId);
  revalidatePath("/report");
}

export async function publishReport(reportId: string, recipient: string): Promise<void> {
  const supabase = await supabaseServer();
  await supabase
    .from("reports")
    .update({
      status: "published",
      recipient: recipient.trim() || null,
      published_at: new Date().toISOString(),
    })
    .eq("id", reportId);
  revalidatePath("/report");
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
