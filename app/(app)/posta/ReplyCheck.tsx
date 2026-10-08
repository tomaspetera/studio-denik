"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { checkRepliesAction } from "./actions";

/** Jak často nejvýš se kontrola pustí — stačí, aby přehled po odpovědi nelhal. */
const ODSTUP_MS = 10 * 60 * 1000;
const KLIC = "posta-kontrola-odpovedi";

/**
 * Tichá kontrola odpovědí. Když na zprávu odpovím v Gmailu, appka se to
 * jinak dozví až při příštím načtení pošty — a do té doby by zpráva dál
 * „čekala na odpověď“. Tahle součástka se při otevření stránky zeptá Gmailu
 * jen na hlavičky vláken, která čekají, a odpovězená sama uklidí.
 *
 * Nic nekreslí. Běží nejvýš jednou za deset minut na prohlížeč a jen tehdy,
 * když něco čeká.
 */
export default function ReplyCheck({ waiting }: { waiting: number }) {
  const router = useRouter();

  useEffect(() => {
    if (waiting <= 0) return;

    let naposledy = 0;
    try {
      naposledy = Number(window.localStorage.getItem(KLIC) ?? 0);
    } catch {
      // Bez úložiště (anonymní okno) se kontrola pustí při každém otevření — nevadí.
    }
    if (Date.now() - naposledy < ODSTUP_MS) return;
    try {
      window.localStorage.setItem(KLIC, String(Date.now()));
    } catch {
      // viz výš
    }

    let zruseno = false;
    checkRepliesAction()
      .then((res) => {
        if (!zruseno && res.ok && (res.answered ?? 0) > 0) router.refresh();
      })
      .catch(() => {
        // Kontrola je jen pohodlí — když se nepovede, přehled zůstane po starém.
      });
    return () => {
      zruseno = true;
    };
  }, [waiting, router]);

  return null;
}
