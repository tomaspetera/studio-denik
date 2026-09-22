"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchResult } from "@/lib/search";
import { globalSearchAction } from "./search-actions";
import styles from "./global-search.module.css";

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  task: "Úkoly",
  client: "Klienti",
  lead: "Poptávky",
};

/**
 * Ctrl+K (Cmd+K na Macu) odkudkoli v appce. Na rozdíl od zkratek v Úkolech
 * (N, /) funguje i uprostřed psaní jinam — přesně tak se chová Cmd+K
 * všude jinde (Linear, Notion, Slack), takže se to nemusí nikde vysvětlovat.
 */
export default function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  // Otevření resetuje stav rovnou v obsluze události, ne v efektu — jinak
  // by první vykreslení modálu na chvíli ukázalo starý dotaz z minula.
  function openPalette() {
    setQuery("");
    setResults([]);
    setActive(0);
    setOpen(true);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    // `setState` tady schválně nevolám hned v těle efektu (jen plánuji
    // časovač) — jinak by to ESLint právem hlásil jako zbytečný extra
    // vykreslovací cyklus.
    if (q.length < 2) {
      const t = setTimeout(() => { setResults([]); setLoading(false); }, 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setLoading(true);
      globalSearchAction(q).then((r) => {
        setResults(r);
        setActive(0);
        setLoading(false);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  function go(result: SearchResult) {
    setOpen(false);
    router.push(result.href);
  }

  if (!open) {
    return (
      <button type="button" className={styles.trigger} onClick={openPalette} aria-label="Hledat (Ctrl+K)">
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <span>Hledat</span>
        <kbd className={styles.kbd}>Ctrl K</kbd>
      </button>
    );
  }

  return (
    <div className={styles.backdrop} onClick={() => setOpen(false)}>
      <div
        className={styles.palette}
        role="dialog"
        aria-modal="true"
        aria-label="Hledat"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active]); }
        }}
      >
        <div className={styles.inputRow}>
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat úkol, klienta, poptávku…"
            aria-label="Hledat"
            autoFocus
          />
          <kbd className={styles.kbd}>Esc</kbd>
        </div>

        <div className={styles.results}>
          {query.trim().length < 2 ? (
            <p className={styles.hint}>Napiš aspoň dva znaky.</p>
          ) : loading ? (
            <p className={styles.hint}>Hledám…</p>
          ) : results.length === 0 ? (
            <p className={styles.hint}>Nic jsem nenašel.</p>
          ) : (
            <ul className={styles.list}>
              {results.map((r, i) => (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    type="button"
                    className={`${styles.item} ${i === active ? styles.itemActive : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r)}
                  >
                    <span className={styles.itemKind}>{KIND_LABEL[r.kind]}</span>
                    <span className={styles.itemMain}>
                      <span className={styles.itemTitle}>{r.title}</span>
                      {r.subtitle && <span className={styles.itemSubtitle}>{r.subtitle}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
