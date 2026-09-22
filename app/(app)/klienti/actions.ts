"use server";

import {
  createClient,
  updateClient,
  archiveClient,
  unarchiveClient,
  deleteClient,
  type ActionResult,
} from "@/lib/clients";
import {
  createClientContact,
  updateClientContact,
  deleteClientContact,
} from "@/lib/client-contacts";
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

type ClientForm = {
  name: string;
  color: string;
  contact: string;
  email: string;
  note: string;
  ico: string;
  dic: string;
  address: string;
  relationship: string;
};

export async function createClientAction(form: ClientForm): Promise<ActionResult> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") {
    return { ok: false, message: "Pracovní prostor není připravený." };
  }

  return createClient({ orgId: ws.orgId, ...form });
}

export async function updateClientAction(form: ClientForm & { id: string }): Promise<ActionResult> {
  return updateClient(form);
}

export async function archiveClientAction(clientId: string): Promise<ActionResult> {
  return archiveClient(clientId);
}

export async function unarchiveClientAction(clientId: string): Promise<ActionResult> {
  return unarchiveClient(clientId);
}

export async function deleteClientAction(clientId: string): Promise<ActionResult> {
  return deleteClient(clientId);
}

export async function createClientContactAction(form: {
  clientId: string;
  name: string;
  role: string;
  phone: string;
  email: string;
}): Promise<ActionResult> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") {
    return { ok: false, message: "Pracovní prostor není připravený." };
  }
  return createClientContact({ orgId: ws.orgId, ...form });
}

export async function updateClientContactAction(form: {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
}): Promise<ActionResult> {
  return updateClientContact(form);
}

export async function deleteClientContactAction(id: string): Promise<ActionResult> {
  return deleteClientContact(id);
}
