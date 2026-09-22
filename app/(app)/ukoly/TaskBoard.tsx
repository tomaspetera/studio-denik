"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BALL_HINT,
  BALL_LABEL,
  BALL_ORDER,
  BALL_SENTENCE,
  FLOWS,
  SIZE_LABEL,
  type Ball,
} from "@/lib/domain";
import type { Category, Client, TaskRow } from "@/lib/tasks";
import { moveTaskAction, cycleSizeAction, deleteTaskAction } from "./actions";
import Composer from "./Composer";
import styles from "./tasks.module.css";

type Filter = Ball | "all" | "late";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Vše" },
  { key: "me", label: "Na tobě" },
  { key: "client", label: "U klienta" },
  { key: "supplier", label: "U dodavatele" },
  { key: "done", label: "Uzavřeno" },
  { key: "late", label: "Po termínu" },
];

export default function TaskBoard({
  tasks,
  clients,
  categories,
  counts,
  openComposer,
  presetDate,
  openTaskId,
}: {
  tasks: TaskRow[];
  clients: Client[];
  categories: Category[];
  counts: Record<string, number>;
  openComposer: boolean;
  /** Termín předvyplněný při zakládání — přichází z kliku na den v kalendáři. */
  presetDate?: string;
  /** Úkol, který se má rovnou rozbalit — přichází z kalendáře nebo jiného odkazu. */
  openTaskId?: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(openTaskId ?? null);
  // Uzavřené se sbalí samy. Jsou hotové — nemají důvod zabírat místo mezi
  // tím, co se ještě řeší. Nadpis skupiny drží počet, takže je vidět,
  // že existují, a jedno kliknutí je rozbalí.
  //
  // Odkaz na konkrétní úkol musí umět rozbalit i skupinu „Uzavřeno“ — jinak
  // by se detail otevřel uvnitř sbalené sekce a nebylo by ho vidět.
  const [closed, setClosed] = useState<Set<Ball>>(() => {
    const s = new Set<Ball>(["done"]);
    const target = openTaskId ? tasks.find((t) => t.id === openTaskId) : undefined;
    if (target) s.delete(target.ball);
    return s;
  });
  const [composer, setComposer] = useState(openComposer);
  // Který úkol se právě upravuje. `null` znamená zakládání nového.
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const [pending, startTransition] = useTransition();

  // Odkaz z kalendáře přijede přes URL, ne přes klik — sám scroll se proto
  // musí dořešit po vykreslení, ne v inline handleru.
  useEffect(() => {
    if (!openTaskId) return;
    document.getElementById(`ukol-${openTaskId}`)?.scrollIntoView({ block: "center" });
    // Jen při prvním vykreslení stránky s tímhle odkazem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filter === "late" ? !t.is_late : filter !== "all" && t.ball !== filter) return false;
      if (!q) return true;
      return `${t.title} ${t.client_name ?? ""}`.toLowerCase().includes(q);
    });
  }, [tasks, filter, query]);

  const groups = useMemo(
    () =>
      BALL_ORDER.map((ball) => ({ ball, rows: visible.filter((t) => t.ball === ball) }))
        .filter((g) => g.rows.length > 0),
    [visible],
  );

  function move(taskId: string, toStep: number) {
    startTransition(async () => {
      await moveTaskAction(taskId, toStep);
      router.refresh();
    });
  }

  function cycleSize(taskId: string, size: number) {
    startTransition(async () => {
      await cycleSizeAction(taskId, size);
      router.refresh();
    });
  }

  function remove(taskId: string) {
    startTransition(async () => {
      await deleteTaskAction(taskId);
      setOpen(null);
      router.refresh();
    });
  }

  function toggleGroup(ball: Ball) {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(ball)) next.delete(ball);
      else next.add(ball);
      return next;
    });
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Úkoly</h1>
          <p className={styles.sub}>
            {tasks.length === 0
              ? "Zatím tu nic není"
              : `${tasks.length} celkem · ${counts.me ?? 0} na tobě`}
          </p>
        </div>
        <div className={styles.tools}>
          <label className={styles.search}>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Hledat…"
              aria-label="Hledat v úkolech"
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={() => setComposer(true)}>
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            <span>Zapsat</span>
          </button>
        </div>
      </header>

      {tasks.length > 0 && (
        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`${styles.chip} ${filter === f.key ? styles.chipOn : ""}`}
            >
              {f.label}
              <span className={styles.chipCount}>{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      {tasks.length === 0 ? (
        <Empty onAdd={() => setComposer(true)} />
      ) : groups.length === 0 ? (
        <p className={styles.blank}>Tomuhle filtru nic neodpovídá.</p>
      ) : (
        <div className={pending ? styles.busy : undefined}>
          {groups.map(({ ball, rows }) => (
            <section key={ball} className={`${styles.group} o-${ball}`}>
              <button
                type="button"
                className={styles.groupHead}
                onClick={() => toggleGroup(ball)}
                aria-expanded={!closed.has(ball)}
              >
                <span className={styles.groupDot} aria-hidden="true" />
                <span className={styles.groupName}>{BALL_LABEL[ball]}</span>
                <span className={styles.groupCount}>{rows.length}</span>
                <span className={styles.groupHint}>{BALL_HINT[ball]}</span>
                <svg
                  className={`${styles.chev} ${closed.has(ball) ? styles.chevClosed : ""}`}
                  viewBox="0 0 24 24" fill="none" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {!closed.has(ball) && (
                <div className={styles.rows}>
                  {rows.map((t) => (
                    <Row
                      key={t.id}
                      task={t}
                      open={open === t.id}
                      onToggle={() => setOpen(open === t.id ? null : t.id)}
                      onMove={move}
                      onCycleSize={cycleSize}
                      onDelete={remove}
                      onEdit={() => { setEditTask(t); setComposer(true); }}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {composer && (
        <Composer
          task={editTask ?? undefined}
          clients={clients}
          categories={categories}
          presetDate={editTask ? undefined : presetDate}
          onClose={() => { setComposer(false); setEditTask(null); }}
          onSaved={() => {
            setComposer(false);
            setEditTask(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Row({
  task,
  open,
  onToggle,
  onMove,
  onCycleSize,
  onDelete,
  onEdit,
}: {
  task: TaskRow;
  open: boolean;
  onToggle: () => void;
  onMove: (id: string, step: number) => void;
  onCycleSize: (id: string, size: number) => void;
  onDelete: (id: string) => void;
  onEdit: () => void;
}) {
  const flow = FLOWS[task.kind];
  const tone = task.is_late ? "alarm" : task.ball;
  const nextLabel = task.step + 1 < flow.length ? flow[task.step + 1].label : null;

  // Mazání na dvě kliknutí. Modální okno by tu bylo těžkopádné a `confirm()`
  // v prohlížeči vypadá cize — tohle stačí a dá se to vzít zpět tím, že
  // se prostě neklikne podruhé.
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <div
        id={`ukol-${task.id}`}
        className={`${styles.row} o-${tone} ${open ? styles.rowOpen : ""}`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={open}
      >
        <span className={styles.mini} aria-hidden="true">
          {flow.map((_, i) => (
            <i
              key={i}
              className={i < task.step ? styles.miniOn : i === task.step ? styles.miniAt : ""}
            />
          ))}
        </span>

        <span className={styles.rowMain}>
          <span className={styles.rowTitle}>{task.title}</span>
          <span className={styles.rowSub}>
            {task.step_name}
            {task.supplier_name ? ` · ${task.supplier_name}` : ""}
          </span>
        </span>

        <span className={styles.rowClient}>
          {task.client_name && (
            <>
              <i style={{ background: task.client_color ?? "var(--muted)" }} />
              {task.client_name}
            </>
          )}
        </span>

        <span className={`${styles.rowDue} ${task.is_late ? styles.late : ""}`}>
          {formatDue(task.due_at)}
        </span>

        <span className={styles.rowOwner}>{task.assignee_initials ?? "—"}</span>
      </div>

      {open && (
        <div className={`${styles.detail} o-${tone}`}>
          <div className={styles.relay}>
            {flow.map((s, i) => (
              <button
                key={i}
                type="button"
                className={`${styles.step} ${
                  i < task.step ? styles.stepOn : i === task.step ? styles.stepAt : ""
                }`}
                onClick={() => onMove(task.id, i)}
              >
                <b />
                <span>{s.label}</span>
              </button>
            ))}
          </div>

          <div className={styles.acts}>
            {nextLabel && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onMove(task.id, task.step + 1)}
              >
                Posunout na „{nextLabel}“
              </button>
            )}
            <button type="button" className="btn" onClick={onEdit}>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
              </svg>
              Upravit
            </button>

            <button
              type="button"
              className="btn"
              onClick={() => onCycleSize(task.id, task.size)}
              title="Ovlivňuje procenta v reportu"
            >
              Velikost: {SIZE_LABEL[task.size]}
            </button>

            <span className={styles.actsSpacer} />

            {confirming ? (
              <>
                <button
                  type="button"
                  className={`btn ${styles.danger}`}
                  onClick={() => onDelete(task.id)}
                >
                  Opravdu smazat
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
                  Nechat
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirming(true)}
              >
                Smazat
              </button>
            )}
          </div>

          {confirming && (
            <p className={styles.warn} role="alert">
              {task.ball === "done"
                ? "Tenhle úkol je uzavřený a je součástí reportu. Smazáním zmizí i z už vystavených reportů — historie se maže s ním."
                : "Smaže se i historie úkolu. Vrátit zpět to nejde."}
            </p>
          )}

          {task.client_reply && (
            <p className={styles.reply}>
              <b>
                Odpověď klienta
                {task.client_name ? ` · ${task.client_name}` : ""}
                {formatReplyDate(task.client_reply_at)}:
              </b>
              {" "}„{task.client_reply}“
            </p>
          )}

          <dl className={styles.meta}>
            <span><dt>Stav</dt><dd>{BALL_SENTENCE[task.ball]}</dd></span>
            <span><dt>Typ</dt><dd>{flow.length} kroků</dd></span>
            <span><dt>Termín</dt><dd>{formatDue(task.due_at) || "nestanoven"}</dd></span>
          </dl>
        </div>
      )}
    </>
  );
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className={styles.empty}>
      <strong>Zatím žádné úkoly</strong>
      <p>
        Zapiš první. Stačí název — typ určí, kolik kroků bude mít štafeta
        a kdy se míč přehodí na klienta nebo dodavatele.
      </p>
      <button type="button" className="btn btn-primary btn-lg" onClick={onAdd}>
        Zapsat první úkol
      </button>
    </div>
  );
}

function formatReplyDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return `, ${d.getDate()}. ${d.getMonth() + 1}.`;
}

function formatDue(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  const today = new Date();
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  if (sameDay) return "dnes";
  return `${d.getDate()}. ${d.getMonth() + 1}.`;
}
