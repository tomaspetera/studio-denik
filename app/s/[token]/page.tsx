import type { Metadata } from "next";
import { loadClientBoard } from "@/lib/client-board";
import ClientDesk from "./ClientDesk";
import styles from "./desk.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const board = await loadClientBoard(token);
  return {
    title: board ? `Ke schválení — ${board.org_name}` : "Schvalování",
    // Odkaz je určený jednomu klientovi, ne vyhledávačům.
    robots: { index: false, follow: false },
  };
}

export default async function ClientDeskPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const board = await loadClientBoard(token);

  if (!board) return <Unavailable />;

  return <ClientDesk token={token} board={board} />;
}

/**
 * Odkaz neplatí. Stejně jako u reportu neříkáme proč — jestli token
 * neexistuje, nebo studio klienta archivovalo. Návštěvník to nespraví
 * a rozlišování by prozrazovalo, které tokeny existují.
 */
function Unavailable() {
  return (
    <main className={styles.stage}>
      <div className={styles.gone}>
        <span aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
        </span>
        <h1>Odkaz není platný</h1>
        <p>
          Na téhle adrese nic není. Požádej o nový odkaz toho, kdo ti ho
          poslal.
        </p>
      </div>
    </main>
  );
}
