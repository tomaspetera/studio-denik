"use server";

import { createClient, archiveClient, type ActionResult } from "@/lib/clients";
import { getWorkspace } from "@/lib/workspace";

export async function createClientAction(form: {
  name: string;
  color: string;
  contact: string;
  email: string;
  note: string;
}): Promise<ActionResult> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") {
    return { ok: false, message: "Pracovní prostor není připravený." };
  }

  return createClient({
    orgId: ws.orgId,
    name: form.name,
    color: form.color,
    contact: form.contact,
    email: form.email,
    note: form.note,
  });
}

export async function archiveClientAction(clientId: string): Promise<ActionResult> {
  return archiveClient(clientId);
}
