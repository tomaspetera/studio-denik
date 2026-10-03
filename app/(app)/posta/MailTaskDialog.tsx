"use client";

import { useState, useTransition } from "react";
import { plural, type DateKey } from "@/lib/domain";
import type { MailRow } from "@/lib/mail-data";
import type { Category, Client } from "@/lib/tasks";
import ProposalList, { chosenProposals, toRows, type ProposalRow } from "../ukoly/ProposalList";
import {
  createTasksFromMailAction,
  proposeFromMailAction,
  setHandledAction,
  setMailAiConsentAction,
  taskFromMailAction,
} from "./actions";
import dialog from "../ukoly/tasks.module.css";
import styles from "./posta.module.css";

/**
 * consent  — AI nad poštou ještě není povolená, nejdřív se zeptat
 * reading  — AI čte e-mail
 * proposal — návrh k úpravě a potvrzení
 * nothing  — e-mail po člověku nic nechce
 * failed   — nepovedlo se; pořád jde založit úkol bez AI
 */
type Phase = "consent" | "reading" | "proposal" | "nothing" | "failed";

type State = {
  mail: MailRow;
  phase: Phase;
  rows: ProposalRow[];
  warnings: string[];
  error: string | null;
};

export type MailTask = ReturnType<typeof useMailTask>;

/**
 * Průběh „z e-mailu úkol“. Stav drží přehled pošty, ne okno samo: čtení tak
 * začíná přímo kliknutím na tlačítko, a ne až vykreslením okna — to by ve
 * vývojovém režimu Reactu poslalo e-mail do AI dvakrát.
 */
export function useMailTask(onDone: (message: string) => void) {
  const [state, setState] = useState<State | null>(null);
  const [pending, startTransition] = useTransition();

  /** Změna jen tehdy, když je pořád otevřená ta samá zpráva — pozdní odpověď nesmí přepsat jinou. */
  const patch = (mailId: string, change: Partial<State>) =>
    setState((s) => (s && s.mail.id === mailId ? { ...s, ...change } : s));

  function load(mailId: string, grantFirst: boolean) {
    startTransition(async () => {
      if (grantFirst) {
        const souhlas = await setMailAiConsentAction(true);
        if (!souhlas.ok) {
          patch(mailId, { phase: "consent", error: souhlas.message });
          return;
        }
      }

      const res = await proposeFromMailAction(mailId);
      if (!res.ok) {
        patch(mailId, res.needsConsent ? { phase: "consent", error: null } : { phase: "failed", error: res.message });
        return;
      }
      patch(
        mailId,
        res.proposals.length === 0
          ? { phase: "nothing", warnings: res.warnings }
          : { phase: "proposal", rows: toRows(res.proposals), warnings: res.warnings },
      );
    });
  }

  function finish(mailId: string, work: () => Promise<{ ok: boolean; message?: string }>, message: string) {
    patch(mailId, { error: null });
    startTransition(async () => {
      const res = await work();
      if (!res.ok) {
        patch(mailId, { error: res.message ?? "Nepodařilo se to." });
        return;
      }
      setState(null);
      onDone(message);
    });
  }

  return {
    state,
    pending,

    open(mail: MailRow, aiAllowed: boolean) {
      setState({ mail, phase: aiAllowed ? "reading" : "consent", rows: [], warnings: [], error: null });
      if (aiAllowed) load(mail.id, false);
    },
    close() {
      setState(null);
    },

    /** Souhlas a hned čtení — jedno kliknutí místo dvou. */
    allowAndRead() {
      if (!state) return;
      patch(state.mail.id, { phase: "reading", error: null });
      load(state.mail.id, true);
    },
    retry() {
      if (!state) return;
      patch(state.mail.id, { phase: "reading", error: null });
      load(state.mail.id, false);
    },
    setRows(rows: ProposalRow[]) {
      if (state) patch(state.mail.id, { rows });
    },

    create() {
      if (!state) return;
      const items = chosenProposals(state.rows);
      if (items.length === 0) return;
      const id = state.mail.id;
      finish(
        id,
        () => createTasksFromMailAction(id, items),
        items.length === 1 ? "Úkol je založený." : `Založeno ${items.length} ${plural(items.length, "úkol", "úkoly", "úkolů")}.`,
      );
    },
    /** Úkol postaru: jen z předmětu, bez AI. */
    createPlain() {
      if (!state) return;
      const id = state.mail.id;
      finish(id, () => taskFromMailAction(id), "Úkol je založený.");
    },
    markHandled() {
      if (!state) return;
      const id = state.mail.id;
      finish(id, () => setHandledAction(id, true), "Zpráva je označená jako vyřízená.");
    },
  };
}

