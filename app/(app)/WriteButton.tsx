"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Stránky, které mají vlastní „Zapsat“ přímo u obsahu — tam by byla dvě vedle sebe. */
const VLASTNI_ZAPSAT = ["/ukoly", "/kalendar"];

/**
 * „Zapsat“ v horní liště — nový úkol odkudkoli. Na stránkách, které mají
 * vlastní tlačítko se stejným názvem, se neukazuje: jedno tlačítko na jednu věc.
 */
export default function WriteButton() {
  const pathname = usePathname();
  if (VLASTNI_ZAPSAT.some((p) => pathname.startsWith(p))) return null;

  return (
    <Link href="/ukoly?zapsat=1" className="btn btn-primary">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
      <span>Zapsat</span>
    </Link>
  );
}
