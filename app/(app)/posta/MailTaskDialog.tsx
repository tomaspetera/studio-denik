"use client";

import { useState, useTransition } from "react";
import { plural, type DateKey } from "@/lib/domain";
import type { MailRow } from "@/lib/mail-data";
import type { LeadDraft } from "@/lib/mail-lead";
import type { Category, Client } from "@/lib/tasks";
import ProposalList, { chosenProposals, toRows, type ProposalRow } from "../ukoly/ProposalList";
import {
  createLeadFromMailAction,
  createTasksFromMailAction,
  proposeFromMailAction,
  proposeLeadFromMailAction,
  setHandledAction,
  setMailAiConsentAction,
  taskFromMailAction,
} from "./actions";
import AiConsent from "./AiConsent";
import dialog from "../ukoly/tasks.module.css";
import styles from "./posta.module.css";

/**
 * consent     — pomoc AI ještě není povolená, nejdřív se zeptat
 * reading     — AI čte e-mail a navrhuje úkol
 * proposal    — návrh úkolů k úpravě a potvrzení
 * nothing     — e-mail po člověku nic nechce
 * failed      — nepovedlo se; pořád jde založit úkol bez AI
 * leadReading — AI čte e-mail a připravuje poptávku
 * lead        — poptávka k úpravě a potvrzení
 */
type Phase = "consent" | "reading" | "proposal" | "nothing" | "failed" | "leadReading" | "lead";

type State = {
  mail: MailRow;
  phase: Phase;
  rows: ProposalRow[];
  warnings: string[];
  lead: LeadDraft | null;
  leadWarnings: string[];
  /** Kam se vrátit z poptávky zpátky k úkolu. */
  back: Phase;
  error: string | null;
};

export type MailTask = ReturnType<typeof useMailTask>;

/**
 * Průběh „z e-mailu úkol nebo poptávka“. Stav drží přehled pošty, ne okno
 * samo: čtení tak začíná přímo kliknutím na tlačítko, a ne až vykreslením
 * okna — to by ve vývojovém režimu Reactu poslalo e-mail do AI dvakrát.
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
      setState({
        mail,
        phase: aiAllowed ? "reading" : "consent",
        rows: [],
        warnings: [],
        lead: null,
        leadWarnings: [],
        back: "proposal",
        error: null,
      });
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

    /** Místo úkolu poptávka: AI z téže zprávy připraví podklady. */
    toLead() {
      if (!state) return;
      const id = state.mail.id;
      const back = state.phase;
      // Už jednou připravenou poptávku není proč číst znovu.
      if (state.lead) {
        patch(id, { phase: "lead", back, error: null });
        return;
      }
      patch(id, { phase: "leadReading", back, error: null });
      startTransition(async () => {
        const res = await proposeLeadFromMailAction(id);
        if (!res.ok) {
          patch(id, res.needsConsent ? { phase: "consent", error: null } : { phase: back, error: res.message });
          return;
        }
        patch(id, { phase: "lead", lead: res.draft, leadWarnings: res.warnings });
      });
    },
    backToTask() {
      if (state) patch(state.mail.id, { phase: state.back, error: null });
    },
    setLead(change: Partial<LeadDraft>) {
      if (state?.lead) patch(state.mail.id, { lead: { ...state.lead, ...change } });
    },
    createLead() {
      if (!state?.lead) return;
      const id = state.mail.id;
      const lead = state.lead;
      finish(id, () => createLeadFromMailAction(id, lead), "Poptávka je založená. Najdeš ji v Poptávkách.");
    },
  };
}

const TITLE: Record<Phase, string> = {
  consent: "Navrhnout úkol z e-mailu",
  reading: "Čtu e-mail…",
  proposal: "Zkontroluj návrh",
  nothing: "Žádný úkol",
  failed: "Nepodařilo se to",
  leadReading: "Čtu e-mail…",
  lead: "Zkontroluj poptávku",
};

const WIDTH: Partial<Record<Phase, number>> = { proposal: 720, lead: 640 };

