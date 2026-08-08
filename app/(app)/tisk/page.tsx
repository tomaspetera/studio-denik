import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { listPrintJobs } from "@/lib/print";
import PrintBoard from "./PrintBoard";

export const dynamic = "force-dynamic";

export default async function TiskPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const jobs = await listPrintJobs(ws.orgId);
  return <PrintBoard jobs={jobs} />;
}
