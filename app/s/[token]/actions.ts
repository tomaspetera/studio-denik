"use server";

import { clientDecide, type DecideResult } from "@/lib/client-board";

/**
 * Token sem posílá prohlížeč, protože ho má stejně v adrese. Nic se tím
 * neotevírá — co s ním jde udělat, rozhoduje funkce v databázi, ne tahle
 * akce. Kdyby si někdo zavolal akci sám, narazí na totéž.
 */
export async function decideAction(input: {
  token: string;
  taskId: string;
  approve: boolean;
  note: string;
}): Promise<DecideResult> {
  return clientDecide(input);
}
