import type { DateKey, LeadStatus } from "./domain";

/**
 * Co chce pozornost — čistá funkce bez databáze a bez závislostí na zbytku
 * appky, aby šla otestovat sama a aby Dnes i ranní push počítaly totéž.
 *
 * Každý klient i poptávka spadne nejvýš do jedné skupiny, takže nic
 * neblikne dvakrát:
 *
 * - `step_overdue`  — má další krok a jeho datum už uplynulo
 * - `lead_no_step`  — otevřená poptávka bez dalšího kroku (tiše vyhnívá)
 * - `client_silent` — klient bez otevřené práce, bez dalšího kroku a bez
 *                     aktivity déle než N dní
 *
 * Další krok v budoucnosti funguje jako odložení: klient s plánovaným
 * krokem "ozvat se v lednu" mlčí, dokud ten den nepřijde.
 */
export type AttentionKind = "step_overdue" | "lead_no_step" | "client_silent";

export type AttentionClient = {
  id: string;
  name: string;
  archived: boolean;
  nextStep: string | null;
  nextStepAt: DateKey | null;
  hasOpenTasks: boolean;
  /** Poslední aktivita — poznámka, uzavřený úkol, rozhodnutí klienta, nebo založení. */
  lastActivity: DateKey;
};

export type AttentionLead = {
  id: string;
  name: string;
  company: string | null;
  status: LeadStatus;
  nextStep: string | null;
  nextStepAt: DateKey | null;
  createdAt: DateKey;
};

export type AttentionInput = {
  today: DateKey;
  /** Poslední den, který se ještě počítá jako "ticho" (dnes minus N dní). */
  silentOnOrBefore: DateKey;
  clients: AttentionClient[];
  leads: AttentionLead[];
};

export type AttentionItem = {
  kind: AttentionKind;
  subject: "client" | "lead";
  id: string;
  name: string;
  /** Den, ke kterému se řádek vztahuje: termín kroku, vznik poptávky, poslední aktivita. */
  since: DateKey;
  /** Text dalšího kroku — jen u `step_overdue`. */
  step: string | null;
};

const KIND_ORDER: Record<AttentionKind, number> = {
  step_overdue: 0,
  lead_no_step: 1,
  client_silent: 2,
};

export function computeAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const lead of input.leads) {
    if (lead.status !== "poptavka" && lead.status !== "nabidka") continue;
    const name = lead.company?.trim() ? `${lead.name} · ${lead.company.trim()}` : lead.name;

    if (lead.nextStepAt) {
      if (lead.nextStepAt < input.today) {
        items.push({ kind: "step_overdue", subject: "lead", id: lead.id, name, since: lead.nextStepAt, step: lead.nextStep });
      }
    } else {
      items.push({ kind: "lead_no_step", subject: "lead", id: lead.id, name, since: lead.createdAt, step: null });
    }
  }

  for (const client of input.clients) {
    if (client.archived) continue;

    if (client.nextStepAt) {
      if (client.nextStepAt < input.today) {
        items.push({ kind: "step_overdue", subject: "client", id: client.id, name: client.name, since: client.nextStepAt, step: client.nextStep });
      }
    } else if (!client.hasOpenTasks && client.lastActivity <= input.silentOnOrBefore) {
      items.push({ kind: "client_silent", subject: "client", id: client.id, name: client.name, since: client.lastActivity, step: null });
    }
  }

  return items.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.since < b.since ? -1 : a.since > b.since ? 1 : 0) ||
      a.name.localeCompare(b.name, "cs"),
  );
}

/**
 * Do ranního pushe patří jen to, co si člověk sám slíbil nebo nechal
 * ležet — ticho u klienta je dobré vidět na Dnes, ale denní upozornění
 * na něj by se brzy stalo oznámením, které si každý ztiší.
 */
export function actionableCount(items: AttentionItem[]): number {
  return items.filter((i) => i.kind !== "client_silent").length;
}

/** "YYYY-MM-DD" a skutečné datum — `2026-02-31` projde regulárním výrazem, ale není to den. */
export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Krok a datum jdou spolu — obojí, nebo nic. Prázdný vstup znamená
 * "žádný krok", ne chybu: tak se krok maže.
 */
export function normalizeNextStep(
  step: string | null | undefined,
  at: string | null | undefined,
): { ok: true; step: string | null; at: DateKey | null } | { ok: false; message: string } {
  const s = step?.trim() || null;
  const a = at?.trim() || null;

  if (!s && !a) return { ok: true, step: null, at: null };
  if (!s) return { ok: false, message: "Datum dalšího kroku potřebuje i popis, co se má stát." };
  if (!a) return { ok: false, message: "Další krok potřebuje datum — bez něj by ho nebylo čím hlídat." };
  if (!isValidDateKey(a)) return { ok: false, message: "Datum dalšího kroku není platné." };
  return { ok: true, step: s, at: a };
}
