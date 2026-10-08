"use client";

import { useState, useTransition } from "react";
import type { DateKey } from "@/lib/domain";
import { nudgeText, waitLabel } from "@/lib/nudge";
import type { TodayTask } from "@/lib/today";
import { recordNudgeAction } from "./nudge-actions";
import dialog from "./ukoly/tasks.module.css";
import styles from "./today.module.css";

/** Nová zpráva v Gmailu pod účtem připojené schránky. */
const gmailCompose = (account: string) =>
  `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account)}#inbox?compose=new`;

/**
 * Okno „Urgovat klienta“. Připraví text připomínky k úkolu, který leží
 * u klienta. Appka nic neposílá — text se zkopíruje a odejde z Gmailu.
 * Do historie úkolu se jen zapíše, že se urgovalo, aby to bylo vidět na Dnes.
 *
 * Rodič okno vykresluje s `key` podle úkolu, takže text se pro každý úkol
 * skládá znovu a rozepsaná úprava se nepřenese na jiný.
 */
export default function NudgeDialog({
  task,
  today,
  signature,
  account,
  onClose,
  onDone,
}: {
  task: TodayTask;
  today: DateKey;
  /** Jméno do podpisu z profilu. */
  signature: string | null;
  /** Adresa připojené schránky — když je, jde rovnou otevřít nová zpráva v Gmailu. */
  account: string | null;
  onClose: () => void;
  /** Urgence je zapsaná — přehled se má načíst znovu. */
  onDone: () => void;
}) {
  const navrh = nudgeText({ title: task.title, sinceKey: task.waitSince, dueKey: task.dueKey, today, name: signature });
  const [text, setText] = useState(navrh.body);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Moderní cesta může selhat (zakázané oprávnění) — pak zbývá označení textu a Ctrl + C. */
  async function copy(): Promise<boolean> {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const pole = document.getElementById("nd-text") as HTMLTextAreaElement | null;
      if (pole) {
        pole.focus();
        pole.select();
        try {
          ok = document.execCommand("copy");
        } catch {
          ok = false;
        }
      }
    }
    setCopied(ok);
    return ok;
  }

  async function copyAndRecord() {
    setError(null);
    if (!(await copy())) return;
    // Nová záložka až po kopii: po přepnutí záložky by prohlížeč zápis do schránky odmítl.
    if (account) window.open(gmailCompose(account), "_blank", "noopener,noreferrer");
    startTransition(async () => {
      const res = await recordNudgeAction(task.id);
      if (res.ok) onDone();
      else setError(`Text je zkopírovaný, ale urgence se nezapsala: ${res.message}`);
    });
  }

  return (
    <div
      className={dialog.backdrop}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className={dialog.dialog} style={{ maxWidth: 600 }} role="dialog" aria-modal="true" aria-label="Urgovat klienta">
        <header className={dialog.dialogHead}>
          <h2>Urgovat klienta</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Zavřít">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className={dialog.dialogBody}>
          <p className={styles.nudgeTask}>
            <b>{task.title}</b>
            <span>
              {[task.clientName, task.waitDays !== null ? `u klienta ${waitLabel(task.waitDays)}` : "u klienta", task.nudged]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>

          <label className={dialog.label} htmlFor="nd-text">Připomínka — uprav si ji podle sebe</label>
          <textarea
            id="nd-text"
            className={`field ${styles.nudgeText}`}
            rows={11}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCopied(false);
            }}
            autoFocus
          />
          <p className={dialog.note}>
            Appka nic neodesílá. Zkopíruj text a pošli ho klientovi z Gmailu — nejlíp odpovědí na
            poslední zprávu k téhle věci. Předmět pro novou zprávu: <b>{navrh.subject}</b>
            {copied && <b> · Zkopírováno — stačí vložit (Ctrl + V).</b>}
          </p>

          {error && <p className={dialog.error} role="alert">{error}</p>}
        </div>

        <footer className={dialog.dialogFoot}>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={copy}>
            Jen zkopírovat
          </button>
          <span className={dialog.spacer} />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Zavřít</button>
          <button type="button" className="btn btn-primary" disabled={pending || !text.trim()} onClick={copyAndRecord}>
            {pending ? "Zapisuju…" : account ? "Zkopírovat a otevřít Gmail" : "Zkopírovat a zapsat urgenci"}
          </button>
        </footer>
      </div>
    </div>
  );
}
