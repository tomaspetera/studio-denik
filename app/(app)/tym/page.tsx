import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { loadTeam } from "@/lib/team";
import { loadCapacity } from "@/lib/capacity";
import { listAbsences } from "@/lib/absences";
import TeamBoard from "./TeamBoard";

export const dynamic = "force-dynamic";

export default async function TymPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const [{ members, invites, amAdmin }, capacity, absences] = await Promise.all([
    loadTeam(ws.orgId),
    loadCapacity(ws.orgId),
    listAbsences(ws.orgId),
  ]);

  return (
    <TeamBoard
      orgName={ws.orgName}
      members={members}
      invites={invites}
      amAdmin={amAdmin}
      capacity={capacity}
      absences={absences}
    />
  );
}
