"use client";

import { useState, useTransition } from "react";
import { plural, type DateKey } from "@/lib/domain";
import { CAPTURE_MAX_CHARS } from "@/lib/capture-limits";
import type { Category, Client } from "@/lib/tasks";
import { createProposedTasksAction, proposeTasksAction } from "./capture-actions";
import ProposalList, { chosenProposals, toRows, type ProposalRow } from "./ProposalList";
import styles from "./tasks.module.css";

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
  const [rows, setRows] = useState<ProposalRow[] | null>(null);
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
      setRows(toRows(res.proposals));
    });
  }

  const chosen = rows ? chosenProposals(rows) : [];

  function create() {
    if (chosen.length === 0 || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await createProposedTasksAction(chosen);
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

              <ProposalList rows={rows} onChange={setRows} clients={clients} categories={categories} today={today} />
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
