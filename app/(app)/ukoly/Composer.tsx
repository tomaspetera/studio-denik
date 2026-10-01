"use client";

import { useState, useTransition } from "react";
import { KIND_LABEL, addDaysKey, daysBetweenKeys, type DateKey, type TaskKind } from "@/lib/domain";
import type { Category, Client, TaskRow } from "@/lib/tasks";
import type { TaskTemplate } from "@/lib/templates";
import { createTaskAction, updateTaskAction } from "./actions";
import { createTemplateAction } from "./preset-actions";
import styles from "./tasks.module.css";

const KINDS: { key: TaskKind; hint: string }[] = [
  { key: "interni", hint: "3 kroky — nikdo zvenčí do toho nevstupuje" },
  { key: "klient", hint: "4 kroky — klient to schvaluje" },
  { key: "tisk", hint: "6 kroků — jde do tiskárny" },
];

/**
 * Zakládání i úprava v jednom. Když dostane `task`, přepne se do úpravy —
 * dvě skoro stejné obrazovky by se dřív nebo později rozešly.
 */
export default function Composer({
  task,
  clients,
  categories,
  templates,
  today,
  presetDate,
  onClose,
  onSaved,
}: {
  task?: TaskRow;
  clients: Client[];
  categories: Category[];
  templates: TaskTemplate[];
  /** Dnešek podle Prahy, počítaný na serveru — termín šablony se počítá od něj. */
  today: DateKey;
  /** Termín předvyplněný z kliku na den v kalendáři — jen pro nový úkol. */
  presetDate?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(task);

  const [title, setTitle] = useState(task?.title ?? "");
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? "klient");
  const [clientId, setClientId] = useState<string>(task?.client_id ?? "");
  const [categoryId, setCategoryId] = useState<string>("");
  const [dueAt, setDueAt] = useState<string>(toDateInput(task?.due_at ?? null) || presetDate || "");
  const [size, setSize] = useState(task?.size ?? 2);
  const [templateId, setTemplateId] = useState("");
  const [saveTemplate, setSaveTemplate] = useState(false);
  // Úkol už je zapsaný, jen se nepovedlo uložit šablonu — formulář se pak
  // nesmí dát odeslat znovu, vznikl by druhý stejný úkol.
  const [taskSavedNote, setTaskSavedNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const kindChanged = editing && kind !== task!.kind;

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setTitle(t.title);
    setKind(t.kind);
    setSize(t.size);
    // Archivovaný klient v nabídce chybí — předvyplnění by <select> nechalo
    // ukazovat "žádný", ale uložení by ho přesto přiřadilo.
    setClientId(t.clientId && clients.some((c) => c.id === t.clientId) ? t.clientId : "");
    setCategoryId(t.categoryId && categories.some((c) => c.id === t.categoryId) ? t.categoryId : "");
    if (t.dueOffsetDays !== null) setDueAt(addDaysKey(today, t.dueOffsetDays));
    else if (!presetDate) setDueAt("");
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const common = {
        title,
        kind,
        clientId: clientId || null,
        categoryId: categoryId || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        size,
      };

      const res = task
        ? await updateTaskAction({ taskId: task.id, ...common })
        : await createTaskAction(common);

      if (!res.ok) {
        setError(res.message);
        return;
      }

      if (!task && saveTemplate) {
        // Termín šablony je počet dní od založení — zvolené datum se převede
        // na rozdíl oproti dnešku (do minulosti se nevrací).
        const offset = dueAt ? Math.min(365, Math.max(0, daysBetweenKeys(today, dueAt))) : null;
        const tpl = await createTemplateAction({
          title,
          kind,
          size,
          clientId: clientId || null,
          categoryId: categoryId || null,
          dueOffsetDays: offset,
        });
        if (!tpl.ok) {
          setTaskSavedNote(`Úkol je zapsaný, ale šablona se neuložila: ${tpl.message}`);
          return;
        }
      }

      onSaved();
    });
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Upravit úkol" : "Nový úkol"}
      >
        <header className={styles.dialogHead}>
          <h2>{editing ? "Upravit úkol" : "Nový úkol"}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Zavřít">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className={styles.dialogBody}>
          {!editing && templates.length > 0 && (
            <div style={{ marginBottom: "var(--s5)" }}>
              <label className={styles.label} htmlFor="t-tpl">Ze šablony</label>
              <select
                id="t-tpl"
                className="field"
                value={templateId}
                onChange={(e) => applyTemplate(e.target.value)}
              >
                <option value="">— od nuly —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.title} · {KIND_LABEL[t.kind]}</option>
                ))}
              </select>
            </div>
          )}

          <label className={styles.label} htmlFor="t-title">
            {editing ? "Název úkolu" : "Co jsi udělal nebo co je potřeba"}
          </label>
          <input
            id="t-title"
            className="field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Letáky A5 na letní nabídku"
            autoFocus
          />

          <span className={styles.label} style={{ marginTop: "var(--s5)" }}>Typ úkolu</span>
          <div className={styles.kinds}>
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => setKind(k.key)}
                className={`${styles.kind} ${kind === k.key ? styles.kindOn : ""}`}
              >
                <b>{KIND_LABEL[k.key]}</b>
                <span>{k.hint}</span>
              </button>
            ))}
          </div>

          {kindChanged && (
            <p className={styles.note} style={{ color: "var(--client)" }}>
              Změnou typu se mění počet kroků. Úkol se přesune na nejbližší
              platný krok — pokud byl uzavřený, zůstane uzavřený.
            </p>
          )}

          <div className={styles.grid2}>
            <div>
              <label className={styles.label} htmlFor="t-client">Klient</label>
              <select
                id="t-client"
                className="field"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">— žádný —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                {/* Archivovaný klient v nabídce chybí. Kdyby tu jeho úkol
                    neměl vlastní položku, prohlížeč by spadl na první volbu
                    a uložení by úkol od klienta tiše odpojilo. */}
                {task?.client_id && !clients.some((c) => c.id === task.client_id) && (
                  <option value={task.client_id}>
                    {task.client_name ?? "Klient"} (v archivu)
                  </option>
                )}
              </select>
            </div>
            <div>
              <label className={styles.label} htmlFor="t-cat">Kategorie</label>
              <select
                id="t-cat"
                className="field"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">— žádná —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.label} htmlFor="t-due">Termín</label>
              <input
                id="t-due"
                type="date"
                className="field"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
            <div>
              <span className={styles.label}>Velikost</span>
              <div className={styles.sizes}>
                {[1, 2, 3].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSize(s)}
                    className={`${styles.size} ${size === s ? styles.sizeOn : ""}`}
                  >
                    {s === 1 ? "malý" : s === 2 ? "střední" : "velký"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className={styles.note}>
            Velikost je nepovinná — ovlivňuje jen procenta v reportu. Když ji
            necháš být, počítá se každý úkol stejně.
          </p>

          {!editing && !taskSavedNote && (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={saveTemplate}
                onChange={(e) => setSaveTemplate(e.target.checked)}
              />
              <span>Uložit jako šablonu</span>
            </label>
          )}

          {error && <p className={styles.error} role="alert">{error}</p>}
          {taskSavedNote && <p className={styles.error} role="alert">{taskSavedNote}</p>}
        </div>

        <footer className={styles.dialogFoot}>
          <span className={styles.spacer} />
          {taskSavedNote ? (
            <button type="button" className="btn btn-primary" onClick={onSaved}>Zavřít</button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Zrušit</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={save}
                disabled={pending || !title.trim()}
              >
                {pending ? "Ukládám…" : editing ? "Uložit změny" : "Uložit úkol"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function toDateInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
