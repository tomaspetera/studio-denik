"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROLE_HINT, ROLE_LABEL, ROLES, csDateFromKey, todayKeyPrague, type DateKey, type Role } from "@/lib/domain";
import type { Invite, Member } from "@/lib/team";
import type { CapacityRow } from "@/lib/capacity";
import type { Absence } from "@/lib/absences";
import {
  inviteAction,
  revokeAction,
  changeRoleAction,
  removeMemberAction,
  createAbsenceAction,
  deleteAbsenceAction,
} from "./actions";
import styles from "./team.module.css";

export default function TeamBoard({
  orgName,
  members,
  invites,
  amAdmin,
  capacity,
  absences,
}: {
  orgName: string;
  members: Member[];
  invites: Invite[];
  amAdmin: boolean;
  capacity: CapacityRow[];
  absences: Absence[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [addingAbsence, setAddingAbsence] = useState(false);
  const [pending, startTransition] = useTransition();

  const canEdit = members.some((m) => m.isMe && (m.role === "admin" || m.role === "member"));
  const capacityByUser = new Map(capacity.map((c) => [c.userId, c]));
  const maxLoad = Math.max(1, ...capacity.map((c) => c.loadSize));
  const today = todayKeyPrague();
  const upcoming = absences.filter((a) => a.to >= today).sort((a, b) => a.from.localeCompare(b.from));
  const past = absences.filter((a) => a.to < today);

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
          {members.map((m) => {
            const cap = capacityByUser.get(m.userId);
            return (
              <li key={m.userId}>
                <span className={styles.avatar} aria-hidden="true">
                  {m.initials ?? "?"}
                </span>
                <span className={styles.who}>
                  <span className={styles.name}>
                    {m.fullName ?? m.email ?? "bez jména"}
                    {m.isMe && <em className={styles.me}>ty</em>}
                    {cap?.absentToday && (
                      <em className={styles.away} title={cap.absentUntil ? `Do ${csDateFromKey(cap.absentUntil)}` : undefined}>
                        pryč
                      </em>
                    )}
                  </span>
                  <span className={styles.mail}>{m.email}</span>
                  {cap && (cap.openCount > 0 || cap.loadSize > 0) && (
                    <span className={styles.capRow} title="Otevřené úkoly podle velikosti — bez ohledu na hodiny">
                      <span className={styles.capBarTrack}>
                        <span className={styles.capBarFill} style={{ width: `${(cap.loadSize / maxLoad) * 100}%` }} />
                      </span>
                      <span className={styles.capCount}>{cap.openCount} {cap.openCount === 1 ? "úkol" : cap.openCount < 5 ? "úkoly" : "úkolů"}</span>
                    </span>
                  )}
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
            );
          })}
        </ul>
      </section>

      <section className="panel" style={{ marginTop: "var(--s5)" }}>
        <header className={styles.panelHead}>
          <h2>Nepřítomnost</h2>
          <span className={styles.note}>{upcoming.length}</span>
        </header>

        {upcoming.length === 0 && !addingAbsence ? (
          <p className={styles.absenceEmpty}>Nikdo nemá zapsanou dovolenou ani volno dopředu.</p>
        ) : (
          <ul className={styles.list}>
            {upcoming.map((a) => (
              <AbsenceRow key={a.id} absence={a} members={members} canEdit={canEdit} onDeleted={() => router.refresh()} onError={setError} />
            ))}
          </ul>
        )}

        {canEdit && (
          addingAbsence ? (
            <AbsenceForm
              members={members}
              onError={setError}
              onDone={() => { setAddingAbsence(false); router.refresh(); }}
              onCancel={() => setAddingAbsence(false)}
            />
          ) : (
            <div className={styles.absenceAddRow}>
              <button type="button" className="btn btn-sm" onClick={() => { setAddingAbsence(true); setError(null); }}>
                <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                <span>Zapsat nepřítomnost</span>
              </button>
            </div>
          )
        )}

        {past.length > 0 && (
          <details className={styles.pastAbsences}>
            <summary>{past.length} {past.length === 1 ? "minulá" : past.length < 5 ? "minulé" : "minulých"}</summary>
            <ul className={styles.list}>
              {past.map((a) => (
                <AbsenceRow key={a.id} absence={a} members={members} canEdit={canEdit} onDeleted={() => router.refresh()} onError={setError} />
              ))}
            </ul>
          </details>
        )}
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

/* ------------------------------------------------------------------ */

function AbsenceRow({
  absence,
  members,
  canEdit,
  onDeleted,
  onError,
}: {
  absence: Absence;
  members: Member[];
  canEdit: boolean;
  onDeleted: () => void;
  onError: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const who = members.find((m) => m.userId === absence.userId);

  async function remove() {
    onError(null);
    setBusy(true);
    const res = await deleteAbsenceAction(absence.id);
    setBusy(false);
    if (!res.ok) onError(res.message ?? "Nepodařilo se to.");
    else onDeleted();
  }

  return (
    <li>
      <span className={styles.avatar} aria-hidden="true">{who?.initials ?? "?"}</span>
      <span className={styles.who}>
        <span className={styles.name}>{who?.fullName ?? who?.email ?? "Někdo"}</span>
        <span className={styles.mail}>
          {absence.from === absence.to ? csDateFromKey(absence.from) : `${csDateFromKey(absence.from)} – ${csDateFromKey(absence.to)}`}
          {absence.note && ` · ${absence.note}`}
        </span>
      </span>
      {canEdit && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={remove} disabled={busy}>
          Smazat
        </button>
      )}
    </li>
  );
}

function AbsenceForm({
  members,
  onError,
  onDone,
  onCancel,
}: {
  members: Member[];
  onError: (m: string | null) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const today = todayKeyPrague();
  const [userId, setUserId] = useState(members.find((m) => m.isMe)?.userId ?? members[0]?.userId ?? "");
  const [from, setFrom] = useState<DateKey>(today);
  const [to, setTo] = useState<DateKey>(today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    onError(null);
    setSaving(true);
    const res = await createAbsenceAction({ userId, from, to, note });
    setSaving(false);
    if (!res.ok) onError(res.message ?? "Nepodařilo se to.");
    else onDone();
  }

  return (
    <div className={styles.absenceForm}>
      <select className="field" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Kdo je pryč">
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>{m.fullName ?? m.email}</option>
        ))}
      </select>
      <div className={styles.absenceDates}>
        <label>
          <span>Od</span>
          <input className="field" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span>Do</span>
          <input className="field" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Poznámka (nepovinné)" />
      <div className={styles.absenceFormActs}>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving || !userId} onClick={save}>
          {saving ? "Ukládám…" : "Uložit"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Zrušit</button>
      </div>
    </div>
  );
}

function toneOf(role: Role): string {
  return role === "admin" ? "o-me" : role === "member" ? "o-done" : "o-flat";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
}
