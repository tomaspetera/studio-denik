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

  // Veřejné cesty: přihlášení, callback z e-mailu, sdílený report,
  // schvalovací odkaz klienta a odběr kalendáře do telefonu. Všechny se
  // prokazují tokenem v adrese a účet k nim z principu nepatří — kdyby sem
  // nepatřily, žádost by skončila na přihlašovací obrazovce a odkaz by byl
  // k ničemu (Google/Apple Kalendář se navíc přihlásit ani neumí).
  //
  // `/api/cron/` patří sem ze stejného principu, i když ho nevolá člověk —
  // Vercel na naplánovanou úlohu žádnou přihlašovací session nemá, ověřuje
  // se vlastním tajným klíčem uvnitř té trasy. Cron navíc přesměrování
  // nenásleduje, takže by se bez týhle výjimky nikdy doopravdy nespustil.
  // Manifest a service worker patří sem ze stejného důvodu jako favicon —
  // je to veřejný statický soubor bez citlivého obsahu, který si prohlížeč
  // umí natáhnout i dřív, než má appka jistotu, že je někdo přihlášený
  // (manifest se generuje pro celou appku, tedy i pro veřejnou přihlašovací
  // stránku).
  const isPublic =
    pathname.startsWith("/prihlaseni") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/s/") ||
    pathname.startsWith("/api/kalendar/") ||
    pathname.startsWith("/api/cron/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/icon-192" ||
    pathname === "/icon-512";

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
