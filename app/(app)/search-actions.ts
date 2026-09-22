"use server";

import { globalSearch, type SearchResult } from "@/lib/search";
import { getWorkspace } from "@/lib/workspace";

export async function globalSearchAction(query: string): Promise<SearchResult[]> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") return [];
  return globalSearch(ws.orgId, query);
}
