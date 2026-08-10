"use server";

import { createClient, archiveClient, type ActionResult } from "@/lib/clients";
import { getWorkspace } from "@/lib/workspace";
import { lookupAres, type AresResult } from "@/lib/ares";

/**
 * Dohledání v ARESu běží na serveru, ne v prohlížeči.
 *
 * ARES neposílá hlavičky, které by prohlížeči dovolily číst odpověď z cizí
 * domény — dotaz z klienta by skončil na zabezpečení prohlížeče.
 */
export async function lookupAresAction(ico: string): Promise<AresResult> {
  return lookupAres(ico);
}

export async function createClientAction(form: {
  name: string;
  color: string;
  contact: string;
  email: string;
  note: string;
  ico: string;
  dic: string;
  address: string;
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
    ico: form.ico,
    dic: form.dic,
    address: form.address,
  });
}

export async function archiveClientAction(clientId: string): Promise<ActionResult> {
  return archiveClient(clientId);
}
