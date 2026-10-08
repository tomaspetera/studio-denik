"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDaysKey, csDateFromKey, daysBetweenKeys, plural, type DateKey } from "@/lib/domain";
import type { AttentionItem, AttentionKind } from "@/lib/attention";
import { setNextStepAction, setSilenceDaysAction } from "./attention-actions";
import styles from "./home.module.css";

const SHOWN = 8;

const PILL: Record<AttentionKind, { tone: string; label: string }> = {
  step_overdue: { tone: "alarm", label: "po termínu" },
  lead_no_step: { tone: "note", label: "bez kroku" },
  client_silent: { tone: "flat", label: "ticho" },
};

const CHIPS = [
  { label: "Zítra", days: 1 },
  { label: "Za týden", days: 7 },
  { label: "Za měsíc", days: 30 },
];

function reason(item: AttentionItem, today: DateKey): string {
  if (item.kind === "step_overdue") {
    return `Krok „${item.step}“ měl být ${csDateFromKey(item.since)}`;
  }
  if (item.kind === "lead_no_step") {
    return `Poptávka bez dalšího kroku od ${csDateFromKey(item.since)}`;
  }
  const days = daysBetweenKeys(item.since, today);
  return `Bez aktivity ${days} ${plural(days, "den", "dny", "dní")} · naposledy ${csDateFromKey(item.since)}`;
}

/**
 * Co chce pozornost: sliby po termínu, poptávky bez dalšího kroku a klienti,
 * se kterými je dlouho ticho. Krok se nastavuje rovnou tady, bez otevírání
 * karty — jinak by hlídání vytvářelo práci navíc místo úlevy.
 */
export default function AttentionPanel({
  items,
  today,
  silenceDays,
}: {
  items: AttentionItem[];
  today: DateKey;
  silenceDays: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const shown = all ? items : items.slice(0, SHOWN);

  // Když nic neleží ladem, není co ukazovat — zbude jen nastavení, po kolika
  // dnech ticha se klient připomene.
  if (items.length === 0) {
    return (
      <section className="panel" style={{ marginTop: "var(--s5)" }}>
        <SilenceSetting silenceDays={silenceDays} />
      </section>
    );
  }

  return (
    <section className="panel" style={{ marginTop: "var(--s5)" }}>
      <header className={styles.panelHead}>
        <h2>Chce pozornost</h2>
        <span className={styles.note}>
          {items.length === 0
            ? "všechno má další krok"
            : `${items.length} ${plural(items.length, "věc", "věci", "věcí")}`}
        </span>
      </header>

      {items.length === 0 ? (
        <p className={styles.blank}>Nic neleží ladem — každá otevřená poptávka a každý slib má svůj den.</p>
      ) : (
        <ul className={styles.list}>
          {shown.map((item) => {
            const key = `${item.subject}:${item.id}`;
            const pill = PILL[item.kind];
            return (
              <li key={key}>
                <button
                  type="button"
                  className={styles.attMain}
                  onClick={() => setOpen(open === key ? null : key)}
                  aria-expanded={open === key}
                >
                  <span className={styles.attTop}>
                    <span className={styles.attName}>{item.name}</span>
                    <span className={`pill o-${pill.tone}`}>{pill.label}</span>
                  </span>
                  <span className={styles.itemSub}>
                    {item.subject === "lead" ? "Poptávka" : "Klient"} · {reason(item, today)}
                  </span>
                </button>

                {open === key && (
                  <StepEditor
                    item={item}
                    today={today}
                    onDone={() => {
                      setOpen(null);
                      router.refresh();
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {items.length > SHOWN && (
        <div className={styles.panelFoot}>
          <button type="button" className="btn btn-sm" onClick={() => setAll(!all)}>
            {all ? "Skrýt" : `Ukázat všech ${items.length}`}
          </button>
        </div>
      )}

      <SilenceSetting silenceDays={silenceDays} />
    </section>
  );
}

function StepEditor({
  item,
  today,
  onDone,
}: {
  item: AttentionItem;
  today: DateKey;
  onDone: () => void;
}) {
  const [step, setStep] = useState("");
  const [at, setAt] = useState<DateKey>(addDaysKey(today, 7));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(nextStep: string | null, nextAt: string | null) {
    setError(null);
    startTransition(async () => {
      const res = await setNextStepAction({ subject: item.subject, id: item.id, step: nextStep, at: nextAt });
      if (res.ok) onDone();
      else setError(res.message);
    });
  }

  const href = item.subject === "lead" ? `/poptavky?otevrit=${item.id}` : `/klienti?otevrit=${item.id}`;

  return (
    <div className={styles.attEditor}>
      <input
        className="field"
        value={step}
        onChange={(e) => setStep(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && step.trim() && at) submit(step, at);
        }}
        placeholder={item.subject === "lead" ? "Co dál? Třeba: poslat nabídku" : "Co dál? Třeba: ozvat se kvůli novému projektu"}
        aria-label="Další krok"
        autoFocus
      />

      <div className={styles.attRow2}>
        <input
          type="date"
          className="field"
          style={{ width: "auto" }}
          value={at}
          onChange={(e) => setAt(e.target.value)}
          aria-label="Datum dalšího kroku"
        />
        <span className={styles.attChips}>
          {CHIPS.map((c) => {
            const key = addDaysKey(today, c.days);
            return (
              <button
                key={c.label}
                type="button"
                className={`${styles.attChip} ${at === key ? styles.attChipOn : ""}`}
                onClick={() => setAt(key)}
              >
                {c.label}
              </button>
            );
          })}
        </span>
      </div>

      {error && <p className={styles.attErr} role="alert">{error}</p>}

      <div className={styles.attRow2}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={pending || !step.trim() || !at}
          onClick={() => submit(step, at)}
        >
          {pending ? "Ukládám…" : "Uložit krok"}
        </button>
        {item.kind === "step_overdue" && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={pending}
            onClick={() => submit(null, null)}
            title="Krok je splněný — bez dalšího se věc vrátí mezi ty bez kroku"
          >
            Hotovo, zatím nic dalšího
          </button>
        )}
        <span className={styles.attSpacer} />
        <Link href={href} className="btn btn-sm btn-ghost">Otevřít kartu</Link>
      </div>
    </div>
  );
}

function SilenceSetting({ silenceDays }: { silenceDays: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(silenceDays));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const parsed = Number(value);
  const changed = value.trim() !== "" && parsed !== silenceDays;

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setSilenceDaysAction(parsed);
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <footer className={`${styles.panelFoot} ${styles.attSilence}`}>
      <label htmlFor="silence-days">Klient bez otevřené práce je v tichu po</label>
      <input
        id="silence-days"
        className={`field ${styles.attDays}`}
        inputMode="numeric"
        value={value}
        onChange={(e) => { setValue(e.target.value); setSaved(false); }}
        onKeyDown={(e) => e.key === "Enter" && changed && save()}
      />
      <span>{Number.isInteger(parsed) ? plural(parsed, "dni", "dnech", "dnech") : "dnech"}</span>
      {changed && (
        <button type="button" className="btn btn-sm" onClick={save} disabled={pending}>
          {pending ? "Ukládám…" : "Uložit"}
        </button>
      )}
      {saved && !changed && <em className={styles.attSaved}>Uloženo</em>}
      {error && <em className={styles.attErr} role="alert">{error}</em>}
    </footer>
  );
}
