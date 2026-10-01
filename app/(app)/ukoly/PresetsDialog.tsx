"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  KIND_LABEL,
  SIZE_LABEL,
  addDaysKey,
  csDateFromKey,
  plural,
  type DateKey,
} from "@/lib/domain";
import {
  MAX_MONTH_DAY,
  PRESET_KINDS,
  WEEKDAY_SHORT,
  describeSchedule,
  nextOccurrence,
  type Frequency,
  type PresetKind,
} from "@/lib/presets";
import type { TaskTemplate } from "@/lib/templates";
import type { RecurringRule } from "@/lib/recurring";
import type { Category, Client } from "@/lib/tasks";
import {
  createTemplateAction,
  updateTemplateAction,
  deleteTemplateAction,
  createRecurringAction,
  updateRecurringAction,
  setRecurringActiveAction,
  deleteRecurringAction,
} from "./preset-actions";
import styles from "./tasks.module.css";

type Tab = "sablony" | "opakovani";
type Editor =
  | { mode: "template"; item: TaskTemplate | null }
  | { mode: "rule"; item: RecurringRule | null };

/** Doporučené pravidlo — týdenní report je to, co se v téhle práci opakuje nejjistěji. */
const SUGGESTION = {
  title: "Odeslat týdenní report",
  kind: "interni" as const,
  size: 1,
  frequency: "weekly" as const,
  weekday: 5,
  dueOffsetDays: 0,
};

function dueLabel(days: number | null): string | null {
  if (days === null) return null;
  return days === 0 ? "termín v den založení" : `termín za ${days} ${plural(days, "den", "dny", "dní")}`;
}

