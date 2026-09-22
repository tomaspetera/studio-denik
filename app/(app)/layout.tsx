import { redirect } from "next/navigation";
import Link from "next/link";
import { getWorkspace } from "@/lib/workspace";
import { signOut } from "../prihlaseni/actions";
import Nav from "./Nav";
import ThemeToggle from "./ThemeToggle";
import GlobalSearch from "./GlobalSearch";
import styles from "./shell.module.css";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");

  // Dokud databáze není připravená, nemá smysl kreslit lištu s odkazy —
  // vedly by na obrazovky, které stejně spadnou. Stránka „Dnes“ si tenhle
  // stav ošetří sama a poradí, co dodělat.
  if (ws.state !== "ready") return <>{children}</>;

  return (
    <div className={styles.app}>
      <aside className={styles.rail}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 6h16M4 12h11M4 18h7" />
            </svg>
          </span>
          <span>
            <span className={styles.brandName}>Studio Deník</span>
            <span className={styles.brandSub}>{ws.orgName}</span>
          </span>
        </div>

        <Nav />

        <div className={styles.foot}>
          <div className={styles.who}>
            <span className={styles.avatar} aria-hidden="true">{ws.initials}</span>
            <span className={styles.whoText}>
              <span className={styles.whoName}>{ws.email.split("@")[0]}</span>
              <span className={styles.whoMail}>{ws.email}</span>
            </span>
          </div>
          <form action={signOut}>
            <button type="submit" className={styles.signout}>Odhlásit</button>
          </form>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.top}>
          <div className={styles.topIn}>
            <GlobalSearch />
            <div className={styles.spacer} />
            <ThemeToggle />
            <Link href="/ukoly?zapsat=1" className="btn btn-primary">
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
              <span>Zapsat</span>
            </Link>
          </div>
        </header>
        <div className={styles.view}>{children}</div>
      </main>
    </div>
  );
}
