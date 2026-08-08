"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { plural } from "@/lib/domain";
import type { PrintJob } from "@/lib/print";
import { saveDetailsAction, confirmDeliveryAction, nudgeAction } from "./actions";
import styles from "./print.module.css";

/** Kroky tiskového průchodu, tak jak je vidí uživatel na časové ose. */
const MILESTONES = [
  { key: "approvedAt", label: "Schváleno", step: 2 },
  { key: "sentAt", label: "Do tisku", step: 3 },
  { key: "promisedAt", label: "Dodání", step: 4 },
  { key: "handedAt", label: "Předáno", step: 5 },
] as const;

export default function PrintBoard({ jobs }: { jobs: PrintJob[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const late = jobs.filter((j) => j.daysLeft !== null && j.daysLeft < 0).length;

  function act(fn: () => Promise<unknown>) {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Tisk a termíny</h1>
          <p className={styles.sub}>
            {jobs.length === 0
              ? "Žádné tiskové zakázky"
              : `${jobs.length} ${plural(jobs.length, "zakázka", "zakázky", "zakázek")}` +
                (late > 0 ? ` · ${late} po termínu` : "")}
          </p>
        </div>
      </header>

      {jobs.length === 0 ? (
        <div className={styles.empty}>
          <strong>Zatím žádné tiskové zakázky</strong>
          <p>
            Sem spadne každý úkol, kterému dáš typ <b>Tiskový</b>. Doplníš
            k němu tiskárnu a slíbený termín — a aplikace pak hlídá, jestli
            dorazí včas.
          </p>
          <Link href="/ukoly?zapsat=1" className="btn btn-primary btn-lg">
            Zapsat tiskovou zakázku
          </Link>
        </div>
      ) : (
        <div className={styles.grid}>
          {jobs.map((j) => (
            <Job
              key={j.taskId}
              job={j}
              editing={editing === j.taskId}
              pending={pending}
              onEdit={() => setEditing(editing === j.taskId ? null : j.taskId)}
              onSaved={() => { setEditing(null); router.refresh(); }}
              onDeliver={() => act(() => confirmDeliveryAction(j.taskId))}
              onNudge={() => act(() => nudgeAction(j.taskId))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Job({
  job, editing, pending, onEdit, onSaved, onDeliver, onNudge,
}: {
  job: PrintJob;
  editing: boolean;
  pending: boolean;
  onEdit: () => void;
  onSaved: () => void;
  onDeliver: () => void;
  onNudge: () => void;
}) {
  const done = job.ball === "done" || Boolean(job.handedAt);
  const overdue = job.daysLeft !== null && job.daysLeft < 0;
  const tone = done ? "done" : overdue ? "alarm" : job.ball;

  return (
    <article className={`${styles.card} o-${tone} ${overdue ? styles.cardLate : ""}`}>
      <header className={styles.cardHead}>
        <div className={styles.ident}>
          {job.code && <span className={styles.code}>{job.code}</span>}
          <h2 className={styles.title}>{job.title}</h2>
          <p className={styles.spec}>
            {[
              job.clientName,
              job.quantity ? `${job.quantity.toLocaleString("cs-CZ")} ks` : null,
              job.supplierName,
              job.spec,
            ].filter(Boolean).join(" · ") || "bez upřesnění"}
          </p>
        </div>
        <span className={`pill o-${tone}`}>
          {done ? "Uzavřeno" : overdue ? "Po termínu" : job.stepName}
        </span>
      </header>

      <div className={styles.body}>
        <ol className={styles.timeline}>
          {MILESTONES.map((m, i) => {
            const date = job[m.key] as string | null;
            const reached = job.step > m.step || Boolean(date && m.key !== "promisedAt");
            const current = job.step === m.step;
            return (
              <li key={m.key}>
                {i > 0 && <span className={`${styles.line} ${reached ? styles.lineOn : ""}`} />}
                <span
                  className={`${styles.dot} ${reached ? styles.dotOn : ""} ${
                    current ? (overdue ? styles.dotLate : styles.dotNow) : ""
                  }`}
                />
                <span className={styles.mLabel}>{m.label}</span>
                <span className={styles.mDate}>{fmt(date) || "—"}</span>
              </li>
            );
          })}
        </ol>

        <Countdown job={job} done={done} overdue={overdue} />
      </div>

      {editing ? (
        <Details job={job} onCancel={onEdit} onSaved={onSaved} />
      ) : (
        <footer className={styles.foot}>
          {!done && (
            <button type="button" className="btn btn-sm btn-primary" onClick={onDeliver} disabled={pending}>
              Potvrdit dodání
            </button>
          )}
          {!done && job.ball === "supplier" && (
            <button type="button" className="btn btn-sm" onClick={onNudge} disabled={pending}>
              {job.lastNudgeAt ? "Urgovat znovu" : "Urgovat"}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={onEdit}>
            Upravit údaje
          </button>
        </footer>
      )}
    </article>
  );
}

function Countdown({ job, done, overdue }: { job: PrintJob; done: boolean; overdue: boolean }) {
  if (done) {
    return (
      <div className={`${styles.cd} o-done`}>
        <b>✓</b>
        <span>
          Dodáno{job.deliveredAt ? ` ${fmt(job.deliveredAt)}` : ""}
          {job.handedAt ? ` a předáno ${fmt(job.handedAt)}` : ""}.
        </span>
      </div>
    );
  }

  if (job.daysLeft === null) {
    return (
      <div className={`${styles.cd} o-flat`}>
        <b>—</b>
        <span>
          Slíbený termín není zadaný. Bez něj aplikace nemá co hlídat —
          doplň ho přes <b>Upravit údaje</b>.
        </span>
      </div>
    );
  }

  const d = job.daysLeft;
  const tone = d < 0 ? "alarm" : d <= 2 ? "client" : "done";

  return (
    <div className={`${styles.cd} o-${tone}`}>
      <b>{d < 0 ? `+${Math.abs(d)}` : d}</b>
      <span>
        {d < 0
          ? `${plural(Math.abs(d), "den", "dny", "dní")} po slíbeném termínu.`
          : d === 0
            ? "Slíbeno na dnešek."
            : `${plural(d, "den", "dny", "dní")} do slíbeného dodání.`}
        {job.lastNudgeAt && <> Naposledy urgováno {fmt(job.lastNudgeAt)}.</>}
        {overdue && !job.lastNudgeAt && <> Zatím neurgováno.</>}
      </span>
    </div>
  );
}

function Details({
  job, onCancel, onSaved,
}: { job: PrintJob; onCancel: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(job.code ?? "");
  const [spec, setSpec] = useState(job.spec ?? "");
  const [quantity, setQuantity] = useState(job.quantity?.toString() ?? "");
  const [sentAt, setSentAt] = useState(toInput(job.sentAt));
  const [promisedAt, setPromisedAt] = useState(toInput(job.promisedAt));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveDetailsAction(job.taskId, {
        code,
        spec,
        quantity: quantity.trim() ? Number(quantity.replace(/\s/g, "")) : null,
        sentAt: sentAt || null,
        promisedAt: promisedAt || null,
      });
      if (res.ok) onSaved();
      else setError(res.message);
    });
  }

  return (
    <div className={styles.editor}>
      <div className={styles.grid2}>
        <label>
          <span>Číslo zakázky</span>
          <input className="field" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ZAK-2608-014" />
        </label>
        <label>
          <span>Náklad</span>
          <input className="field" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="5000" />
        </label>
        <label>
          <span>Odesláno do tisku</span>
          <input type="date" className="field" value={sentAt} onChange={(e) => setSentAt(e.target.value)} />
        </label>
        <label>
          <span>Tiskárna slíbila</span>
          <input type="date" className="field" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} />
        </label>
      </div>

      <label className={styles.full}>
        <span>Specifikace</span>
        <input className="field" value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="A5, 4/4, křída 135 g" />
      </label>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.editorActs}>
        <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={pending}>
          {pending ? "Ukládám…" : "Uložit"}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Zrušit</button>
      </div>
    </div>
  );
}

function fmt(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getDate()}. ${d.getMonth() + 1}.`;
}

function toInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
