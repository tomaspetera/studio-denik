"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./shell.module.css";

const PROVOZ = [
  {
    href: "/",
    label: "Dnes",
    icon: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  },
  {
    href: "/ukoly",
    label: "Úkoly",
    icon: (
      <>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </>
    ),
  },
  {
    href: "/kalendar",
    label: "Kalendář",
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
    href: "/poptavky",
    label: "Poptávky",
    icon: (
      <>
        <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8-5.1-4.7 6.9-.8z" />
      </>
    ),
  },
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
];

const VYSTUP = [
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

  const isOn = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const render = (items: typeof PROVOZ) =>
    items.map((item) => (
      <Link
        key={item.href}
        href={item.href}
        className={`${styles.navbtn} ${isOn(item.href) ? styles.navOn : ""}`}
        aria-current={isOn(item.href) ? "page" : undefined}
      >
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
          {item.icon}
        </svg>
        <span>{item.label}</span>
      </Link>
    ));

  return (
    <>
      <nav className={styles.nav}>
        <span className={styles.navHead}>Provoz</span>
        {render(PROVOZ)}
      </nav>
      <nav className={styles.nav}>
        <span className={styles.navHead}>Výstup</span>
        {render(VYSTUP)}
      </nav>
    </>
  );
}
