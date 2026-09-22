"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ClientBoard, ClientTask } from "@/lib/client-board";
import { decideAction } from "./actions";
import styles from "./desk.module.css";

export default function ClientDesk({
  token,
  board,
}: {
  token: string;
  board: ClientBoard;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  // Který úkol má otevřené pole pro připomínku.
  const [writing, setWriting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const waiting = board.tasks.filter((t) => t.ball === "client");
  const running = board.tasks.filter((t) => t.ball === "me" || t.ball === "supplier");
  const done = board.tasks.filter((t) => t.ball === "done");

  function decide(task: ClientTask, approve: boolean) {
    setError(null);
    setBusy(task.id);
    startTransition(async () => {
      const res = await decideAction({
        token,
        taskId: task.id,
        approve,
        note: approve ? "" : note,
      });
      setBusy(null);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setWriting(null);
      setNote("");
      setThanks(
        approve
          ? `„${task.title}“ je schválené. Studio to uvidí hned.`
          : `Připomínky k „${task.title}“ jsou odeslané.`,
      );
      router.refresh();
    });
  }

  return (
    <main className={styles.stage}>
      <header className={styles.head}>
        <div className={styles.studio}>
          <span className={styles.logo} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 6h16M4 12h11M4 18h7" />
            </svg>
          </span>
          <span>
            <span className={styles.studioName}>{board.org_name}</span>
            {board.sender_mail && (
              <span className={styles.studioSub}>{board.sender_mail}</span>
            )}
          </span>
        </div>
        <div className={styles.forWhom}>
          <span>pro</span>
          <b>
            <i style={{ background: board.client_color }} aria-hidden="true" />
            {board.client_name}
          </b>
        </div>
      </header>

      <h1 className={styles.title}>
        {waiting.length === 0
          ? "Teď na tebe nic nečeká"
          : waiting.length === 1
            ? "Jedna věc čeká na tvoje slovo"
            : waiting.length < 5
              ? `${waiting.length} věci čekají na tvoje slovo`
              : `${waiting.length} věcí čeká na tvoje slovo`}
      </h1>
      <p className={styles.lede}>
        {waiting.length === 0
          ? "Až bude něco ke schválení, objeví se to tady. Odkaz si můžeš nechat, platí dál."
          : "Schválením se práce posune dál. Když něco nesedí, napiš to — vrátí se to k přepracování."}
      </p>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {thanks && <p className={styles.thanks} role="status">{thanks}</p>}

      {waiting.length > 0 && (
        <section className={styles.deck}>
          {waiting.map((t) => (
            <article key={t.id} className={`${styles.card} ${t.is_late ? styles.cardLate : ""}`}>
              <header className={styles.cardHead}>
                <h2>{t.title}</h2>
                <span className={`pill ${t.is_late ? "o-alarm" : "o-client"}`}>
                  {t.is_late ? "po termínu" : t.step_name}
                </span>
              </header>

              {(t.agreed_note || t.agreed_at || t.due_at) && (
                <dl className={styles.facts}>
                  {t.agreed_note && (
                    <span><dt>Domluveno</dt><dd>{t.agreed_note}</dd></span>
                  )}
                  {t.agreed_at && (
                    <span><dt>Domluveno na</dt><dd>{csDate(t.agreed_at)}</dd></span>
                  )}
                  {t.due_at && (
                    <span><dt>Termín</dt><dd>{csDate(t.due_at)}</dd></span>
                  )}
                </dl>
              )}

              {writing === t.id ? (
                <div className={styles.noteBox}>
                  <label className={styles.label} htmlFor={`n-${t.id}`}>
                    Co je potřeba upravit?
                  </label>
                  <textarea
                    id={`n-${t.id}`}
                    className="field"
                    rows={4}
                    value={note}
                    maxLength={2000}
                    autoFocus
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Napiš konkrétně, ať to studio nemusí hádat…"
                  />
                  <div className={styles.acts}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy === t.id || note.trim().length === 0}
                      onClick={() => decide(t, false)}
                    >
                      {busy === t.id ? "Odesílám…" : "Odeslat připomínky"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => { setWriting(null); setNote(""); }}
                    >
                      Zpět
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.acts}>
                  <button
                    type="button"
                    className={`btn btn-lg ${styles.approve}`}
                    disabled={busy === t.id}
                    onClick={() => decide(t, true)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 12l6 6L20 6" />
                    </svg>
                    {busy === t.id ? "Posílám…" : "Schvaluji"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-lg"
                    onClick={() => { setWriting(t.id); setNote(""); setError(null); }}
                  >
                    Mám připomínky
                  </button>
                </div>
              )}

              {t.reply && (
                <p className={styles.lastReply}>
                  Tvoje poslední zpráva{t.reply_at ? ` (${csDate(t.reply_at)})` : ""}: „{t.reply}“
                </p>
              )}
            </article>
          ))}
        </section>
      )}

      {running.length > 0 && (
        <section className={styles.list}>
          <h2 className={styles.listHead}>
            Pracuje se na tom
            <span>{running.length}</span>
          </h2>
          <ul>
            {running.map((t) => (
              <li key={t.id}>
                <span className={`${styles.dot} o-${t.is_late ? "alarm" : t.ball}`} aria-hidden="true" />
                <span className={styles.itemName}>{t.title}</span>
                <span className={styles.itemState}>
                  {t.step_name}
                  {t.due_at ? ` · ${csDate(t.due_at)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <section className={styles.list}>
          <h2 className={styles.listHead}>
            Hotovo
            <span>{done.length}</span>
          </h2>
          <ul>
            {done.map((t) => (
              <li key={t.id}>
                <span className={`${styles.dot} o-done`} aria-hidden="true" />
                <span className={styles.itemName}>{t.title}</span>
                <span className={styles.itemState}>{t.step_name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className={styles.foot}>
        <span>{board.sender ?? board.org_name}</span>
        <span>
          Tuhle stránku ti poslalo studio odkazem. Účet k ní nepotřebuješ —
          stačí si odkaz uložit.
        </span>
      </footer>
    </main>
  );
}

function csDate(value: string): string {
  return new Date(value).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}