/**
 * Okno „z e-mailu úkol nebo poptávka“. AI jen navrhuje — nic nevznikne bez
 * potvrzení a všechno jde před tím upravit. Bez AI jde úkol založit z každého kroku.
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

  const { mail, phase, lead } = s;
  const busy = task.pending;
  const count = chosenProposals(s.rows).length;
  // Poptávka je krok před založeným klientem — u zprávy od klienta nedává smysl.
  const muzeBytPoptavka = !mail.clientId && (phase === "proposal" || phase === "nothing");
  const warnings = phase === "lead" ? s.leadWarnings : s.warnings;

  return (
    <div
      className={dialog.backdrop}
      onClick={(e) => e.target === e.currentTarget && task.close()}
      onKeyDown={(e) => e.key === "Escape" && task.close()}
    >
      <div
        className={dialog.dialog}
        style={{ maxWidth: WIDTH[phase] ?? 560 }}
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

          {phase === "consent" && <AiConsent lead="Aby šel z e-mailu navrhnout úkol," />}

          {phase === "reading" && (
            <p className={styles.reading} role="status">AI čte e-mail a navrhuje úkol. Trvá to pár vteřin.</p>
          )}
          {phase === "leadReading" && (
            <p className={styles.reading} role="status">AI čte e-mail a připravuje poptávku. Trvá to pár vteřin.</p>
          )}

          {(phase === "proposal" || phase === "nothing" || phase === "lead") && warnings.length > 0 && (
            <ul className={dialog.capWarn} role="status">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
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

          {phase === "lead" && lead && (
            <div className={styles.leadForm}>
              <label className={dialog.label} htmlFor="ml-name">Co poptávají</label>
              <input
                id="ml-name"
                className="field"
                value={lead.name}
                maxLength={200}
                onChange={(e) => task.setLead({ name: e.target.value })}
                autoFocus
              />

              <div className={styles.leadGrid}>
                <div>
                  <label className={dialog.label} htmlFor="ml-company">Kdo poptává</label>
                  <input
                    id="ml-company"
                    className="field"
                    value={lead.company ?? ""}
                    maxLength={200}
                    onChange={(e) => task.setLead({ company: e.target.value || null })}
                    placeholder="Firma, pokud je znát"
                  />
                </div>
                <div>
                  <label className={dialog.label} htmlFor="ml-contact">Kontaktní osoba</label>
                  <input
                    id="ml-contact"
                    className="field"
                    value={lead.contact ?? ""}
                    maxLength={200}
                    onChange={(e) => task.setLead({ contact: e.target.value || null })}
                  />
                </div>
                <div>
                  <label className={dialog.label} htmlFor="ml-email">E-mail</label>
                  <input
                    id="ml-email"
                    className="field"
                    type="email"
                    value={lead.email}
                    maxLength={320}
                    onChange={(e) => task.setLead({ email: e.target.value })}
                  />
                </div>
                <div>
                  <label className={dialog.label} htmlFor="ml-phone">Telefon</label>
                  <input
                    id="ml-phone"
                    className="field"
                    type="tel"
                    value={lead.phone ?? ""}
                    maxLength={40}
                    onChange={(e) => task.setLead({ phone: e.target.value || null })}
                    placeholder="V e-mailu nebyl"
                  />
                </div>
                <div>
                  <label className={dialog.label} htmlFor="ml-step">Další krok</label>
                  <input
                    id="ml-step"
                    className="field"
                    value={lead.nextStep}
                    maxLength={200}
                    onChange={(e) => task.setLead({ nextStep: e.target.value })}
                  />
                </div>
                <div>
                  <label className={dialog.label} htmlFor="ml-step-at">Kdy</label>
                  <input
                    id="ml-step-at"
                    className="field"
                    type="date"
                    value={lead.nextStepAt}
                    onChange={(e) => task.setLead({ nextStepAt: e.target.value })}
                  />
                </div>
              </div>

              <label className={dialog.label} htmlFor="ml-note">Poznámka</label>
              <textarea
                id="ml-note"
                className="field"
                rows={4}
                value={lead.note ?? ""}
                maxLength={1000}
                onChange={(e) => task.setLead({ note: e.target.value || null })}
              />
              <p className={dialog.note}>Částku AI nehádá — doplníš ji v Poptávkách, až bude nabídka.</p>
            </div>
          )}

          {s.error && <p className={dialog.error} role="alert">{s.error}</p>}
        </div>

        <footer className={`${dialog.dialogFoot} ${styles.foot}`}>
          {(phase === "consent" || phase === "failed" || phase === "nothing") && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={task.createPlain}>
              {phase === "nothing" ? "Založit přesto" : "Založit bez AI"}
            </button>
          )}
          {muzeBytPoptavka && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              title="Odesílatel není mezi klienty — místo úkolu jde založit poptávku"
              onClick={task.toLead}
            >
              Je to poptávka
            </button>
          )}
          {phase === "lead" && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={task.backToTask}>
              Zpět na úkol
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
          {phase === "lead" && (
            <button type="button" className="btn btn-primary" disabled={busy || !lead?.name.trim()} onClick={task.createLead}>
              {busy ? "Zakládám…" : "Založit poptávku"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
