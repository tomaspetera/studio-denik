import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import { stepCount, todayKeyPrague } from "./domain";
import {
  AiBadResponse,
  AiNotConfigured,
  AiOverloaded,
  AiQuotaExceeded,
  AiRefused,
  extractJson,
  pickProvider,
} from "./ai";
import {
  CAPTURE_JSON_SCHEMA,
  CAPTURE_MAX_CHARS,
  buildCapturePrompt,
  normalizeProposals,
  sanitizeProposals,
  type CaptureResult,
} from "./capture";
import { listCategories, listClients } from "./tasks";

export type ProposeResult = ({ ok: true } & CaptureResult) | { ok: false; message: string };
export type CreateResult = { ok: true; created: number } | { ok: false; message: string };

/** Česká hláška pro člověka — vnitřní detaily chyby do prohlížeče nepatří. */
function aiErrorMessage(e: unknown): string {
  if (
    e instanceof AiNotConfigured ||
    e instanceof AiQuotaExceeded ||
    e instanceof AiOverloaded ||
    e instanceof AiBadResponse
  ) {
    return e.message;
  }
  if (e instanceof AiRefused) return "Model odmítl tenhle text zpracovat.";
  console.error("Rychlý zápis selhal:", e);
  return "Nepodařilo se to zpracovat. Zkus to znovu, text ti zůstal v poli.";
}

/**
 * Text → návrh úkolů. Nic nezakládá — jen čte klienty a kategorie, aby AI
 * věděla, ze kterých smí vybírat, a vrací to, co z textu vyčetla.
 */
export async function proposeTasks(orgId: string, rawText: string): Promise<ProposeResult> {
  const text = rawText.trim();
  if (!text) return { ok: false, message: "Napiš nebo vlož text." };
  if (text.length > CAPTURE_MAX_CHARS) {
    return { ok: false, message: `Text je moc dlouhý, nejvýš ${CAPTURE_MAX_CHARS} znaků.` };
  }

  const provider = pickProvider();
  if (!provider) {
    return { ok: false, message: "Chybí klíč AI. Doplň GEMINI_API_KEY (nebo ANTHROPIC_API_KEY) na Vercelu." };
  }

  const [clients, categories] = await Promise.all([listClients(orgId), listCategories(orgId)]);
  const ctx = {
    today: todayKeyPrague(),
    clients: clients.map((c) => ({ id: c.id, name: c.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
  };

  const { system, prompt } = buildCapturePrompt(text, ctx);
  try {
    const raw = await extractJson(provider, system, prompt, CAPTURE_JSON_SCHEMA as unknown as Record<string, unknown>);
    return { ok: true, ...normalizeProposals(raw, ctx) };
  } catch (e) {
    return { ok: false, message: aiErrorMessage(e) };
  }
}

/**
 * Založení potvrzených návrhů jedním zápisem — všechno, nebo nic, ať po
 * chybě nezůstane polovina úkolů a druhé kliknutí nevyrobí duplicity.
 *
 * Úkol založený rovnou jako hotový dostane `closed_at` sám: razítko dává
 * spouštěč jen při úpravě a report počítá uzavřené právě podle něj, takže
 * bez razítka by hotová práce v reportu chyběla. Poledne UTC drží den
 * dokončení stejný v Praze i v UTC.
 */
export async function createProposedTasks(orgId: string, input: unknown): Promise<CreateResult> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const [clients, categories] = await Promise.all([listClients(orgId), listCategories(orgId)]);
  const today = todayKeyPrague();
  const check = sanitizeProposals(input, {
    today,
    clientIds: new Set(clients.map((c) => c.id)),
    categoryIds: new Set(categories.map((c) => c.id)),
  });
  if (!check.ok) return check;

  const rows = check.items.map((p) => ({
    org_id: orgId,
    title: p.title,
    kind: p.kind,
    step: p.step,
    size: p.size,
    client_id: p.clientId,
    category_id: p.categoryId,
    due_at: p.dueKey ? `${p.dueKey}T00:00:00.000Z` : null,
    note: p.note,
    created_by: user?.id ?? null,
    assignee_id: user?.id ?? null,
    closed_at: p.step === stepCount(p.kind) - 1 ? `${p.doneOn ?? today}T12:00:00.000Z` : null,
  }));

  const { error } = await supabase.from("tasks").insert(rows);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true, created: rows.length };
}
