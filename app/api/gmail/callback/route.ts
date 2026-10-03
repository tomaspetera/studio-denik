import { NextResponse, type NextRequest } from "next/server";
import { getWorkspace } from "@/lib/workspace";
import { connectMailbox } from "@/lib/mail-data";
import { supabaseServer } from "@/lib/supabase/server";
import { STATE_COOKIE } from "../start/route";

export const dynamic = "force-dynamic";
// Výměna kódu u Googlu a dotaz na adresu schránky — dva požadavky po síti.
export const maxDuration = 30;

/** Návrat od Googlu po udělení souhlasu. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const naPostu = (parametr: string) => NextResponse.redirect(new URL(`/posta?${parametr}`, origin));

  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") {
    return NextResponse.redirect(new URL("/prihlaseni", origin));
  }

  // Když souhlas odmítneš, Google vrátí `error=access_denied`.
  const odmitnuto = searchParams.get("error");
  if (odmitnuto) return naPostu(`chyba=${encodeURIComponent(odmitnuto)}`);

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const ulozenyState = request.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !ulozenyState || state !== ulozenyState) {
    return naPostu("chyba=stav");
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/prihlaseni", origin));

  const res = await connectMailbox(ws.orgId, user.id, code, origin);
  const odpoved = res.ok ? naPostu("pripojeno=1") : naPostu(`chyba=${encodeURIComponent(res.message)}`);
  odpoved.cookies.delete(STATE_COOKIE);
  return odpoved;
}