export default function PresetsDialog({
  templates,
  rules,
  clients,
  categories,
  today,
  onClose,
}: {
  templates: TaskTemplate[];
  rules: RecurringRule[];
  clients: Client[];
  categories: Category[];
  today: DateKey;
  onClose: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("sablony");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const clientName = (id: string | null) =>
    id ? (clients.find((c) => c.id === id)?.name ?? "klient v archivu") : null;

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.message ?? "Nepodařilo se to.");
      setConfirmId(null);
      router.refresh();
    });
  }

  const hasReportRule = rules.some((r) => /report/i.test(r.title));

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className={styles.dialog}
        style={{ maxWidth: 640 }}
        role="dialog"
        aria-modal="true"
        aria-label="Šablony a opakování"
      >
        <header className={styles.dialogHead}>
          <h2>Šablony a opakování</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Zavřít">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className={styles.tabs} role="tablist">
          {([["sablony", `Šablony (${templates.length})`], ["opakovani", `Opakování (${rules.length})`]] as const).map(
            ([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`${styles.tab} ${tab === key ? styles.tabOn : ""}`}
                onClick={() => { setTab(key); setEditor(null); setError(null); }}
              >
                {label}
              </button>
            ),
          )}
        </div>

        <div className={styles.dialogBody}>
          {error && <p className={styles.error} role="alert" style={{ marginTop: 0, marginBottom: "var(--s4)" }}>{error}</p>}

          {editor ? (
            <PresetForm
              editor={editor}
              clients={clients}
              categories={categories}
              onCancel={() => setEditor(null)}
              onSaved={() => { setEditor(null); router.refresh(); }}
            />
          ) : tab === "sablony" ? (
            <>
              <p className={styles.note} style={{ marginTop: 0 }}>
                Šablona je předvyplněný úkol. Kroky do ní nepatří, ty už nese typ úkolu.
                Při zápisu úkolu ji vybereš v nabídce „Ze šablony“.
              </p>

              {templates.length === 0 ? (
                <p className={styles.presetEmpty}>
                  Zatím žádná šablona. Vytvoř ji tlačítkem níž, nebo zaškrtni „Uložit jako šablonu“
                  při zápisu úkolu.
                </p>
              ) : (
                <ul className={styles.presetList}>
                  {templates.map((t) => (
                    <li key={t.id} className={styles.presetRow}>
                      <div className={styles.presetMain}>
                        <span className={styles.presetTitle}>{t.title}</span>
                        <span className={styles.presetMeta}>
                          {[
                            KIND_LABEL[t.kind],
                            SIZE_LABEL[t.size],
                            clientName(t.clientId),
                            dueLabel(t.dueOffsetDays),
                          ].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      <div className={styles.presetActs}>
                        {confirmId === t.id ? (
                          <>
                            <button type="button" className={`btn btn-sm ${styles.danger}`} disabled={pending} onClick={() => run(() => deleteTemplateAction(t.id))}>
                              Opravdu smazat
                            </button>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmId(null)}>Nechat</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn btn-sm" onClick={() => setEditor({ mode: "template", item: t })}>Upravit</button>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmId(t.id)}>Smazat</button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <button type="button" className="btn" style={{ marginTop: "var(--s4)" }} onClick={() => setEditor({ mode: "template", item: null })}>
                Nová šablona
              </button>
            </>
          ) : (
            <>
              <p className={styles.note} style={{ marginTop: 0 }}>
                Opakovaný úkol se zakládá sám každé ráno (kolem 6:00) v den, který určíš.
                Pravidlo uložené ve svůj den založí úkol hned.
              </p>

              {!hasReportRule && (
                <div className={styles.suggest}>
                  <div>
                    <strong>Doporučeno: {SUGGESTION.title}</strong>
                    <span>{describeSchedule({ frequency: "weekly", weekday: SUGGESTION.weekday, monthDay: null })}, interní, malý. Den můžeš po přidání změnit.</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={pending}
                    onClick={() => run(() => createRecurringAction(SUGGESTION))}
                  >
                    Přidat
                  </button>
                </div>
              )}

              {rules.length === 0 ? (
                <p className={styles.presetEmpty}>Zatím žádné opakování.</p>
              ) : (
                <ul className={styles.presetList}>
                  {rules.map((r) => (
                    <li key={r.id} className={`${styles.presetRow} ${r.active ? "" : styles.presetOff}`}>
                      <div className={styles.presetMain}>
                        <span className={styles.presetTitle}>
                          {r.title}
                          {!r.active && <em className={styles.tagOff}>pozastaveno</em>}
                        </span>
                        <span className={styles.presetMeta}>
                          {[
                            describeSchedule(r),
                            KIND_LABEL[r.kind],
                            clientName(r.clientId),
                            dueLabel(r.dueOffsetDays),
                            r.active
                              ? `další ${csDateFromKey(nextOccurrence(r, addDaysKey(today, 1)))}`
                              : null,
                          ].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      <div className={styles.presetActs}>
                        {confirmId === r.id ? (
                          <>
                            <button type="button" className={`btn btn-sm ${styles.danger}`} disabled={pending} onClick={() => run(() => deleteRecurringAction(r.id))}>
                              Opravdu smazat
                            </button>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmId(null)}>Nechat</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => setRecurringActiveAction(r.id, !r.active))}>
                              {r.active ? "Pozastavit" : "Zapnout"}
                            </button>
                            <button type="button" className="btn btn-sm" onClick={() => setEditor({ mode: "rule", item: r })}>Upravit</button>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmId(r.id)}>Smazat</button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <button type="button" className="btn" style={{ marginTop: "var(--s4)" }} onClick={() => setEditor({ mode: "rule", item: null })}>
                Nové opakování
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PresetForm({
  editor,
  clients,
  categories,
  onCancel,
  onSaved,
}: {
  editor: Editor;
  clients: Client[];
  categories: Category[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isRule = editor.mode === "rule";
  const rule = editor.mode === "rule" ? editor.item : null;
  const template = editor.mode === "template" ? editor.item : null;
  const base = rule ?? template;

  const [title, setTitle] = useState(base?.title ?? "");
  const [kind, setKind] = useState<PresetKind>(base?.kind ?? (isRule ? "interni" : "klient"));
  const [size, setSize] = useState(base?.size ?? 2);
  const [clientId, setClientId] = useState(base?.clientId ?? "");
  const [categoryId, setCategoryId] = useState(base?.categoryId ?? "");
  const [due, setDue] = useState(base?.dueOffsetDays != null ? String(base.dueOffsetDays) : "");
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? "weekly");
  const [weekday, setWeekday] = useState(rule?.weekday ?? 5);
  const [monthDay, setMonthDay] = useState(rule?.monthDay ?? 1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const common = {
      title,
      kind,
      size,
      clientId: clientId || null,
      categoryId: categoryId || null,
      dueOffsetDays: due.trim() === "" ? null : due,
    };

    startTransition(async () => {
      let res: { ok: boolean; message?: string };
      if (isRule) {
        const form = {
          ...common,
          frequency,
          weekday: frequency === "weekly" ? weekday : null,
          monthDay: frequency === "monthly" ? monthDay : null,
        };
        res = rule ? await updateRecurringAction({ id: rule.id, ...form }) : await createRecurringAction(form);
      } else {
        res = template ? await updateTemplateAction({ id: template.id, ...common }) : await createTemplateAction(common);
      }
      if (res.ok) onSaved();
      else setError(res.message ?? "Nepodařilo se to uložit.");
    });
  }

  const heading = isRule
    ? rule ? "Upravit opakování" : "Nové opakování"
    : template ? "Upravit šablonu" : "Nová šablona";

  return (
    <div>
      <h3 className={styles.formTitle}>{heading}</h3>

      <label className={styles.label} htmlFor="p-title">
        {isRule ? "Název úkolu, který se bude zakládat" : "Předvyplněný název úkolu"}
      </label>
      <input
        id="p-title"
        className="field"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={isRule ? "Odeslat týdenní report" : "Letáky A5"}
        autoFocus
      />

      <span className={styles.label} style={{ marginTop: "var(--s5)" }}>Typ úkolu</span>
      <div className={styles.sizes}>
        {PRESET_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`${styles.size} ${kind === k ? styles.sizeOn : ""}`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {isRule && (
        <>
          <span className={styles.label} style={{ marginTop: "var(--s5)" }}>Jak často</span>
          <div className={styles.sizes}>
            {([["weekly", "Každý týden"], ["monthly", "Každý měsíc"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFrequency(key)}
                className={`${styles.size} ${frequency === key ? styles.sizeOn : ""}`}
              >
                {label}
              </button>
            ))}
          </div>

          {frequency === "weekly" ? (
            <div className={styles.weekdays} role="group" aria-label="Den v týdnu">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setWeekday(d)}
                  aria-pressed={weekday === d}
                  className={`${styles.choice} ${weekday === d ? styles.choiceOn : ""}`}
                >
                  {WEEKDAY_SHORT[d]}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: "var(--s3)" }}>
              <label className={styles.label} htmlFor="p-monthday">Den v měsíci</label>
              <select
                id="p-monthday"
                className="field"
                style={{ width: "auto" }}
                value={monthDay}
                onChange={(e) => setMonthDay(Number(e.target.value))}
              >
                {Array.from({ length: MAX_MONTH_DAY }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}.</option>
                ))}
              </select>
              <p className={styles.note} style={{ marginTop: "var(--s2)" }}>
                29. až 31. se nenabízí — v kratším měsíci by se úkol přeskočil.
              </p>
            </div>
          )}
        </>
      )}

      <div className={styles.grid2}>
        <div>
          <label className={styles.label} htmlFor="p-client">Klient</label>
          <select id="p-client" className="field" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— žádný —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            {base?.clientId && !clients.some((c) => c.id === base.clientId) && (
              <option value={base.clientId}>Klient (v archivu)</option>
            )}
          </select>
        </div>
        <div>
          <label className={styles.label} htmlFor="p-cat">Kategorie</label>
          <select id="p-cat" className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— žádná —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={styles.label} htmlFor="p-due">Termín za (dní)</label>
          <input
            id="p-due"
            className="field"
            inputMode="numeric"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            placeholder="bez termínu"
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
                {SIZE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className={styles.note}>
        Termín se počítá ode dne, kdy úkol vznikne. Nula znamená termín týž den, prázdné pole žádný termín.
      </p>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.formActs}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Zpět na seznam</button>
        <span className={styles.spacer} />
        <button type="button" className="btn btn-primary" disabled={pending || !title.trim()} onClick={save}>
          {pending ? "Ukládám…" : "Uložit"}
        </button>
      </div>
    </div>
  );
}
