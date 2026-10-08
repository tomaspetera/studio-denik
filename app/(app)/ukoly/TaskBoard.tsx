"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BALL_HINT,
  BALL_LABEL,
  BALL_ORDER,
  BALL_SENTENCE,
  FLOWS,
  SIZE_LABEL,
  dateKeyUTC,
  firstStepForBall,
  type Ball,
  type DateKey,
} from "@/lib/domain";
import { shortDateLabel } from "@/lib/buckets";
import { quickDates, type QuickDate } from "@/lib/quick-dates";
import { dueChip } from "@/lib/today";
import type { Category, Client, TaskRow } from "@/lib/tasks";
import type { TaskTemplate } from "@/lib/templates";
import type { RecurringRule } from "@/lib/recurring";
import { moveTaskAction, cycleSizeAction, deleteTaskAction } from "./actions";
import { setTaskDueDateAction } from "../kalendar/actions";
import DueChip from "../DueChip";
import { UndoToast, useUndo } from "../Undo";
import Composer from "./Composer";
import PresetsDialog from "./PresetsDialog";
import CaptureDialog from "./CaptureDialog";
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
  templates,
  rules,
  today,
  counts,
  openComposer,
  presetDate,
  openTaskId,
}: {
  tasks: TaskRow[];
  clients: Client[];
  categories: Category[];
  templates: TaskTemplate[];
  rules: RecurringRule[];
  /** Dnešek podle Prahy, počítaný na serveru — prohlížeč by ho mohl mít v jiném pásmu. */
  today: DateKey;
  counts: Record<string, number>;
  openComposer: boolean;
  /** Termín předvyplněný při zakládání — přichází z kliku na den v kalendáři. */
  presetDate?: string;
  /** Úkol, který se má rovnou rozbalit — přichází z kalendáře nebo jiného odkazu. */
  openTaskId?: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  /** Filtr podle klienta: "" = všichni, "-" = úkoly bez klienta, jinak id klienta. */
  const [clientFilter, setClientFilter] = useState("");
  const [query, setQuery] = useState("");
  const undo = useUndo();
  const quick = useMemo(() => quickDates(today), [today]);
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
  const [presets, setPresets] = useState(false);
  const [capture, setCapture] = useState(false);
  // Který úkol se právě upravuje. `null` znamená zakládání nového.
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const [pending, startTransition] = useTransition();
  // Úkol tažený mezi skupinami a skupina, nad kterou zrovna visí.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverBall, setDragOverBall] = useState<Ball | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Odkaz z kalendáře přijede přes URL, ne přes klik — sám scroll se proto
  // musí dořešit po vykreslení, ne v inline handleru.
  useEffect(() => {
    if (!openTaskId) return;
    document.getElementById(`ukol-${openTaskId}`)?.scrollIntoView({ block: "center" });
    // Jen při prvním vykreslení stránky s tímhle odkazem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Klávesové zkratky — jen když se zrovna nepíše do pole a není otevřený
  // dialog, jinak by "n" v názvu úkolu otevíralo nový formulář uprostřed psaní.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing || composer || presets || capture) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setEditTask(null);
        setComposer(true);
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setCapture(true);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [composer, presets, capture]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filter === "late" ? !t.is_late : filter !== "all" && t.ball !== filter) return false;
      if (clientFilter && (clientFilter === "-" ? t.client_id !== null : t.client_id !== clientFilter)) return false;
      if (!q) return true;
      return `${t.title} ${t.client_name ?? ""}`.toLowerCase().includes(q);
    });
  }, [tasks, filter, clientFilter, query]);

  // Jen klienti, kteří nějaký úkol mají — a i ti z archivu, pokud jim úkol zbyl.
  const clientOptions = useMemo(() => {
    const podleId = new Map<string, string>();
    for (const t of tasks) if (t.client_id) podleId.set(t.client_id, t.client_name ?? "Klient");
    return [...podleId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "cs"));
  }, [tasks]);
  const bezKlienta = tasks.some((t) => !t.client_id);

  const draggingTask = draggingId ? (tasks.find((t) => t.id === draggingId) ?? null) : null;

  const groups = useMemo(() => {
    const base = BALL_ORDER.map((ball) => ({ ball, rows: visible.filter((t) => t.ball === ball) }));
    if (!draggingTask) return base.filter((g) => g.rows.length > 0);
    // Během tažení se ukážou i prázdné skupiny, kam by úkol mohl přistát —
    // jinak by neměly kam, když v tom sloupci zrovna nic není.
    return base.filter((g) => g.rows.length > 0 || firstStepForBall(draggingTask.kind, g.ball) !== null);
  }, [visible, draggingTask]);

  /** Posun úkolu. Po kliknutí jde pár vteřin vrátit — `zpet` = false při vracení samotném. */
  function move(taskId: string, toStep: number, zpet = true) {
    const t = tasks.find((x) => x.id === taskId);
    undo.hide();
    startTransition(async () => {
      const res = await moveTaskAction(taskId, toStep);
      if (res.ok && zpet && t && toStep !== t.step) {
        undo.show({ text: `${t.title} → ${FLOWS[t.kind][toStep]?.label ?? "posunuto"}`, run: () => move(taskId, t.step, false) });
      }
      router.refresh();
    });
  }

  /** Termín z řádku. `den` = null termín sundá. */
  function setDue(t: TaskRow, den: string | null, zpet = true) {
    const puvodni = t.due_at ? dateKeyUTC(t.due_at) : null;
    undo.hide();
    startTransition(async () => {
      const res = await setTaskDueDateAction(t.id, den ? `${den}T00:00:00.000Z` : null);
      if (res.ok && zpet) {
        undo.show({
          text: `${t.title}: ${den ? `termín ${shortDateLabel(den)}` : "bez termínu"}`,
          run: () => setDue(t, puvodni, false),
        });
      }
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
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Hledat…"
              aria-label="Hledat v úkolech"
              title="Zkratka: /"
            />
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => setPresets(true)}
            title="Předvyplněné úkoly a úkoly, které se zakládají samy"
          >
            <span>Šablony a opakování</span>
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setCapture(true)}
            title="Z textu navrhne úkoly, ty zkontroluješ. Zkratka: T"
          >
            <span>Zapsat textem</span>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { setEditTask(null); setComposer(true); }}
            title="Zkratka: N"
          >
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
          {(clientOptions.length > 1 || (clientOptions.length === 1 && bezKlienta)) && (
            <select
              className={`${styles.clientFilter} ${clientFilter ? styles.clientFilterOn : ""}`}
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              aria-label="Filtr podle klienta"
            >
              <option value="">Všichni klienti</option>
              {clientOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {bezKlienta && <option value="-">Bez klienta</option>}
            </select>
          )}
        </div>
      )}

      {tasks.length === 0 ? (
        <Empty onAdd={() => setComposer(true)} />
      ) : groups.length === 0 ? (
        <p className={styles.blank}>Tomuhle filtru nic neodpovídá.</p>
      ) : (
        <div className={pending ? styles.busy : undefined}>
          {groups.map(({ ball, rows }) => {
            // Cíl je platný, jen když tažený úkol má v tomhle typu vůbec
            // krok patřící téhle skupině — jinak by přetažení skočilo na
            // náhodný krok, který s cílovou skupinou nemá co dělat.
            const validTarget =
              draggingTask && ball !== draggingTask.ball
                ? firstStepForBall(draggingTask.kind, ball)
                : null;

            return (
              <section
                key={ball}
                className={`${styles.group} o-${ball} ${dragOverBall === ball ? styles.groupDragOver : ""}`}
                onDragOver={(e) => {
                  if (validTarget === null) return;
                  e.preventDefault();
                  setDragOverBall(ball);
                }}
                onDragLeave={() => setDragOverBall((b) => (b === ball ? null : b))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverBall(null);
                  if (draggingTask && validTarget !== null) move(draggingTask.id, validTarget);
                }}
              >
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

                {rows.length === 0 ? (
                  <p className={styles.dropHint}>Sem přetáhni úkol, ať se posune na „{BALL_LABEL[ball]}“.</p>
                ) : !closed.has(ball) ? (
                  <div className={styles.rows}>
                    {rows.map((t) => (
                      <Row
                        key={t.id}
                        task={t}
                        today={today}
                        quick={quick}
                        busy={pending}
                        onDue={(den) => setDue(t, den)}
                        open={open === t.id}
                        onToggle={() => setOpen(open === t.id ? null : t.id)}
                        onMove={move}
                        onCycleSize={cycleSize}
                        onDelete={remove}
                        onEdit={() => { setEditTask(t); setComposer(true); }}
                        onDragStart={() => setDraggingId(t.id)}
                        onDragEnd={() => setDraggingId(null)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <UndoToast undo={undo} disabled={pending} />

      {composer && (
        <Composer
          task={editTask ?? undefined}
          clients={clients}
          categories={categories}
          templates={templates}
          today={today}
          presetDate={editTask ? undefined : presetDate}
          onClose={() => { setComposer(false); setEditTask(null); }}
          onSaved={() => {
            setComposer(false);
            setEditTask(null);
            router.refresh();
          }}
        />
      )}

      {capture && (
        <CaptureDialog
          clients={clients}
          categories={categories}
          today={today}
          onClose={() => setCapture(false)}
          onCreated={() => {
            setCapture(false);
            router.refresh();
          }}
        />
      )}

      {presets && (
        <PresetsDialog
          templates={templates}
          rules={rules}
          clients={clients}
          categories={categories}
          today={today}
          onClose={() => setPresets(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Row({
  task,
  today,
  quick,
  busy,
  onDue,
  open,
  onToggle,
  onMove,
  onCycleSize,
  onDelete,
  onEdit,
  onDragStart,
  onDragEnd,
}: {
  task: TaskRow;
  today: DateKey;
  quick: QuickDate[];
  busy: boolean;
  onDue: (den: string | null) => void;
  open: boolean;
  onToggle: () => void;
  onMove: (id: string, step: number) => void;
  onCycleSize: (id: string, size: number) => void;
  onDelete: (id: string) => void;
  onEdit: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const flow = FLOWS[task.kind];
  const tone = task.is_late ? "alarm" : task.ball;
  const nextLabel = task.step + 1 < flow.length ? flow[task.step + 1].label : null;
  const dueKey = task.due_at ? dateKeyUTC(task.due_at) : null;
  const stitek = dueChip(dueKey, task.is_late, today);
  const last = flow.length - 1;

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
        draggable
        onDragStart={(e) => {
          onDragStart();
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={onDragEnd}
        title="Přetažením do jiné skupiny posuneš úkol dál"
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

        <span className={styles.rowClient} title={task.client_name ?? undefined}>
          {task.client_name && (
            <>
              <i style={{ background: task.client_color ?? "var(--muted)" }} />
              {task.client_name}
            </>
          )}
        </span>

        {/* U otevřeného úkolu je termín tlačítko a vedle něj fajfka „rovnou hotovo“ —
            stejně jako na Dnes. Uzavřený úkol má termín jen jako text. */}
        {task.ball === "done" ? (
          <span className={styles.rowDue}>{stitek.label ?? ""}</span>
        ) : (
          <DueChip
            taskTitle={task.title}
            dueKey={dueKey}
            label={stitek.label}
            tone={stitek.tone}
            today={today}
            quick={quick}
            disabled={busy}
            onChange={onDue}
          />
        )}

        {task.ball === "done" ? (
          <span aria-hidden="true" />
        ) : (
          <button
            type="button"
            className={styles.rowDone}
            disabled={busy}
            title={`Rovnou „${flow[last].label}“`}
            aria-label={`Rovnou ${flow[last].label}: ${task.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onMove(task.id, last);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </button>
        )}

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
