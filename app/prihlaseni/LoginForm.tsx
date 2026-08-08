"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";
import styles from "./login.module.css";

const initial: LoginState = { status: "idle" };

export default function LoginForm() {
  const [state, action, pending] = useActionState(sendMagicLink, initial);

  if (state.status === "sent") {
    return (
      <div className={styles.sent}>
        <span className={styles.check} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12l6 6L20 6" />
          </svg>
        </span>
        <h1 className={styles.h1}>Odkaz je na cestě</h1>
        <p className={styles.lead}>
          Otevři e-mail a klikni na odkaz. Platí patnáct minut a přihlásí tě
          rovnou — žádné heslo nepotřebuješ.
        </p>
        <p className={styles.hint}>
          Nedorazil? Mrkni do spamu, nebo <a href="/prihlaseni">zkus jinou adresu</a>.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className={styles.form}>
      <h1 className={styles.h1}>Přihlášení</h1>
      <p className={styles.lead}>
        Zadej e-mail a pošleme ti přihlašovací odkaz. Hesla tu nejsou —
        není co zapomenout ani co ukrást.
      </p>

      <label className={styles.label} htmlFor="email">
        E-mail
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        autoFocus
        placeholder="petr@studiodenik.cz"
        className="field"
        aria-describedby={state.status === "error" ? "login-error" : undefined}
      />

      {state.status === "error" && (
        <p id="login-error" role="alert" className={styles.error}>
          {state.message}
        </p>
      )}

      <button type="submit" className="btn btn-primary btn-lg" disabled={pending}>
        {pending ? "Odesílám…" : "Poslat odkaz"}
      </button>
    </form>
  );
}
