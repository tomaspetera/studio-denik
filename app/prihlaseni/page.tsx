import { isSupabaseConfigured } from "@/lib/supabase/server";
import LoginForm from "./LoginForm";
import styles from "./login.module.css";

export default function LoginPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className={styles.stage}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 6h16M4 12h11M4 18h7" />
            </svg>
          </span>
          <span>
            <span className={styles.name}>Studio Deník</span>
            <span className={styles.sub}>Týdenní reporty a hlídání zakázek</span>
          </span>
        </div>

        {configured ? (
          <LoginForm />
        ) : (
          <div className={styles.setup}>
            <h1 className={styles.h1}>Ještě chybí nastavení</h1>
            <p className={styles.lead}>
              Aplikace nemá přístup k databázi. Zkopíruj <code>.env.local.example</code>{" "}
              jako <code>.env.local</code>, vyplň hodnoty ze Supabase a restartuj server.
            </p>
            <ol className={styles.steps}>
              <li>
                <b>Supabase → Project Settings → API Keys</b>
                <span>Zkopíruj Project URL, anon klíč a service_role klíč.</span>
              </li>
              <li>
                <b>Supabase → SQL Editor</b>
                <span>
                  Spusť <code>supabase/migrations/0001_schema.sql</code> — vytvoří
                  tabulky i přístupová práva.
                </span>
              </li>
              <li>
                <b>Authentication → URL Configuration</b>
                <span>
                  Do <i>Redirect URLs</i> přidej <code>{"{adresa}"}/auth/callback</code>,
                  jinak odkaz z e-mailu skončí chybou.
                </span>
              </li>
            </ol>
          </div>
        )}
      </div>
    </main>
  );
}
