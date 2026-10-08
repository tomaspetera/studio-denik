"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./undo.module.css";

/** Jak dlouho nabídka „Zpět“ zůstane na obrazovce. */
const VIDET_MS = 8000;

export type UndoOffer = {
  /** Co se právě stalo: „Banner na web → Hotovo“. */
  text: string;
  /** Vrátí změnu zpátky. */
  run: () => void;
};

/**
 * „Zpět“ po změně na jedno kliknutí. Posun úkolu i termín se ukládají hned,
 * bez potvrzení — o to snáz se člověk překlikne. Místo dotazu „opravdu?“
 * u každého kliknutí se změna provede a pár vteřin jde jedním tlačítkem vrátit.
 */
export function useUndo() {
  const [offer, setOffer] = useState<(UndoOffer & { key: number }) | null>(null);
  const timer = useRef<number | null>(null);

  const stopTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  // Časovač nesmí přežít stránku, ze které člověk odešel.
  useEffect(() => stopTimer, []);

  return {
    offer,
    show(next: UndoOffer) {
      stopTimer();
      const key = Date.now();
      setOffer({ ...next, key });
      timer.current = window.setTimeout(() => setOffer((now) => (now?.key === key ? null : now)), VIDET_MS);
    },
    hide() {
      stopTimer();
      setOffer(null);
    },
  };
}

export function UndoToast({ undo, disabled }: { undo: ReturnType<typeof useUndo>; disabled?: boolean }) {
  if (!undo.offer) return null;
  const { text, run } = undo.offer;
  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <span className={styles.text}>{text}</span>
      <button
        type="button"
        className={styles.back}
        disabled={disabled}
        onClick={() => {
          undo.hide();
          run();
        }}
      >
        Zpět
      </button>
      <button type="button" className={styles.close} aria-label="Zavřít" onClick={undo.hide}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}
