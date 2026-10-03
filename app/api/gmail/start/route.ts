import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getWorkspace } from "@/lib/workspace";
import { authUrl, isGmailConfigured } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export const STATE_COOKIE = "gmail_state";

/**
 * Začátek připojení Gmailu — přesměruje ke Googlu.
 *
 * `state` je náhodný řetězec uložený do cookie a zároveň poslaný Googlu.
 * Při návratu se obojí porovná; bez toho by někdo mohl podstrčit odkaz,
 * který by k účtu připojil cizí schránku.
 */
export async function GET(request: NextRequest) {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") {
    return NextResponse.redirect(new URL("/prihlaseni", request.url));
  }
  if (!isGmailConfigured()) {
    return NextResponse.redirect(new URL("/posta?chyba=nenastaveno", request.url));
  }

  const state = randomBytes(24).toString("base64url");
  const odpoved = NextResponse.redirect(authUrl(request.nextUrl.origin, state));

  odpoved.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return odpoved;
}
