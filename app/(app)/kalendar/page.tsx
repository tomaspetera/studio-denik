import { redirect } from "next/navigation";
import { getWorkspace, siteUrl } from "@/lib/workspace";
import { listCalendarEvents, getCalendarToken } from "@/lib/calendar";
import { todayKeyPrague } from "@/lib/domain";
import CalendarBoard from "./CalendarBoard";

export const dynamic = "force-dynamic";

export default async function KalendarPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const [events, calendarToken] = await Promise.all([
    listCalendarEvents(ws.orgId),
    getCalendarToken(ws.orgId),
  ]);

  return (
    <CalendarBoard
      events={events}
      today={todayKeyPrague()}
      calendarToken={calendarToken}
      siteUrl={siteUrl()}
    />
  );
}
