"use client";

import styles from "./shell.module.css";

/**
 * Přepínač světlého a tmavého režimu.
 *
 * Nedrží si stav v Reactu schválně. Motiv je uložený v prohlížeči a nastavuje
 * ho skript v hlavičce dřív, než se vykreslí první pixel — kdyby ho komponenta
 * četla až po připojení, tmavý režim by při načtení problikl bíle a vzniklo by
 * rozdílné vykreslení mezi serverem a prohlížečem.
 *
 * Vykreslíme tedy obě ikony a tu správnou vybere CSS podle `data-theme`.
 */
export default function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const dark =
      root.dataset.theme === "dark" ||
      (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);

    root.dataset.theme = dark ? "light" : "dark";
    localStorage.setItem("theme", dark ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`btn btn-ghost ${styles.themeBtn}`}
      aria-label="Přepnout světlý nebo tmavý režim"
      title="Světlý / tmavý režim"
    >
      <svg className={styles.iconSun} viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg className={styles.iconMoon} viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round">
        <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
      </svg>
    </button>
  );
}
