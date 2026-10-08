import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { listTasks } from "@/lib/tasks";
import { loadPlans } from "@/lib/week-data";
import { buildWeek, weekStartOf } from "@/lib/week";
import { isValidDateKey } from "@/lib/attention";
import { addDaysKey, todayKeyPrague } from "@/lib/domain";
import WeekBoard from "./WeekBoard";

export const dynamic = "force-dynamic";

export default async function TydenPage({
  searchParams,
}: {
  // `od=RRRR-MM-DD` — kterýkoli den týdne, který se má ukázat; bez něj tento týden.
  searchParams: Promise<{ od?: string }>;
}) {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const { od } = await searchParams;
  const today = todayKeyPrague();
  const start = weekStartOf(od && isValidDateKey(od) ? od : today);

  const [tasks, plans] = await Promise.all([listTasks(ws.orgId), loadPlans(ws.orgId)]);
  const week = buildWeek(
    tasks.map((t) => ({ ...t, planned_for: plans.get(t.id) ?? null })),
    today,
    start,
  );

  return (
    <WeekBoard
      week={week}
      today={today}
      prevHref={`/tyden?od=${addDaysKey(week.start, -7)}`}
      nextHref={`/tyden?od=${addDaysKey(week.start, 7)}`}
      nextMonday={addDaysKey(week.start, 7)}
    />
  );
}
