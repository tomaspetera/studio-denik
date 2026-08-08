import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { collectReport, loadReport } from "@/lib/report";
import { availableProviders } from "@/lib/ai";
import ReportView from "./ReportView";

export const dynamic = "force-dynamic";

export default async function ReportPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const [data, stored] = await Promise.all([
    collectReport(ws.orgId),
    loadReport(ws.orgId),
  ]);

  return (
    <ReportView
      data={{
        label: data.label,
        rangeText: data.rangeText,
        counts: data.counts,
        byCategory: data.byCategory,
        byClient: data.byClient.map((g) => ({
          client: g.client,
          percent: g.percent,
          items: g.items.map((t) => ({
            title: t.title,
            ball: t.ball,
            stepName: t.stepName,
            supplierName: t.supplierName,
            isLate: t.isLate,
          })),
        })),
        waiting: data.open
          .filter((t) => t.ball === "client" || t.ball === "supplier")
          .map((t) => ({
            title: t.title,
            clientName: t.clientName,
            supplierName: t.supplierName,
            ball: t.ball,
            isLate: t.isLate,
          })),
      }}
      stored={stored}
      providers={availableProviders()}
      org={{ name: ws.orgName, email: ws.email }}
      siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ""}
    />
  );
}
