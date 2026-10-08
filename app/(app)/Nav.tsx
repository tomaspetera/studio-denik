"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./shell.module.css";

type Item = {
  href: string;
  label: string;
  icon: ReactNode;
  /** Na telefonu má místo ve spodní liště. Ostatní stránky jsou tam pod „Více“. */
  bar?: boolean;
};

/**
 * Stránky, se kterými se pracuje každý den — v pořadí, v jakém se na ně
 * chodí. Na telefonu se do spodní lišty vejdou jen první čtyři a „Více“.
 */
const HLAVNI: Item[] = [
  {
    href: "/",
    label: "Dnes",
    bar: true,
    icon: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  },
  {
    href: "/tyden",
    label: "Týden",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16M15 4v16" />
      </>
    ),
  },
  {
    href: "/ukoly",
    label: "Úkoly",
    bar: true,
    icon: (
      <>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </>
    ),
  },
  {
    href: "/posta",
    label: "Pošta",
    bar: true,
    icon: (
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M22 7l-10 6L2 7" />
      </>
    ),
  },
  {
    href: "/kalendar",
    label: "Kalendář",
    bar: true,
    icon: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </>
    ),
  },
  {
    href: "/tisk",
    label: "Tisk",
    icon: (
      <>
        <path d="M6 9V2h12v7" />
        <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
        <path d="M6 14h12v8H6z" />
      </>
    ),
  },
  {
    href: "/report",
    label: "Report",
    icon: (
      <>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8M8 17h5" />
      </>
    ),
  },
];

/** Stránky, na které se chodí zřídka — jsou pod „Více“, ať nepřekážejí. */
const VICE: Item[] = [
  {
    href: "/klienti",
    label: "Klienti",
    icon: (
      <>
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
      </>
    ),
  },
  {
    href: "/poptavky",
    label: "Poptávky",
    icon: <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8-5.1-4.7 6.9-.8z" />,
  },
  {
    href: "/tym",
    label: "Tým",
    icon: (
      <>
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </>
    ),
  },
];

export default function Nav() {
  const pathname = usePathname();
  /** „Více“ rozbalené ručně. Na počítači je rozbalené i tehdy, když je člověk na některé z těch stránek. */
  const [open, setOpen] = useState(false);

  const isOn = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const link = (item: Item, extra = "") => (
    <Link
      key={item.href}
      href={item.href}
      className={`${styles.navbtn} ${isOn(item.href) ? styles.navOn : ""} ${extra}`}
      aria-current={isOn(item.href) ? "page" : undefined}
      onClick={() => setOpen(false)}
    >
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
        {item.icon}
      </svg>
      <span>{item.label}</span>
    </Link>
  );

  const mimoListu = HLAVNI.filter((i) => !i.bar);
  const uvnitrVice = VICE.some((i) => isOn(i.href));
  // Na telefonu patří pod „Více“ i stránky, které se nevešly do lišty.
  const uvnitrNaTelefonu = uvnitrVice || mimoListu.some((i) => isOn(i.href));

  return (
    <>
      <nav className={styles.nav} aria-label="Hlavní stránky">
        {HLAVNI.map((i) => link(i, i.bar ? "" : styles.navDesk))}
      </nav>

      <nav
        className={`${styles.nav} ${styles.more} ${open ? styles.moreOpen : ""} ${uvnitrVice ? styles.moreActive : ""}`}
        aria-label="Další stránky"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
        }}
      >
        <button
          type="button"
          className={`${styles.navbtn} ${styles.moreBtn} ${uvnitrNaTelefonu ? styles.moreBtnOn : ""}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5" cy="12" r="1.4" />
            <circle cx="12" cy="12" r="1.4" />
            <circle cx="19" cy="12" r="1.4" />
          </svg>
          <span>Více</span>
        </button>
        <div className={styles.moreList}>
          {mimoListu.map((i) => link(i, styles.navPhone))}
          {VICE.map((i) => link(i))}
        </div>
      </nav>
    </>
  );
}
