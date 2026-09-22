"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LEAD_STATUSES, LEAD_STATUS_LABEL, LEAD_STATUS_HINT, czk, type LeadStatus } from "@/lib/domain";
import type { Lead } from "@/lib/leads";
import {
  createLeadAction,
  updateLeadAction,
  setLeadStatusAction,
  deleteLeadAction,
  convertLeadToClientAction,
} from "./actions";
import styles from "./leads.module.css";

/**
 * Krok před založeným klientem. Appka dřív začínala až u klienta —
 * tohle pokrývá poptávku a nabídku, co se řeší předtím.
 *
 * Čtyři pevné stavy, žádná historie přechodů jako u úkolů (bylo by to
 * nad rámec toho, co bylo potřeba — "jednoduché stavy"). Kartu jde
 * přetáhnout do jiného sloupce stejně jako v Úkolech a v Kalendáři,
 * ale bez kontroly platnosti cíle: na rozdíl od typu úkolu tu není nic,
 * co by některý přechod zakazovalo.
 */
export default function LeadBoard({ leads, highlightId }: { leads: Lead[]; highlightId?: string }) {
  const router = useRouter();
  const [composer, setComposer] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<LeadStatus | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Zvýraznění je jen dočasné — URL by ho jinak držela navždy i po obnovení.
  const [highlighted, setHighlighted] = useState(highlightId ?? null);

  useEffect(() => {
    if (!highlightId) return;
    document.getElementById(`lead-${highlightId}`)?.scrollIntoView({ block: "center" });
    const t = setTimeout(() => setHighlighted(null), 2200);
    return () => clearTimeout(t);
    // Jen při prvním vykreslení stránky s tímhle odkazem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = leads.filter((l) => l.status === "poptavka" || l.status === "nabidka");
  const openAmount = open.reduce((s, l) => s + (l.amount ?? 0), 0);

  const columns = useMemo(
    () => LEAD_STATUSES.map((status) => ({ status, rows: leads.filter((l) => l.status === status) })),
    [leads],
  );

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.message ?? "Nepodařilo se to.");
      router.refresh();
    });
  }

  function moveStatus(id: string, status: LeadStatus) {
    run(() => setLeadStatusAction(id, status));
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Poptávky</h1>
          <p className={styles.sub}>
            {leads.length === 0
              ? "Zatím žádné"
              : `${open.length} otevřených${openAmount > 0 ? ` · odhad ${czk(openAmount)}` : ""}`}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setEditLead(null); setComposer(true); }}>
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          <span>Nová poptávka</span>
        </button>
      </header>

      {error && <p className={styles.topError} role="alert">{error}</p>}

      {leads.length === 0 ? (
        <div className={styles.empty}>
          <strong>Zatím žádné poptávky</strong>
          <p>
            Sem patří všechno, co ještě není klient — kdo se ozval, co mu
            bylo nabídnuto, jestli z toho něco bude. Vyhraná poptávka jedním
            kliknutím založí klienta v Klientech.
          </p>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => { setEditLead(null); setComposer(true); }}>
            Zapsat první poptávku
          </button>
        </div>
      ) : (
        <div className={`${styles.board} ${pending ? styles.busy : ""}`}>
          {columns.map(({ status, rows }) => (
            <section
              key={status}
              className={`${styles.column} ${dragOverStatus === status ? styles.columnDragOver : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOverStatus(status); }}
              onDragLeave={() => setDragOverStatus((s) => (s === status ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStatus(null);
                const id = e.dataTransfer.getData("text/lead-id");
                if (id) moveStatus(id, status);
              }}
            >
              <header className={styles.columnHead}>
                <span className={styles.columnName}>{LEAD_STATUS_LABEL[status]}</span>
                <span className={styles.columnCount}>{rows.length}</span>
              </header>
              <p className={styles.columnHint}>{LEAD_STATUS_HINT[status]}</p>

              <div className={styles.cards}>
                {rows.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    dragging={draggingId === lead.id}
                    highlighted={highlighted === lead.id}
                    onDragStart={() => setDraggingId(lead.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onEdit={() => { setEditLead(lead); setComposer(true); }}
                    onDelete={() => run(() => deleteLeadAction(lead.id))}
                    onConvert={() => run(() => convertLeadToClientAction(lead.id))}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {composer && (
        <Composer
          lead={editLead}
          onClose={() => { setComposer(false); setEditLead(null); }}
          onSaved={() => { setComposer(false); setEditLead(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LeadCard({
  lead,
  dragging,
  highlighted,
  onDragStart,
  onDragEnd,
  onEdit,
  onDelete,
  onConvert,
}: {
  lead: Lead;
  dragging: boolean;
  highlighted: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onConvert: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <article
      id={`lead-${lead.id}`}
      className={`${styles.card} ${dragging ? styles.cardDragging : ""} ${highlighted ? styles.cardHighlight : ""}`}
      draggable
      onDragStart={(e) => {
        onDragStart();
        e.dataTransfer.setData("text/lead-id", lead.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={onDragEnd}
    >
      <button type="button" className={styles.cardMain} onClick={onEdit} title="Upravit">
        <span className={styles.cardName}>{lead.name}</span>
        {lead.company && <span className={styles.cardCompany}>{lead.company}</span>}
        {lead.amount !== null && <span className={styles.cardAmount}>{czk(lead.amount)}</span>}
        {(lead.contact || lead.phone || lead.email) && (
          <span className={styles.cardMeta}>
            {[lead.contact, lead.phone, lead.email].filter(Boolean).join(" · ")}
          </span>
        )}
      </button>

      {lead.status === "vyhrano" && (
        lead.clientId ? (
          <span className={styles.cardClient}>→ {lead.clientName ?? "klient založen"}</span>
        ) : (
          <button type="button" className={`btn btn-sm ${styles.convertBtn}`} onClick={onConvert}>
            Založit klienta
          </button>
        )
      )}

      <div className={styles.cardFoot}>
        {confirming ? (
          <>
            <button type="button" className={`btn btn-sm ${styles.danger}`} onClick={onDelete}>Opravdu smazat</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>Nechat</button>
          </>
        ) : (
          <button type="button" className={styles.cardDelete} onClick={() => setConfirming(true)} aria-label="Smazat poptávku">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>
    </article>
  );
}

function Composer({
  lead,
  onClose,
  onSaved,
}: {
  lead: Lead | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(lead);
  const [name, setName] = useState(lead?.name ?? "");
  const [company, setCompany] = useState(lead?.company ?? "");
  const [contact, setContact] = useState(lead?.contact ?? "");
  const [email, setEmail] = useState(lead?.email ?? "");
  const [phone, setPhone] = useState(lead?.phone ?? "");
  const [amount, setAmount] = useState(lead?.amount != null ? String(lead.amount) : "");
  const [note, setNote] = useState(lead?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const parsedAmount = amount.trim() ? Number(amount.replace(/\s/g, "").replace(",", ".")) : null;
    if (amount.trim() && (parsedAmount === null || Number.isNaN(parsedAmount))) {
      setError("Částka musí být číslo.");
      return;
    }
    const form = { name, company, contact, email, phone, amount: parsedAmount, note };
    startTransition(async () => {
      const res = editing ? await updateLeadAction({ id: lead!.id, ...form }) : await createLeadAction(form);
      if (res.ok) onSaved();
      else setError(res.message);
    });
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={editing ? "Upravit poptávku" : "Nová poptávka"}>
        <header className={styles.dialogHead}>
          <h2>{editing ? "Upravit poptávku" : "Nová poptávka"}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Zavřít">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className={styles.dialogBody}>
          <label className={styles.label} htmlFor="l-name">Co poptávají</label>
          <input
            id="l-name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Vizuální identita"
            autoFocus
          />

          <div className={styles.grid2}>
            <div>
              <label className={styles.label} htmlFor="l-company">Kdo poptává</label>
              <input
                id="l-company"
                className="field"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Nová kavárna"
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="l-amount">
                Odhad částky <span className={styles.optional}>nepovinné</span>
              </label>
              <input
                id="l-amount"
                className="field"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="35000"
              />
            </div>
          </div>

          <div className={styles.grid2}>
            <div>
              <label className={styles.label} htmlFor="l-contact">Kontaktní osoba</label>
              <input
                id="l-contact"
                className="field"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Jana Nováková"
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="l-phone">Telefon</label>
              <input
                id="l-phone"
                className="field"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="777123456"
              />
            </div>
          </div>

          <label className={styles.label} htmlFor="l-email">E-mail</label>
          <input
            id="l-email"
            type="email"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jana@novakavarna.cz"
          />

          <label className={styles.label} style={{ marginTop: "var(--s5)" }} htmlFor="l-note">Poznámka</label>
          <textarea
            id="l-note"
            className="field"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nepovinné"
          />

          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>

        <footer className={styles.dialogFoot}>
          <span className={styles.spacer} />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Zrušit</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={pending || !name.trim()}>
            {pending ? "Ukládám…" : editing ? "Uložit změny" : "Uložit poptávku"}
          </button>
        </footer>
      </div>
    </div>
  );
}
