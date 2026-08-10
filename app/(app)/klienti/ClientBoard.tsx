"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BALL_LABEL, CLIENT_COLORS } from "@/lib/domain";
import { isValidIco, normalizeIco } from "@/lib/ares";
import type { ClientRow } from "@/lib/clients";
import { createClientAction, lookupAresAction } from "./actions";
import styles from "./clients.module.css";

export default function ClientBoard({
  clients,
  siteUrl,
}: {
  clients: ClientRow[];
  siteUrl: string;
}) {
  const router = useRouter();
  const [composer, setComposer] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

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
            {clients.length === 0 ? "Zatím žádní" : `${clients.length} aktivních`}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setComposer(true)}>
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          <span>Přidat klienta</span>
        </button>
      </header>

      {clients.length === 0 ? (
        <div className={styles.empty}>
          <strong>Zatím žádní klienti</strong>
          <p>
            Klient dává úkolům komu patří — a report se pak dá rozdělit
            po klientech, což je přesně to, co příjemce chce vidět.
          </p>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => setComposer(true)}>
            Přidat prvního klienta
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {clients.map((c) => (
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
            </article>
          ))}
        </div>
      )}

      {clients.length > 0 && (
        <p className={styles.hint}>
          Schvalovací odkaz zatím jen kopíruje adresu — stránku, kde klient
          odklikne „Schvaluji“, dodělám spolu s reportem. Klient k ní nebude
          potřebovat účet.
        </p>
      )}

      {composer && (
        <Composer
          usedColors={clients.map((c) => c.color)}
          onClose={() => setComposer(false)}
          onSaved={() => {
            setComposer(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Composer({
  usedColors,
  onClose,
  onSaved,
}: {
  usedColors: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Přednabídneme barvu, kterou ještě nikdo nemá — ať se klienti v seznamu
  // rozliší samy od sebe a uživatel to nemusí řešit.
  const firstFree = CLIENT_COLORS.find((c) => !usedColors.includes(c)) ?? CLIENT_COLORS[0];

  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(firstFree);
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [ico, setIco] = useState("");
  const [dic, setDic] = useState("");
  const [address, setAddress] = useState("");
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
    startTransition(async () => {
      const res = await createClientAction({
        name, color, contact, email, note, ico, dic, address,
      });
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
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Nový klient">
        <header className={styles.dialogHead}>
          <h2>Nový klient</h2>
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
              autoFocus
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
            {pending ? "Ukládám…" : "Uložit klienta"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getDate()}. ${d.getMonth() + 1}.`;
}
