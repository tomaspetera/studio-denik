"use client";

import { useState, useTransition } from "react";
import type { MailRow } from "@/lib/mail-data";
import { gmailThreadUrl } from "@/lib/links";
import { draftReplyAction, setMailAiConsentAction } from "./actions";
import AiConsent from "./AiConsent";
import dialog from "../ukoly/tasks.module.css";
import styles from "./posta.module.css";

/** Stejný strop jako na serveru (`REPLY_HINT_MAX` v `lib/mail-reply.ts`). */
const HINT_MAX = 600;

/**
 * consent — pomoc AI ještě není povolená, nejdřív se zeptat
 * compose — co chce člověk odpovědět (heslovitě, nepovinné)
 * writing — AI čte e-mail a píše odpověď
 * draft   — návrh k úpravě a zkopírování
 */
type Phase = "consent" | "compose" | "writing" | "draft";

type State = {
  mail: MailRow;
  phase: Phase;
  hint: string;
  reply: string;
  missing: string[];
  /** Platební údaj, odkaz nebo adresa v návrhu, které člověk nezadal. */
  risk: string | null;
  /** Čísla v návrhu, která nejsou z pokynu — ke kontrole před odesláním. */
  numbers: string[];
  warnings: string[];
  copied: boolean;
  error: string | null;
};

export type MailReply = ReturnType<typeof useMailReply>;

// Odkaz na vlákno v Gmailu je v `lib/links.ts` — potřebuje ho i server.
export { gmailThreadUrl };

/**
 * Průběh „návrh odpovědi“. Appka odpověď nikdy neodesílá ani neukládá —
 * návrh žije jen v tomhle okně, dokud ho člověk nezkopíruje do Gmailu.
 */
export function useMailReply() {
  const [state, setState] = useState<State | null>(null);
  const [pending, startTransition] = useTransition();

  /** Změna jen tehdy, když je pořád otevřená ta samá zpráva — pozdní odpověď nesmí přepsat jinou. */
  const patch = (mailId: string, change: Partial<State>) =>
    setState((s) => (s && s.mail.id === mailId ? { ...s, ...change } : s));

  return {
    state,
    pending,

    open(mail: MailRow, aiAllowed: boolean) {
      setState({
        mail,
        phase: aiAllowed ? "compose" : "consent",
        hint: "",
        reply: "",
        missing: [],
        risk: null,
        numbers: [],
        warnings: [],
        copied: false,
        error: null,
      });
    },
    close() {
      setState(null);
    },

    /** Souhlas. AI se zavolá až po „Napsat odpověď“ — nejdřív má člověk možnost říct, co chce sdělit. */
    allow() {
      if (!state) return;
      const id = state.mail.id;
      patch(id, { error: null });
      startTransition(async () => {
        const souhlas = await setMailAiConsentAction(true);
        patch(id, souhlas.ok ? { phase: "compose" } : { error: souhlas.message });
      });
    },

    setHint(hint: string) {
      if (state) patch(state.mail.id, { hint });
    },
    setReply(reply: string) {
      if (state) patch(state.mail.id, { reply, copied: false });
    },

    write() {
      if (!state) return;
      const { id } = state.mail;
      const hint = state.hint;
      patch(id, { phase: "writing", error: null });
      startTransition(async () => {
        const res = await draftReplyAction(id, hint);
        if (!res.ok) {
          patch(id, res.needsConsent ? { phase: "consent", error: null } : { phase: "compose", error: res.message });
          return;
        }
        patch(id, {
          phase: "draft",
          reply: res.reply,
          missing: res.missing,
          risk: res.risk,
          numbers: res.numbers,
          warnings: res.warnings,
          copied: false,
        });
      });
    },
    /** Zpátky k zadání — pokyn zůstane, jde ho upřesnit a nechat napsat znovu. */
    again() {
      if (state) patch(state.mail.id, { phase: "compose", error: null });
    },

    /** Výsledek kopírování do schránky — samo kopírování dělá okno, to má přístup k poli s textem. */
    setCopied(ok: boolean) {
      if (!state) return;
      patch(
        state.mail.id,
        ok ? { copied: true, error: null } : { copied: false, error: "Zkopírovat se nepodařilo. Text je označený — stiskni Ctrl + C." },
      );
    },
  };
}

const TITLE: Record<Phase, string> = {
  consent: "Návrh odpovědi",
  compose: "Návrh odpovědi",
  writing: "Píšu odpověď…",
  draft: "Návrh odpovědi",
};

/**
 * Okno „návrh odpovědi“. Člověk může heslovitě říct, co chce sdělit, AI z toho
 * napíše celou odpověď. Odesílá se vždycky v Gmailu — appka umí jen číst.
 */
