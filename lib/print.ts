import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import type { Ball } from "./domain";

/**
 * Tisková zakázka. Vzniká vždy k úkolu typu „tisk“ — proto se řádek zakládá
 * líně, až když o něj někdo poprvé stojí, a ne při každém zápisu úkolu.
 */
export type PrintJob = {
  taskId: string;
  jobId: string | null;
  title: string;
  clientName: string | null;
  clientColor: string | null;
  supplierName: string | null;
  ball: Ball;
  stepName: string;
  step: number;
  code: string | null;
  spec: string | null;
  quantity: number | null;
  approvedAt: string | null;
  sentAt: string | null;
  promisedAt: string | null;
  deliveredAt: string | null;
  handedAt: string | null;
  lastNudgeAt: string | null;
  /** Kladné = zbývá dní, záporné = dní po termínu, null = termín není. */
  daysLeft: number | null;
};

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function listPrintJobs(orgId: string): Promise<PrintJob[]> {
  const supabase = await supabaseServer();

  const [{ data: tasks }, { data: jobs }] = await Promise.all([
    supabase
      .from("tasks_view")
      .select("id,title,client_name,client_color,supplier_name,ball,step,step_name")
      .eq("org_id", orgId)
      .eq("kind", "tisk"),
    supabase
      .from("print_jobs")
      .select(
        "id,task_id,code,spec,quantity,approved_at,sent_at,promised_at,delivered_at,handed_at,last_nudge_at",
      )
      .eq("org_id", orgId),
  ]);

  const byTask = new Map(
    (jobs ?? []).map((j) => [j.task_id as string, j]),
  );

  return ((tasks ?? []) as unknown as {
    id: string; title: string; client_name: string | null; client_color: string | null;
    supplier_name: string | null; ball: Ball; step: number; step_name: string;
  }[]).map((t) => {
    const j = byTask.get(t.id);
    const promised = (j?.promised_at as string | null) ?? null;

    return {
      taskId: t.id,
      jobId: (j?.id as string) ?? null,
      title: t.title,
      clientName: t.client_name,
      clientColor: t.client_color,
      supplierName: t.supplier_name,
      ball: t.ball,
      stepName: t.step_name,
      step: t.step,
      code: (j?.code as string | null) ?? null,
      spec: (j?.spec as string | null) ?? null,
      quantity: (j?.quantity as number | null) ?? null,
      approvedAt: (j?.approved_at as string | null) ?? null,
      sentAt: (j?.sent_at as string | null) ?? null,
      promisedAt: promised,
      deliveredAt: (j?.delivered_at as string | null) ?? null,
      handedAt: (j?.handed_at as string | null) ?? null,
      lastNudgeAt: (j?.last_nudge_at as string | null) ?? null,
      daysLeft: daysUntil(promised, (j?.delivered_at as string | null) ?? null),
    };
  }).sort(sortByUrgency);
}

/** Nejnaléhavější nahoru: po termínu, pak nejbližší termín, pak zbytek. */
function sortByUrgency(a: PrintJob, b: PrintJob): number {
  const rank = (j: PrintJob) =>
    j.ball === "done" ? 3 : j.daysLeft === null ? 2 : j.daysLeft < 0 ? 0 : 1;
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a.daysLeft !== null && b.daysLeft !== null) return a.daysLeft - b.daysLeft;
  return a.title.localeCompare(b.title, "cs");
}

function daysUntil(promised: string | null, delivered: string | null): number | null {
  if (!promised || delivered) return null;
  const day = 86_400_000;
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(new Date(promised)) - midnight(new Date())) / day);
}

/* ================================================================== */
/* Zápis                                                               */
/* ================================================================== */

/**
 * Vrátí id zakázky k úkolu; když ještě neexistuje, založí ji.
 * Díky jednoznačnému indexu na `task_id` nemůže vzniknout dvakrát.
 */
async function ensureJob(orgId: string, taskId: string): Promise<string | null> {
  const supabase = await supabaseServer();

  const { data: found } = await supabase
    .from("print_jobs")
    .select("id")
    .eq("task_id", taskId)
    .maybeSingle();

  if (found) return found.id as string;

  const { data: created, error } = await supabase
    .from("print_jobs")
    .insert({ org_id: orgId, task_id: taskId })
    .select("id")
    .single();

  return error ? null : (created.id as string);
}

export async function savePrintDetails(
  orgId: string,
  taskId: string,
  fields: {
    code?: string | null;
    spec?: string | null;
    quantity?: number | null;
    sentAt?: string | null;
    promisedAt?: string | null;
  },
): Promise<ActionResult> {
  const jobId = await ensureJob(orgId, taskId);
  if (!jobId) return { ok: false, message: "Zakázku se nepodařilo založit." };

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("print_jobs")
    .update({
      code: fields.code?.trim() || null,
      spec: fields.spec?.trim() || null,
      quantity: fields.quantity ?? null,
      sent_at: fields.sentAt || null,
      promised_at: fields.promisedAt || null,
    })
    .eq("id", jobId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Potvrzení dodání. Razítkuje zakázku a zároveň posune úkol na krok
 * „Dodáno“ — jinak by aplikace tvrdila, že se pořád čeká na tiskárnu.
 */
export async function confirmDelivery(orgId: string, taskId: string): Promise<ActionResult> {
  const jobId = await ensureJob(orgId, taskId);
  if (!jobId) return { ok: false, message: "Zakázku se nepodařilo založit." };

  const supabase = await supabaseServer();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("print_jobs")
    .update({ delivered_at: now })
    .eq("id", jobId);
  if (error) return { ok: false, message: error.message };

  // Krok 4 = „Dodáno“ v tiskovém průchodu.
  await supabase.from("tasks").update({ step: 4 }).eq("id", taskId);

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Zápis urgence — v reportu pak doloží, že se čekání řešilo. */
export async function logNudge(orgId: string, taskId: string): Promise<ActionResult> {
  const jobId = await ensureJob(orgId, taskId);
  if (!jobId) return { ok: false, message: "Zakázku se nepodařilo založit." };

  const supabase = await supabaseServer();
  const now = new Date().toISOString();

  await supabase.from("print_jobs").update({ last_nudge_at: now }).eq("id", jobId);

  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("task_events").insert({
    org_id: orgId,
    task_id: taskId,
    actor_id: user?.id ?? null,
    kind: "nudge",
    detail: "Urgováno u dodavatele",
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
