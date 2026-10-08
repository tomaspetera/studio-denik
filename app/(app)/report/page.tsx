import { redirect } from "next/navigation";
import { getWorkspace, siteUrl } from "@/lib/workspace";
import { collectReport, findReportClient, loadReport } from "@/lib/report";
import { listClients } from "@/lib/tasks";
import { listPriorityClientIds } from "@/lib/clients";
import { availableProviders } from "@/lib/ai";
import ReportView from "./ReportView";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  searchParams,
}: {
  // `klient=<id>` zúží report na jednoho klienta; bez něj je za celé studio.
  searchParams: Promise<{ klient?: string }>;
}) {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const { klient } = await searchParams;
  const [client, clients, priority] = await Promise.all([
    findReportClient(ws.orgId, klient),
    listClients(ws.orgId),
    listPriorityClientIds(ws.orgId),
  ]);
  // Neplatný nebo cizí klient v adrese: zpátky na report za celé studio, ať
  // není pochyb, na co se člověk dívá.
  if (klient && !client) redirect("/report");

  const [data, stored] = await Promise.all([
    collectReport(ws.orgId, new Date(), client),
    loadReport(ws.orgId, new Date(), client?.id ?? null),
  ]);

  // Hlavní klient první — je to ten, komu se report posílá nejčastěji.
  const volby = [...clients]
    .sort((a, b) => Number(priority.has(b.id)) - Number(priority.has(a.id)) || a.name.localeCompare(b.name, "cs"))
    .map((c) => ({ id: c.id, name: c.name }));

  return (
    <ReportView
      // Jiný klient = jiný report s vlastním textem; rozepsané úpravy toho
      // předchozího se do něj nesmí přenést.
      key={client?.id ?? "studio"}
      client={client}
      clients={volby}
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
      signature={ws.fullName}
      siteUrl={siteUrl()}
    />
  );
}
