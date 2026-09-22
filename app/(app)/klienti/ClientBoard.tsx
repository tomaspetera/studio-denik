"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BALL_LABEL, CLIENT_COLORS } from "@/lib/domain";
import { isValidIco, normalizeIco } from "@/lib/ares";
import type { ClientRow } from "@/lib/clients";
import type { ClientContact } from "@/lib/client-contacts";
import {
  createClientAction,
  updateClientAction,
  lookupAresAction,
  archiveClientAction,
  unarchiveClientAction,
  deleteClientAction,
  createClientContactAction,
  updateClientContactAction,
  deleteClientContactAction,
} from "./actions";
import styles from "./clients.module.css";

/** Pár typických hodnot do rychlé volby — pole samotné je volný text. */
const RELATIONSHIP_PRESETS = ["Stálý klient", "Jednorázová zakázka", "Nový klient"];

export default function ClientBoard({
  clients,
  contactsByClient,
  siteUrl,
}: {
  clients: ClientRow[];
  contactsByClient: Record<string, ClientContact[]>;
  siteUrl: string;
}) {
  const router = useRouter();
  const [composer, setComposer] = useState(false);
  const [editClient, setEditClient] = useState<ClientRow | null>(null);
  const [contactsFor, setContactsFor] = useState<ClientRow | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const active = clients.filter((c) => !c.archived);
  const archived = clients.filter((c) => c.archived);
  const shown = showArchived ? archived : active;

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.message ?? "Nepodařilo se to.");
      setConfirmDelete(null);
      router.refresh();
    });
  }

  async function copyLink(token: string) {
    const base = siteUrl || window.location.origin;
    try {
      await navigator.clipboard.writeText(`${base}/s/${token}`);
      setCopied(token);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Klienti</h1>
          <p className={styles.sub}>
            {active.length === 0 ? "Zatím žádní" : `${active.length} aktivních`}
            {archived.length > 0 && ` · ${archived.length} v archivu`}
          </p>
        </div>
        <div className={styles.headActs}>
          {archived.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => setShowArchived(!showArchived)}
            >
              {showArchived ? "Zpět na aktivní" : `Archiv (${archived.length})`}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => { setEditClient(null); setComposer(true); }}>
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            <span>Přidat klienta</span>
          </button>
        </div>
      </header>

      {error && <p className={styles.topError} role="alert">{error}</p>}

      {showArchived ? (
        <div className={styles.grid}>
          {archived.map((c) => (
            <article key={c.id} className={`${styles.card} ${styles.cardArchived}`}>
              <header className={styles.cardHead}>
                <span className={styles.swatch} style={{ background: c.color }} aria-hidden="true" />
                <span className={styles.nameBlock}>
                  <span className={styles.name}>{c.name}</span>
                  <span className={styles.ident}>
                    {c.ico && <span className="mono">IČO {c.ico}</span>}
                    {c.ico && (c.active + c.closed > 0) && " · "}
                    {c.active + c.closed > 0 && `${c.active + c.closed} úkolů v historii`}
                  </span>
                </span>
              </header>
              <footer className={styles.actions}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => run(() => unarchiveClientAction(c.id))}
                  disabled={pending}
                >
                  Vrátit mezi aktivní
                </button>
              </footer>
            </article>
          ))}
        </div>
      ) : clients.length === 0 ? (
        <div className={styles.empty}>
          <strong>Zatím žádní klienti</strong>
          <p>
            Klient dává úkolům komu patří — a report se pak dá rozdělit
            po klientech, což je přesně to, co příjemce chce vidět.
          </p>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => { setEditClient(null); setComposer(true); }}>
            Přidat prvního klienta
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {shown.map((c) => {
            const contacts = contactsByClient[c.id] ?? [];
            return (
              <article key={c.id} className={styles.card}>
                <header className={styles.cardHead}>
                  <span className={styles.swatch} style={{ background: c.color }} aria-hidden="true" />
                  <span className={styles.nameBlock}>
                    <span className={styles.name}>{c.name}</span>
                    {(c.ico || c.address) && (
                      <span className={styles.ident}>
                        {c.ico && <span className="mono">IČO {c.ico}</span>}
                        {c.ico && c.address && " · "}
                        {c.address}
                      </span>
                    )}
                    {c.relationship && <span className={`tag ${styles.relTag}`}>{c.relationship}</span>}
                  </span>
                </header>

                <dl className={styles.rows}>
                  <div>
                    <dt>Otevřené úkoly</dt>
                    <dd>{c.active}</dd>
                  </div>
                  <div>
                    <dt>Uzavřeno</dt>
                    <dd>{c.closed}</dd>
                  </div>
                  <div>
                    <dt>Nejbližší termín</dt>
                    <dd>{formatDate(c.nextDue) || "—"}</dd>
                  </div>
                  <div>
                    <dt>Míč u koho</dt>
                    <dd>
                      {c.late > 0 ? (
                        <span className="pill o-alarm">{c.late} po termínu</span>
                      ) : c.ball ? (
                        <span className={`pill o-${c.ball}`}>{BALL_LABEL[c.ball]}</span>
                      ) : (
                        <span className="pill o-flat">nic neběží</span>
                      )}
                    </dd>
                  </div>
                </dl>

                <footer className={styles.link}>
                  <code>/s/{c.share_token.slice(0, 10)}…</code>
                  <button type="button" className="btn btn-sm" onClick={() => copyLink(c.share_token)}>
                    {copied === c.share_token ? "Zkopírováno" : "Kopírovat"}
                  </button>
                </footer>

                <div className={styles.actions}>
                  {confirmDelete === c.id ? (
                    <>
                      <p className={styles.warn}>
                        {c.active + c.closed > 0
                          ? `Klient má ${c.active + c.closed} úkolů. Úkoly zůstanou, ale přestanou vědět, komu patřily — v příštím reportu se přesunou mezi interní. Chceš spíš archivovat?`
                          : "Klient nemá žádné úkoly, takže se nic dalšího neztratí."}
                      </p>
                      <div className={styles.actionRow}>
                        <button
                          type="button"
                          className={`btn btn-sm ${styles.danger}`}
                          onClick={() => run(() => deleteClientAction(c.id))}
                          disabled={pending}
                        >
                          Opravdu smazat
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => setConfirmDelete(null)}
                        >
                          Nechat
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className={styles.actionRow}>
                      <button type="button" className="btn btn-sm" onClick={() => { setEditClient(c); setComposer(true); }}>
                        Upravit
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setContactsFor(c)}>
                        Kontakty{contacts.length > 0 ? ` (${contacts.length})` : ""}
                      </button>
                      {/* Archivace je u klienta s historií rozumnější volba,
                          proto stojí před mazáním. */}
                      {c.active + c.closed > 0 && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => run(() => archiveClientAction(c.id))}
                          disabled={pending}
                          title="Zmizí ze seznamů, ale historie zůstane"
                        >
                          Archivovat
                        </button>
                      )}
                      <span className={styles.actionSpacer} />
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => setConfirmDelete(c.id)}
                      >
                        Smazat
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {clients.length > 0 && (
        <p className={styles.hint}>
          Schvalovací odkaz pošli klientovi. Uvidí na něm, co čeká na jeho
          slovo, a buď to schválí — úkol se posune sám — nebo napíše
          připomínky a úkol se vrátí na „Dělám“. Účet k tomu nepotřebuje.
          Archivovanému klientovi odkaz přestane platit.
        </p>
      )}

      {composer && (
        <Composer
          client={editClient}
          usedColors={clients.filter((c) => c.id !== editClient?.id).map((c) => c.color)}
          onClose={() => { setComposer(false); setEditClient(null); }}
          onSaved={() => {
            setComposer(false);
            setEditClient(null);
            router.refresh();
          }}
        />
      )}

      {contactsFor && (
        <ContactsDialog
          client={contactsFor}
          contacts={contactsByClient[contactsFor.id] ?? []}
          onClose={() => setContactsFor(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Zakládání i úprava v jednom — stejný důvod jako u Composeru v Úkolech:
 * dvě skoro stejné obrazovky by se dřív nebo později rozešly. Doteď appka
 * uměla klienta jen založit, archivovat nebo smazat; překlep v jméně nebo
 * dodatečné doplnění typu spolupráce nešlo opravit vůbec.
 */
function Composer({
  client,
  usedColors,
  onClose,
  onSaved,
}: {
  client: ClientRow | null;
  usedColors: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(client);
  // Přednabídneme barvu, kterou ještě nikdo nemá — ať se klienti v seznamu
  // rozliší samy od sebe a uživatel to nemusí řešit.
  const firstFree = CLIENT_COLORS.find((c) => !usedColors.includes(c)) ?? CLIENT_COLORS[0];

  const [name, setName] = useState(client?.name ?? "");
  const [color, setColor] = useState<string>(client?.color ?? firstFree);
  const [contact, setContact] = useState(client?.contact ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [note, setNote] = useState(client?.note ?? "");
  const [ico, setIco] = useState(client?.ico ?? "");
  const [dic, setDic] = useState(client?.dic ?? "");
  const [address, setAddress] = useState(client?.address ?? "");
  const [relationship, setRelationship] = useState(client?.relationship ?? "");
  const [error, setError] = useState<string | null>(null);
  const [aresNote, setAresNote] = useState<string | null>(null);
  const [aresErr, setAresErr] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [pending, startTransition] = useTransition();

  // Tlačítko má smysl zpřístupnit až u čísla, které vůbec může existovat.
  const icoUsable = isValidIco(ico);

  async function lookup() {
    setAresErr(null);
    setAresNote(null);
    setLooking(true);
    try {
      const res = await lookupAresAction(ico);
      if (!res.ok) {
        setAresErr(res.message);
        return;
      }
      // Ručně vyplněné jméno nepřepisujeme — mohl sis ho schválně zkrátit.
      setIco(res.company.ico);
      if (!name.trim()) setName(res.company.name);
      if (res.company.dic) setDic(res.company.dic);
      if (res.company.address) setAddress(res.company.address);
      setAresNote(
        name.trim() && name.trim() !== res.company.name
          ? `V rejstříku: ${res.company.name}. Tvoje jméno jsem nechal.`
          : "Načteno z rejstříku. Cokoliv můžeš přepsat.",
      );
    } finally {
      setLooking(false);
    }
  }

  function save() {
    setError(null);
    const form = { name, color, contact, email, note, ico, dic, address, relationship };
    startTransition(async () => {
      const res = editing
        ? await updateClientAction({ id: client!.id, ...form })
        : await createClientAction(form);
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
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={editing ? "Upravit klienta" : "Nový klient"}>
        <header className={styles.dialogHead}>
          <h2>{editing ? "Upravit klienta" : "Nový klient"}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Zavřít">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className={styles.dialogBody}>
          <label className={styles.label} htmlFor="c-ico">
            IČO <span className={styles.optional}>nepovinné</span>
          </label>
          <div className={styles.icoRow}>
            <input
              id="c-ico"
              className="field"
              inputMode="numeric"
              value={ico}
              onChange={(e) => { setIco(e.target.value); setAresErr(null); setAresNote(null); }}
              onBlur={() => ico.trim() && setIco(normalizeIco(ico))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && icoUsable && !looking) {
                  e.preventDefault();
                  lookup();
                }
              }}
              placeholder="27604977"
              aria-describedby="c-ico-hint"
              autoFocus={!editing}
            />
            <button
              type="button"
              className="btn"
              onClick={lookup}
              disabled={!icoUsable || looking}
            >
              {looking ? "Hledám…" : "Načíst z ARESu"}
            </button>
          </div>
          <p id="c-ico-hint" className={styles.hintSmall}>
            Zadej IČO a zbytek se doplní sám. Nemá-li klient IČO — třeba fyzická
            osoba — nech pole prázdné a vyplň údaje ručně.
          </p>

          {aresErr && <p className={styles.aresErr} role="alert">{aresErr}</p>}
          {aresNote && <p className={styles.aresOk}>{aresNote}</p>}

          <label className={styles.label} style={{ marginTop: "var(--s5)" }} htmlFor="c-name">
            Jméno
          </label>
          <input
            id="c-name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pekárna U Lípy"
            autoFocus={editing}
          />

          <span className={styles.label} style={{ marginTop: "var(--s5)" }}>Barva</span>
          <div className={styles.colors}>
            {CLIENT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`${styles.color} ${color === c ? styles.colorOn : ""}`}
                style={{ background: c }}
                aria-label={`Barva ${c}`}
                aria-pressed={color === c}
              />
            ))}
          </div>

          <label className={styles.label} style={{ marginTop: "var(--s5)" }} htmlFor="c-rel">
            Typ spolupráce <span className={styles.optional}>nepovinné</span>
          </label>
          <div className={styles.presetRow}>
            {RELATIONSHIP_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={`${styles.preset} ${relationship === p ? styles.presetOn : ""}`}
                onClick={() => setRelationship(relationship === p ? "" : p)}
              >
                {p}
              </button>
            ))}
          </div>
          <input
            id="c-rel"
            className="field"
            style={{ marginTop: "var(--s2)" }}
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            placeholder="Vlastní popisek…"
          />

          <div className={styles.grid2}>
            <div>
              <label className={styles.label} htmlFor="c-contact">Kontaktní osoba</label>
              <input
                id="c-contact"
                className="field"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Jana Nováková"
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="c-email">E-mail</label>
              <input
                id="c-email"
                type="email"
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jana@pekarna.cz"
              />
            </div>
          </div>

          <div className={styles.grid2}>
            <div>
              <label className={styles.label} htmlFor="c-dic">DIČ</label>
              <input
                id="c-dic"
                className="field"
                value={dic}
                onChange={(e) => setDic(e.target.value)}
                placeholder="CZ27604977"
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="c-addr">Sídlo</label>
              <input
                id="c-addr"
                className="field"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Ulice 1, 110 00 Praha"
              />
            </div>
          </div>

          <label className={styles.label} style={{ marginTop: "var(--s5)" }} htmlFor="c-note">
            Poznámka
          </label>
          <input
            id="c-note"
            className="field"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nepovinné"
          />

          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>

        <footer className={styles.dialogFoot}>
          <span className={styles.spacer} />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Zrušit</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={save}
            disabled={pending || !name.trim()}
          >
            {pending ? "Ukládám…" : editing ? "Uložit změny" : "Uložit klienta"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kontakty klienta                                                    */
/* ------------------------------------------------------------------ */

function ContactsDialog({
  client,
  contacts,
  onClose,
  onChanged,
}: {
  client: ClientRow;
  contacts: ClientContact[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(contacts.length === 0);
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={`Kontakty — ${client.name}`}>
        <header className={styles.dialogHead}>
          <h2>Kontakty — {client.name}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Zavřít">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className={styles.dialogBody}>
          <p className={styles.hintSmall} style={{ marginTop: 0 }}>
            Vedle hlavního kontaktu na kartě klienta sem patří další lidé,
            se kterými se komunikuje — grafik na jejich straně, marketing,
            účetní…
          </p>

          {error && <p className={styles.error} role="alert">{error}</p>}

          {contacts.length > 0 && (
            <ul className={styles.contactList}>
              {contacts.map((ct) => (
                <ContactRow key={ct.id} contact={ct} onError={setError} onChanged={onChanged} />
              ))}
            </ul>
          )}

          {adding ? (
            <ContactForm
              clientId={client.id}
              onError={setError}
              onDone={() => { setAdding(false); onChanged(); }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button type="button" className="btn" style={{ marginTop: "var(--s4)" }} onClick={() => { setAdding(true); setError(null); }}>
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
              <span>Přidat kontakt</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactRow({
  contact,
  onError,
  onChanged,
}: {
  contact: ClientContact;
  onError: (m: string | null) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    onError(null);
    setBusy(true);
    const res = await deleteClientContactAction(contact.id);
    setBusy(false);
    if (!res.ok) onError(res.message ?? "Nepodařilo se to.");
    else onChanged();
  }

  if (editing) {
    return (
      <li>
        <ContactForm
          initial={contact}
          onError={onError}
          onDone={() => { setEditing(false); onChanged(); }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className={styles.contactRow}>
      <button type="button" className={styles.contactMain} onClick={() => setEditing(true)} title="Upravit">
        <span className={styles.contactName}>
          {contact.name}
          {contact.role && <em> · {contact.role}</em>}
        </span>
        <span className={styles.contactMeta}>
          {contact.phone}
          {contact.phone && contact.email && " · "}
          {contact.email}
        </span>
      </button>
      <button type="button" className={styles.sheetDelete} disabled={busy} aria-label="Smazat kontakt" onClick={remove}>
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </li>
  );
}

function ContactForm({
  clientId,
  initial,
  onError,
  onDone,
  onCancel,
}: {
  /** Jen pro založení nového kontaktu — při úpravě (`initial` je zadané) se nepoužije. */
  clientId?: string;
  initial?: ClientContact;
  onError: (m: string | null) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    onError(null);
    setSaving(true);
    const res = initial
      ? await updateClientContactAction({ id: initial.id, name, role, phone, email })
      : await createClientContactAction({ clientId: clientId!, name, role, phone, email });
    setSaving(false);
    if (!res.ok) onError(res.message ?? "Nepodařilo se to.");
    else onDone();
  }

  return (
    <div className={styles.contactForm}>
      <div className={styles.grid2}>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jméno" autoFocus />
        <input className="field" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Funkce (nepovinné)" />
      </div>
      <div className={styles.grid2}>
        <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefon" />
        <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" />
      </div>
      <div className={styles.formActs}>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving || !name.trim()} onClick={save}>
          {saving ? "Ukládám…" : "Uložit"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Zrušit</button>
      </div>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getDate()}. ${d.getMonth() + 1}.`;
}
