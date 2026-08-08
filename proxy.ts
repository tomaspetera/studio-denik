import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Obnovuje přihlašovací relaci při každém požadavku a hlídá přístup.
 *
 * Bez tohohle by se relace nikdy neprodloužila a uživatele by to po expiraci
 * tokenu vyhodilo — serverové komponenty totiž cookies zapisovat nemůžou.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Veřejné cesty: přihlášení, callback z e-mailu a sdílený report.
  const isPublic =
    pathname.startsWith("/prihlaseni") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/r/");

  // Dokud nejsou vyplněné klíče, appku nemá smysl chránit — pustíme ji dál,
  // aby uvítací obrazovka mohla vysvětlit, co doplnit.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() ověřuje token u serveru — na rozdíl od getSession(), která věří
  // obsahu cookie a dá se tedy podvrhnout.
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/prihlaseni";
    url.searchParams.set("dal", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/prihlaseni")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Všechno kromě statických souborů a obrázků.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
