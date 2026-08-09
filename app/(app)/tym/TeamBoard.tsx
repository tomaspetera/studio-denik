"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROLE_HINT, ROLE_LABEL, ROLES, type Role } from "@/lib/domain";
import type { Invite, Member } from "@/lib/team";
import {
  inviteAction,
  revokeAction,
  changeRoleAction,
  removeMemberAction,
} from "./actions";
import styles from "./team.module.css";

export default function TeamBoard({
  orgName,
  members,
  invites,
  amAdmin,
}: {
  orgName: string;
  members: Member[];
  invites: Invite[];
  amAdmin: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function invite() {
    setError(null);
    setSent(null);
    startTransition(async () => {
      const res = await inviteAction(email, role);
      if (res.ok) {
        setSent(email.trim().toLowerCase());
        setEmail("");
        router.refresh();
      } else {
        setError(res.message);
      }
    });
  }

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.message ?? "Nepodařilo se to.");
      setConfirmRemove(null);
      router.refresh();
    });
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Tým</h1>
          <p className={styles.sub}>
            {orgName} · {members.length}{" "}
            {members.length === 1 ? "člověk" : members.length <= 4 ? "lidé" : "lidí"}
            {invites.length > 0 && ` · ${invites.length} čeká na přihlášení`}
          </p>
        </div>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}

      {amAdmin && (
        <section className={styles.inviteCard}>
          <h2 className={styles.cardTitle}>Pozvat kolegu</h2>
          <p className={styles.lead}>
            Zadej e-mail. Až se na něj kolega poprvé přihlásí — stejným
            odkazem jako ty — rovnou skončí tady v týmu. Žádný zvláštní
            odkaz ani heslo nepotřebuje.
          </p>

          <div className={styles.inviteRow}>
            <input
              type="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && email.trim() && invite()}
              placeholder="jana@studiodenik.cz"
              aria-label="E-mail kolegy"
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={invite}
              disabled={pending || !email.trim()}
            >
              {pending ? "Zvu…" : "Pozvat"}
            </button>
          </div>

          <div className={styles.roles}>
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`${styles.role} ${role === r ? styles.roleOn : ""}`}
              >
                <b>{ROLE_LABEL[r]}</b>
                <span>{ROLE_HINT[r]}</span>
              </button>
            ))}
          </div>

          {sent && (
            <p className={styles.sent}>
              Pozvánka pro <b>{sent}</b> je připravená. Řekni mu, ať se
              přihlásí na téhle adrese — víc není potřeba.
            </p>
          )}
        </section>
      )}

      <section className="panel">
        <header className={styles.panelHead}>
          <h2>V týmu</h2>
          <span className={styles.note}>{members.length}</span>
        </header>
        <ul className={styles.list}>
          {members.map((m) => (
            <li key={m.userId}>
              <span className={styles.avatar} aria-hidden="true">
                {m.initials ?? "?"}
              </span>
              <span className={styles.who}>
                <span className={styles.name}>
                  {m.fullName ?? m.email ?? "bez jména"}
                  {m.isMe && <em className={styles.me}>ty</em>}
                </span>
                <span className={styles.mail}>{m.email}</span>
              </span>

              {amAdmin && !m.isMe ? (
                <span className={styles.controls}>
                  <select
                    className={styles.select}
                    value={m.role}
                    onChange={(e) => run(() => changeRoleAction(m.userId, e.target.value as Role))}
                    disabled={pending}
                    aria-label={`Role pro ${m.email}`}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>

                  {confirmRemove === m.userId ? (
                    <>
                      <button
                        type="button"
                        className={`btn btn-sm ${styles.danger}`}
                        onClick={() => run(() => removeMemberAction(m.userId))}
                        disabled={pending}
                      >
                        Opravdu odebrat
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => setConfirmRemove(null)}
                      >
                        Nechat
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setConfirmRemove(m.userId)}
                    >
                      Odebrat
                    </button>
                  )}
                </span>
              ) : (
                <span className={`pill ${toneOf(m.role)}`}>{ROLE_LABEL[m.role]}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {amAdmin && invites.length > 0 && (
        <section className="panel" style={{ marginTop: "var(--s5)" }}>
          <header className={styles.panelHead}>
            <h2>Čeká na první přihlášení</h2>
            <span className={styles.note}>{invites.length}</span>
          </header>
          <ul className={styles.list}>
            {invites.map((i) => (
              <li key={i.id}>
                <span className={`${styles.avatar} ${styles.avatarPending}`} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </span>
                <span className={styles.who}>
                  <span className={styles.name}>{i.email}</span>
                  <span className={styles.mail}>
                    {ROLE_LABEL[i.role]} · platí do {formatDate(i.expiresAt)}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => run(() => revokeAction(i.id))}
                  disabled={pending}
                >
                  Zrušit
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!amAdmin && (
        <p className={styles.hint}>
          Tým může měnit jen správce. Kdybys potřeboval pozvat kolegu,
          požádej někoho, kdo má správcovská práva.
        </p>
      )}
    </div>
  );
}

function toneOf(role: Role): string {
  return role === "admin" ? "o-me" : role === "member" ? "o-done" : "o-flat";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
}
