"use client";

import { useRef, useState } from "react";
import type { DateKey } from "@/lib/domain";
import type { QuickDate } from "@/lib/quick-dates";
import type { DueTone } from "@/lib/today";
import styles from "./due.module.css";

/**
 * Termín úkolu jako tlačítko — stejné na Dnes i v Úkolech. Barva říká, jak
 * moc termín tlačí; kliknutí otevře nabídku čtyř nejčastějších termínů
 * (dnes, zítra, v pátek, příští týden) a kalendář až jako další možnost.
 * Vybraný termín se rovnou ukládá, potvrzovat není co.
 */
export default function DueChip({
  taskTitle,
  dueKey,
  label,
  tone,
  today,
  quick,
  disabled = false,
  className,
  onChange,
}: {
  /** Název úkolu — jen pro čtečky obrazovky. */
  taskTitle: string;
  dueKey: string | null;
  /** „5. 10.“, „dnes“, „zítra“…; `null` = bez termínu. */
  label: string | null;
  tone: DueTone;
  /** Dnešek podle Prahy, počítaný na serveru. */
  today: DateKey;
  quick: QuickDate[];
  disabled?: boolean;
  /** Třída buňky od rodiče — umístění v řádku a zarovnání nabídky. */
  className?: string;
  /** `null` = termín z úkolu sundat. */
  onChange: (den: string | null) => void;
}) {
  const kalendar = useRef<HTMLInputElement>(null);
  /** Prohlížeč neumí otevřít kalendář sám — ukáže se obyčejné pole s datem. */
  const [rucne, setRucne] = useState(false);
  const [nabidka, setNabidka] = useState(false);

  function otevriKalendar() {
    const pole = kalendar.current;
    try {
      if (pole && typeof pole.showPicker === "function") {
        pole.showPicker();
        return;
      }
    } catch {
      // Spadne do ručního pole níž.
    }
    setRucne(true);
  }

  const zmen = (den: string | null) => {
    setRucne(false);
    setNabidka(false);
    if (den !== "" && den !== dueKey) onChange(den);
  };

  const barva = tone === "late" ? styles.late : tone === "today" ? styles.today : tone === "none" ? styles.none : "";

  return (
    // `tabIndex` kvůli prohlížečům, které tlačítku po kliknutí nedají fokus —
    // bez něj by se nabídka zavřela dřív, než se kliknutí provede. Kliknutí
    // ani klávesy se nepouštějí dál: řádek v Úkolech se jimi rozbaluje.
    <div
      className={`${styles.cell} ${className ?? ""}`}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setNabidka(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setNabidka(false);
        e.stopPropagation();
      }}
    >
      {rucne ? (
        <input
          type="date"
          className={`field ${styles.date}`}
          aria-label={`Termín úkolu ${taskTitle}`}
          defaultValue={dueKey ?? ""}
          autoFocus
          disabled={disabled}
          onChange={(e) => zmen(e.target.value)}
          onBlur={() => setRucne(false)}
        />
      ) : (
        <>
          <button
            type="button"
            className={`${styles.due} ${barva}`}
            disabled={disabled}
            title={label ? "Změnit termín" : "Dát termín"}
            aria-label={label ? `Termín ${label}, změnit` : `Dát termín úkolu ${taskTitle}`}
            aria-haspopup="menu"
            aria-expanded={nabidka}
            onClick={() => setNabidka(!nabidka)}
          >
            {label ?? "+ termín"}
          </button>

          {nabidka && (
            <div className={styles.menu} role="menu">
              {quick.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={q.key === dueKey}
                  className={q.key === dueKey ? styles.on : undefined}
                  onClick={() => zmen(q.key)}
                >
                  <span>{q.label}</span>
                  <em>{q.hint}</em>
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setNabidka(false);
                  otevriKalendar();
                }}
              >
                <span>Jiný den…</span>
              </button>
              {dueKey && (
                <button type="button" role="menuitem" className={styles.off} onClick={() => zmen(null)}>
                  <span>Bez termínu</span>
                </button>
              )}
            </div>
          )}

          {/* Neviditelné pole jen kvůli kalendáři prohlížeče — otevírá ho „Jiný den“. */}
          <input
            ref={kalendar}
            type="date"
            className={styles.native}
            tabIndex={-1}
            aria-hidden="true"
            min={today}
            defaultValue={dueKey ?? ""}
            onChange={(e) => zmen(e.target.value)}
          />
        </>
      )}
    </div>
  );
}
