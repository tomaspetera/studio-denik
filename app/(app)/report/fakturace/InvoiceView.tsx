"use client";

import { useState } from "react";
import Link from "next/link";
import { invoiceText, type InvoiceBasis } from "@/lib/invoice";
import styles from "./invoice.module.css";

/**
 * Podklad pro fakturaci — viz `lib/invoice.ts`. Seznam práce uzavřené za
 * měsíc po klientech; text jde zkopírovat celý, nebo jen za jednoho klienta.
 * Ceny ani hodiny tu nejsou — appka je neeviduje.
 */
export default function InvoiceView({ basis, isCurrent }: { basis: InvoiceBasis; isCurrent: boolean }) {
  /** Co se naposledy zkopírovalo: "" = celý měsíc, jinak id klienta ("-" = bez klienta). */
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copy(klic: string, text: string) {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(klic);
      setTimeout(() => setCopied((c) => (c === klic ? null : c)), 2500);
    } catch {
      setError("Text se nepodařilo zkopírovat — prohlížeč zápis do schránky nepovolil.");
    }
  }

  const ukolu = (n: number) => (n === 1 ? "1 úkol" : n >= 2 && n <= 4 ? `${n} úkoly` : `${n} úkolů`);

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Podklad pro fakturaci</h1>
          <p className={styles.sub}>
            {basis.label} · {basis.total === 0 ? "nic uzavřeného" : `uzavřeno ${ukolu(basis.total)}`}
          </p>
        </div>
        <div className={styles.tools}>
          <Link href={`/report/fakturace?mesic=${basis.prev}`} className="btn" aria-label="Předchozí měsíc" title="Předchozí měsíc">
            <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
          </Link>
          {!isCurrent && <Link href="/report/fakturace" className="btn">Tento měsíc</Link>}
          <Link href={`/report/fakturace?mesic=${basis.next}`} className="btn" aria-label="Další měsíc" title="Další měsíc">
            <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
          </Link>
          {basis.total > 0 && (
            <button type="button" className="btn btn-primary" onClick={() => copy("", invoiceText(basis))}>
              {copied === "" ? "Zkopírováno" : "Kopírovat vše"}
            </button>
          )}
        </div>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}

      {basis.groups.length === 0 ? (
        <p className={`panel ${styles.empty}`}>V tomhle měsíci se neuzavřel žádný úkol.</p>
      ) : (
        basis.groups.map((g) => {
          const klic = g.clientId ?? "-";
          return (
            <section key={klic} className={`panel ${styles.group}`}>
              <header className={styles.groupHead}>
                <i style={g.color ? { background: g.color } : undefined} aria-hidden="true" />
                <h2>{g.client}</h2>
                <em>{ukolu(g.items.length)}</em>
                <button type="button" className="btn btn-sm" onClick={() => copy(klic, invoiceText(basis, g.clientId))}>
                  {copied === klic ? "Zkopírováno" : "Kopírovat"}
                </button>
              </header>
              <ul className={styles.list}>
                {g.items.map((t) => (
                  <li key={t.id}>
                    <span className={styles.date}>{t.closedLabel}</span>
                    <Link href={`/ukoly?otevrit=${t.id}`} className={styles.title} title="Otevřít úkol">{t.title}</Link>
                    <span className={styles.size}>{t.size}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      <p className={styles.foot}>
        Počítá se den, kdy byl úkol uzavřen. Ceny ani hodiny tu nejsou — appka je neeviduje;
        velikost úkolu (malý, střední, velký) je jen vodítko. <Link href="/report">Zpět na report</Link>
      </p>
    </div>
  );
}
