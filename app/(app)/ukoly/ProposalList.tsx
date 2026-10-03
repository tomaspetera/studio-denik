"use client";

import { FLOWS, stepCount, type DateKey, type TaskKind } from "@/lib/domain";
import type { Proposal } from "@/lib/capture";
import { NOTE_MAX } from "@/lib/capture-limits";
import type { Category, Client } from "@/lib/tasks";
import styles from "./tasks.module.css";

/** Návrh úkolu v okně: navíc ví, jestli je zaškrtnutý, a má stálý klíč řádku. */
export type ProposalRow = Proposal & { key: number; include: boolean };

export function toRows(proposals: Proposal[]): ProposalRow[] {
  return proposals.map((p, i) => ({ ...p, key: i, include: true }));
}

/** Zaškrtnuté řádky zpátky na návrhy — bez pomocných polí okna. */
export function chosenProposals(rows: ProposalRow[]): Proposal[] {
  return rows
    .filter((r) => r.include)
    .map((r) => ({
      title: r.title,
      kind: r.kind,
      step: r.step,
      clientId: r.clientId,
      categoryId: r.categoryId,
      dueKey: r.dueKey,
      doneOn: r.doneOn,
      size: r.size,
      note: r.note,
    }));
}

const KIND_OPTIONS: { key: TaskKind; label: string }[] = [
  { key: "interni", label: "Interní" },
  { key: "klient", label: "S klientem" },
  { key: "tisk", label: "Tiskový" },
];

/** Změna typu mění počet kroků — hotový zůstane hotový, otevřený se nikdy sám nedokončí. */
function withKind(row: ProposalRow, kind: TaskKind, today: DateKey): ProposalRow {
  const wasDone = row.step === stepCount(row.kind) - 1;
  const last = stepCount(kind) - 1;
  const step = wasDone ? last : Math.min(row.step, last - 1);
  return { ...row, kind, step, doneOn: step === last ? (row.doneOn ?? today) : null };
}

function withStep(row: ProposalRow, step: number, today: DateKey): ProposalRow {
  const done = step === stepCount(row.kind) - 1;
  return { ...row, step, doneOn: done ? (row.doneOn ?? today) : null };
}

/**
 * Seznam navržených úkolů k úpravě před založením. Společný pro rychlý zápis
 * i pro úkol z e-mailu: AI jen navrhuje, člověk každý řádek zkontroluje,
 * upraví nebo odškrtne.
 */
export default function ProposalList({
  rows,
  onChange,
  clients,
  categories,
  today,
}: {
  rows: ProposalRow[];
  onChange: (rows: ProposalRow[]) => void;
  clients: Client[];
  categories: Category[];
  /** Dnešek podle Prahy, počítaný na serveru. */
  today: DateKey;
}) {
  const patch = (key: number, change: (r: ProposalRow) => ProposalRow) =>
    onChange(rows.map((r) => (r.key === key ? change(r) : r)));

  return (
    <ul className={styles.capList}>
      {rows.map((r) => {
        const done = r.step === stepCount(r.kind) - 1;
        return (
          <li key={r.key} className={`${styles.capRow} ${r.include ? "" : styles.capOff}`}>
            <input
              type="checkbox"
              className={styles.capCheck}
              checked={r.include}
              onChange={(e) => patch(r.key, (x) => ({ ...x, include: e.target.checked }))}
              aria-label={`Založit: ${r.title}`}
            />
            <div className={styles.capBody}>
              <input
                className="field"
                value={r.title}
                onChange={(e) => patch(r.key, (x) => ({ ...x, title: e.target.value }))}
                aria-label="Název úkolu"
              />
              {/* Poznámku psala AI — musí jít přepsat nebo smazat dřív, než se uloží. */}
              {r.note !== null && (
                <textarea
                  className={`field ${styles.capNoteEdit}`}
                  rows={2}
                  value={r.note}
                  maxLength={NOTE_MAX}
                  onChange={(e) => patch(r.key, (x) => ({ ...x, note: e.target.value }))}
                  aria-label="Poznámka k úkolu"
                />
              )}

              <div className={styles.capGrid}>
                <div className={styles.capField}>
                  <span>Typ</span>
                  <select
                    className="field"
                    value={r.kind}
                    onChange={(e) => patch(r.key, (x) => withKind(x, e.target.value as TaskKind, today))}
                  >
                    {KIND_OPTIONS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                </div>
                <div className={styles.capField}>
                  <span>Stav</span>
                  <select
                    className="field"
                    value={r.step}
                    onChange={(e) => patch(r.key, (x) => withStep(x, Number(e.target.value), today))}
                  >
                    {FLOWS[r.kind].map((s, i) => <option key={i} value={i}>{s.label}</option>)}
                  </select>
                </div>
                <div className={styles.capField}>
                  <span>Klient</span>
                  <select
                    className="field"
                    value={r.clientId ?? ""}
                    onChange={(e) => patch(r.key, (x) => ({ ...x, clientId: e.target.value || null }))}
                  >
                    <option value="">— žádný —</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className={styles.capField}>
                  <span>Kategorie</span>
                  <select
                    className="field"
                    value={r.categoryId ?? ""}
                    onChange={(e) => patch(r.key, (x) => ({ ...x, categoryId: e.target.value || null }))}
                  >
                    <option value="">— žádná —</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className={styles.capField}>
                  <span>Termín</span>
                  <input
                    type="date"
                    className="field"
                    value={r.dueKey ?? ""}
                    onChange={(e) => patch(r.key, (x) => ({ ...x, dueKey: e.target.value || null }))}
                  />
                </div>
                {done && (
                  <div className={styles.capField}>
                    <span>Hotovo dne</span>
                    <input
                      type="date"
                      className="field"
                      max={today}
                      value={r.doneOn ?? today}
                      onChange={(e) => patch(r.key, (x) => ({ ...x, doneOn: e.target.value || today }))}
                    />
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