const TITLE: Record<Phase, string> = {
  consent: "Navrhnout úkol z e-mailu",
  reading: "Čtu e-mail…",
  proposal: "Zkontroluj návrh",
  nothing: "Žádný úkol",
  failed: "Nepodařilo se to",
};

/**
 * Okno „z e-mailu úkol“. AI jen navrhuje — úkol vznikne až po potvrzení
 * a každý řádek jde před tím upravit. Bez AI jde úkol založit z každého kroku.
 */
export default function MailTaskDialog({
  task,
  clients,
  categories,
  today,
}: {
  task: MailTask;
  clients: Client[];
  categories: Category[];
  /** Dnešek podle Prahy, počítaný na serveru. */
  today: DateKey;
}) {
  const s = task.state;
  if (!s) return null;

  const { mail, phase } = s;
  const busy = task.pending;
  const count = chosenProposals(s.rows).length;

  return (
    <div
      className={dialog.backdrop}
      onClick={(e) => e.target === e.currentTarget && task.close()}
      onKeyDown={(e) => e.key === "Escape" && task.close()}
    >
      <div
        className={dialog.dialog}
        style={{ maxWidth: phase === "proposal" ? 720 : 560 }}
        role="dialog"
        aria-modal="true"
        aria-label={TITLE[phase]}
      >
        <header className={dialog.dialogHead}>
          <h2>{TITLE[phase]}</h2>
          <button type="button" className="btn btn-ghost" onClick={task.close} aria-label="Zavřít">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className={dialog.dialogBody}>
          <p className={styles.dialogMail}>
            <b>{mail.fromName ?? mail.fromEmail}</b>
            <span>{mail.subject ?? "(bez předmětu)"}</span>
          </p>

          {phase === "consent" && (
            <>
              <p className={styles.consentLead}>
                Aby šel úkol navrhnout z obsahu, pošle se <b>text téhle jedné zprávy</b> ke zpracování
                do služby Google Gemini: odesílatel, předmět, datum a text bez příloh.
              </p>
              <ul className={styles.consentList}>
                <li>Děje se to jen na tvoje kliknutí u konkrétní zprávy, nikdy samo ani hromadně.</li>
                <li>Text zprávy se nikam neukládá. Uloží se až úkol, který potvrdíš.</li>
                <li>Google zaslaný obsah podle podmínek služby nepoužívá k vylepšování svých produktů ani k trénování modelů.</li>
                <li>Povolení platí i pro další zprávy a jde kdykoli vypnout v Nastavení pošty.</li>
              </ul>
              <p className={dialog.note}>
                Podrobnosti jsou v{" "}
                <a href="/soukromi" target="_blank" rel="noopener noreferrer">zásadách ochrany soukromí</a>.
              </p>
            </>
          )}

          {phase === "reading" && (
            <p className={styles.reading} role="status">AI čte e-mail a navrhuje úkol. Trvá to pár vteřin.</p>
          )}

          {(phase === "proposal" || phase === "nothing") && s.warnings.length > 0 && (
            <ul className={dialog.capWarn} role="status">
              {s.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          {phase === "proposal" && (
            <ProposalList rows={s.rows} onChange={task.setRows} clients={clients} categories={categories} today={today} />
          )}

          {phase === "nothing" && (
            <p className={styles.consentLead}>
              Z e-mailu nevyplývá nic, co bys měl udělat. Můžeš ho označit jako vyřízený, nebo úkol
              založit přesto.
            </p>
          )}

          {s.error && <p className={dialog.error} role="alert">{s.error}</p>}
        </div>

        <footer className={`${dialog.dialogFoot} ${styles.foot}`}>
          {(phase === "consent" || phase === "failed" || phase === "nothing") && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={task.createPlain}>
              {phase === "nothing" ? "Založit přesto" : "Založit bez AI"}
            </button>
          )}
          <span className={dialog.spacer} />
          <button type="button" className="btn btn-ghost" onClick={task.close}>
            {phase === "nothing" || phase === "failed" ? "Zavřít" : "Zrušit"}
          </button>

          {phase === "consent" && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={task.allowAndRead} autoFocus>
              Povolit a navrhnout
            </button>
          )}
          {phase === "failed" && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={task.retry}>
              Zkusit znovu
            </button>
          )}
          {phase === "nothing" && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={task.markHandled}>
              {busy ? "Ukládám…" : "Označit jako vyřízené"}
            </button>
          )}
          {phase === "proposal" && (
            <button type="button" className="btn btn-primary" disabled={busy || count === 0} onClick={task.create}>
              {busy ? "Zakládám…" : `Založit ${count} ${plural(count, "úkol", "úkoly", "úkolů")}`}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
