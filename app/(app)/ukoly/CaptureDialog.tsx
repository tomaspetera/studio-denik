"use client";

import { useState, useTransition } from "react";
import { FLOWS, plural, stepCount, type DateKey, type TaskKind } from "@/lib/domain";
import { CAPTURE_MAX_CHARS } from "@/lib/capture-limits";
import type { Proposal } from "@/lib/capture";
import type { Category, Client } from "@/lib/tasks";
import { createProposedTasksAction, proposeTasksAction } from "./capture-actions";
import styles from "./tasks.module.css";

type Row = Proposal & { key: number; include: boolean };

const KIND_OPTIONS: { key: TaskKind; label: string }[] = [
  { key: "interni", label: "Interní" },
  { key: "klient", label: "S klientem" },
  { key: "tisk", label: "Tiskový" },
];

/** Změna typu mění počet kroků — hotový zůstane hotový, otevřený se nikdy sám nedokončí. */
function withKind(row: Row, kind: TaskKind, today: DateKey): Row {
  const wasDone = row.step === stepCount(row.kind) - 1;
  const last = stepCount(kind) - 1;
  const step = wasDone ? last : Math.min(row.step, last - 1);
  return { ...row, kind, step, doneOn: step === last ? (row.doneOn ?? today) : null };
}

function withStep(row: Row, step: number, today: DateKey): Row {
  const done = step === stepCount(row.kind) - 1;
  return { ...row, step, doneOn: done ? (row.doneOn ?? today) : null };
}

/**
 * Rychlý zápis: text → návrh úkolů → kontrola → založení. AI jen navrhuje,
 * úkoly vzniknou až po potvrzení a každý řádek jde před tím upravit.
 */
export default function CaptureDialog({
  clients,
  categories,
  today,
  onClose,
  onCreated,
}: {
  clients: Client[];
  categories: Category[];
  /** Dnešek podle Prahy, počítaný na serveru. */
  today: DateKey;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function analyze() {
    if (!text.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await proposeTasksAction(text);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      if (res.proposals.length === 0) {
        setWarnings([]);
        setError("V textu jsem nenašel žádný úkol. Zkus to napsat konkrétněji.");
        return;
      }
      setWarnings(res.warnings);
      setRows(res.proposals.map((p, i) => ({ ...p, key: i, include: true })));
    });
  }

  function patch(key: number, change: (r: Row) => Row) {
    setRows((prev) => prev && prev.map((r) => (r.key === key ? change(r) : r)));
  }

  const chosen = rows?.filter((r) => r.include) ?? [];

  function create() {
    if (chosen.length === 0 || pending) return;
    setError(null);
    const items: Proposal[] = chosen.map((r) => ({
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
    startTransition(async () => {
      const res = await createProposedTasksAction(items);
      if (res.ok) onCreated();
      else setError(res.message);
    });
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className={styles.dialog}
        style={{ maxWidth: rows ? 720 : 560 }}
        role="dialog"
        aria-modal="true"
        aria-label="Zapsat textem"
      >
        <header className={styles.dialogHead}>
          <h2>{rows ? "Zkontroluj návrh" : "Zapsat textem"}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Zavřít">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className={styles.dialogBody}>
          {!rows ? (
            <>
              <label className={styles.label} htmlFor="cap-text">Co jsi udělal nebo co je potřeba</label>
              <textarea
                id="cap-text"
                className={`field ${styles.capText}`}
                rows={7}
                value={text}
                maxLength={CAPTURE_MAX_CHARS}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    analyze();
                  }
                }}
                placeholder="Letáky pro Lípu poslány do tisku, v pondělí zavolat Novákovi kvůli webu, korektury hotové v úterý…"
                autoFocus
              />
              <p className={styles.capMeta}>
                <span>{text.length} / {CAPTURE_MAX_CHARS}</span>
                <span>Ctrl + Enter navrhne úkoly</span>
              </p>
              <p className={styles.note}>
                Napiš jednu větu, nebo vlož poznámky z celého týdne. Z textu se navrhne seznam úkolů,
                který před založením zkontroluješ a upravíš — nic se nezaloží samo. Text se při
                zpracování posílá AI, nepiš do něj nic opravdu citlivého.
              </p>
            </>
          ) : (
            <>
              {warnings.length > 0 && (
                <ul className={styles.capWarn} role="status">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}

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
                        {r.note && <p className={styles.capNote}>{r.note}</p>}

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
            </>
          )}

          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>

        <footer className={styles.dialogFoot}>
          {rows && (
            <button type="button" className="btn btn-ghost" onClick={() => { setRows(null); setError(null); }}>
              Zpět na text
            </button>
          )}
          <span className={styles.spacer} />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Zrušit</button>
          {!rows ? (
            <button type="button" className="btn btn-primary" disabled={pending || !text.trim()} onClick={analyze}>
              {pending ? "Čtu to…" : "Navrhnout úkoly"}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={pending || chosen.length === 0} onClick={create}>
              {pending
                ? "Zakládám…"
                : `Založit ${chosen.length} ${plural(chosen.length, "úkol", "úkoly", "úkolů")}`}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
