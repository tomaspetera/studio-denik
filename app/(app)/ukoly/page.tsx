import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { listTasks, listClients, listCategories, countByBall } from "@/lib/tasks";
import TaskBoard from "./TaskBoard";

export const dynamic = "force-dynamic";

export default async function UkolyPage({
  searchParams,
}: {
  searchParams: Promise<{ zapsat?: string }>;
}) {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const [tasks, clients, categories] = await Promise.all([
    listTasks(ws.orgId),
    listClients(ws.orgId),
    listCategories(ws.orgId),
  ]);

  const { zapsat } = await searchParams;

  return (
    <TaskBoard
      tasks={tasks}
      clients={clients}
      categories={categories}
      counts={countByBall(tasks)}
      openComposer={zapsat === "1"}
    />
  );
}
