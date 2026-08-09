import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { loadTeam } from "@/lib/team";
import TeamBoard from "./TeamBoard";

export const dynamic = "force-dynamic";

export default async function TymPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");
  if (ws.state !== "ready") redirect("/");

  const { members, invites, amAdmin } = await loadTeam(ws.orgId);

  return (
    <TeamBoard
      orgName={ws.orgName}
      members={members}
      invites={invites}
      amAdmin={amAdmin}
    />
  );
}
