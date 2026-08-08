import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Návrat z přihlašovacího odkazu v e-mailu. Supabase sem pošle jednorázový
 * kód, který vyměníme za relaci a uložíme do cookies.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("dal"));

  // Odkaz může přijít vypršelý nebo už jednou použitý.
  const authError = searchParams.get("error_description") ?? searchParams.get("error");
  if (authError) {
    return NextResponse.redirect(
      `${origin}/prihlaseni?chyba=${encodeURIComponent(authError)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/prihlaseni`);
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/prihlaseni?chyba=${encodeURIComponent("Odkaz už není platný. Nech si poslat nový.")}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}

/**
 * Cíl přesměrování bereme z adresy, takže musí být relativní — jinak by šlo
 * odkazem poslat uživatele po přihlášení na cizí web.
 */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
