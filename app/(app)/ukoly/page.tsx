import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { listTasks, listClients, listCategories, countByBall } from "@/lib/tasks";
import { listTemplates } from "@/lib/templates";
import { listRecurring } from "@/lib/recurring";
import { todayKeyPrague } from "@/lib/domain";
import TaskBoard from "./TaskBoard";

export const dynamic = "force-dynamic";

export default async function UkolyPage({
  searchParams,
}: {
  // `datum` přichází z kalendáře — klik na den předvyplní termín nového
  // úkolu. `otevrit` přichází z kalendáře i odjinud — rovnou rozbalí detail
  // konkrétního úkolu, ať se v seznamu nemusí hledat.
  searchParams: Promise<{ zapsat?: string; datum?: string; otevrit?: string }>;
}) {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const [tasks, clients, categories, templates, rules] = await Promise.all([
    listTasks(ws.orgId),
    listClients(ws.orgId),
    listCategories(ws.orgId),
    listTemplates(ws.orgId),
    listRecurring(ws.orgId),
  ]);

  const { zapsat, datum, otevrit } = await searchParams;

  return (
    <TaskBoard
      tasks={tasks}
      clients={clients}
      categories={categories}
      templates={templates}
      rules={rules}
      today={todayKeyPrague()}
      counts={countByBall(tasks)}
      openComposer={zapsat === "1"}
      presetDate={datum}
      openTaskId={otevrit}
    />
  );
}