export default function MailReplyDialog({ reply, account }: { reply: MailReply; /** Adresa připojené schránky. */ account: string }) {
  const s = reply.state;
  if (!s) return null;

  const { mail, phase } = s;
  const busy = reply.pending;

  /**
   * Zkopíruje návrh do schránky. Moderní cesta může selhat (starší prohlížeč,
   * zakázané oprávnění), proto je tu i ta původní přes označení textu. Když
   * nevyjde ani jedna, text zůstane označený a stačí Ctrl + C.
   */
  async function copy(): Promise<boolean> {
    let ok = false;
    try {
      await navigator.clipboard.writeText(s!.reply);
      ok = true;
    } catch {
      const pole = document.getElementById("mr-reply") as HTMLTextAreaElement | null;
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
    reply.setCopied(ok);
    return ok;
  }

  async function copyAndOpen() {
    // Nejdřív kopie, pak nová záložka: po přepnutí záložky by prohlížeč
    // zápis do schránky odmítl.
    if (await copy()) window.open(gmailThreadUrl(mail.threadId, account), "_blank", "noopener,noreferrer");
  }

  return (
    <div
      className={dialog.backdrop}
      onClick={(e) => e.target === e.currentTarget && reply.close()}
      onKeyDown={(e) => e.key === "Escape" && reply.close()}
    >
      <div
        className={dialog.dialog}
        style={{ maxWidth: phase === "draft" ? 640 : 560 }}
        role="dialog"
        aria-modal="true"
        aria-label={TITLE[phase]}
      >
        <header className={dialog.dialogHead}>
          <h2>{TITLE[phase]}</h2>
          <button type="button" className="btn btn-ghost" onClick={reply.close} aria-label="Zavřít">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className={dialog.dialogBody}>
          <p className={styles.dialogMail}>
            <b>{mail.fromName ?? mail.fromEmail}</b>
            <span>{mail.subject ?? "(bez předmětu)"}</span>
          </p>

          {phase === "consent" && <AiConsent lead="Aby šla navrhnout odpověď," />}

          {phase === "compose" && (
            <>
              <label className={dialog.label} htmlFor="mr-hint">Co chceš odpovědět? (nepovinné)</label>
              <textarea
                id="mr-hint"
                className="field"
                rows={3}
                value={s.hint}
                maxLength={HINT_MAX}
                onChange={(e) => reply.setHint(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    reply.write();
                  }
                }}
                placeholder="ano, pošlu ve čtvrtek · ne, nejdřív příští týden · cena 4 500 Kč bez DPH"
                autoFocus
              />
              <p className={dialog.note}>
                Stačí heslovitě, AI z toho napíše celou odpověď. Když nenapíšeš nic, navrhne
                nejpřirozenější odpověď a co neví, označí [doplnit]. Ctrl + Enter napíše odpověď.
              </p>
            </>
          )}

          {phase === "writing" && (
            <p className={styles.reading} role="status">AI čte e-mail a píše odpověď. Trvá to pár vteřin.</p>
          )}

          {phase === "draft" && (
            <>
              {s.warnings.length > 0 && (
                <ul className={dialog.capWarn} role="status">
                  {s.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              {s.risk && <p className={styles.warn} role="alert">{s.risk}</p>}
              {s.missing.length > 0 && (
                <p className={styles.warn} role="status">
                  Než to odešleš, doplň: {s.missing.join(", ")}.
                </p>
              )}

              <label className={dialog.label} htmlFor="mr-reply">Odpověď — uprav si ji podle sebe</label>
              <textarea
                id="mr-reply"
                className={`field ${styles.replyText}`}
                rows={11}
                value={s.reply}
                onChange={(e) => reply.setReply(e.target.value)}
              />
              {s.numbers.length > 0 && (
                <p className={dialog.note}>
                  Čísla, která nejsou z tvého pokynu: <b>{s.numbers.join(", ")}</b> — zkontroluj, že sedí.
                </p>
              )}
              <p className={dialog.note}>
                Appka nic neodesílá. Zkopíruj text, v Gmailu klikni u zprávy na Odpovědět a vlož ho.
                {s.copied && <b> Zkopírováno — stačí vložit (Ctrl + V).</b>}
              </p>
            </>
          )}

          {s.error && <p className={dialog.error} role="alert">{s.error}</p>}
        </div>

        <footer className={`${dialog.dialogFoot} ${styles.foot}`}>
          {phase === "draft" && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={reply.again}>
              Zkusit jinak
            </button>
          )}
          <span className={dialog.spacer} />
          <button type="button" className="btn btn-ghost" onClick={reply.close}>
            {phase === "draft" ? "Zavřít" : "Zrušit"}
          </button>

          {phase === "consent" && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={reply.allow} autoFocus>
              {busy ? "Ukládám…" : "Povolit a pokračovat"}
            </button>
          )}
          {phase === "compose" && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={reply.write}>
              Napsat odpověď
            </button>
          )}
          {phase === "draft" && (
            <>
              <button type="button" className="btn" disabled={!s.reply.trim()} onClick={() => void copy()}>
                {s.copied ? "Zkopírováno" : "Zkopírovat"}
              </button>
              <button type="button" className="btn btn-primary" disabled={!s.reply.trim()} onClick={() => void copyAndOpen()}>
                Zkopírovat a otevřít v Gmailu
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
