"use server";

import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string };

/**
 * Pošle přihlašovací odkaz na e-mail. Žádná hesla — není co ukrást
 * a není co zapomenout.
 */
export async function sendMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return { status: "error", message: "Zadej platnou e-mailovou adresu." };
  }

  let supabase;
  try {
    supabase = await supabaseServer();
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Aplikace není nastavená.",
    };
  }

  // Návratovou adresu odvozujeme z požadavku, ne z pevné konstanty — jinak by
  // odkaz z produkce vedl na localhost a naopak.
  const origin = process.env.NEXT_PUBLIC_SITE_URL || (await originFromRequest());

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  if (error) {
    return { status: "error", message: prettyError(error.message) };
  }

  return { status: "sent" };
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
}

async function originFromRequest(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function prettyError(message: string): string {
  if (/rate limit|too many/i.test(message)) {
    return "Odkaz jsme právě posílali. Zkus to za chvíli znovu.";
  }
  if (/signups not allowed|not authorized/i.test(message)) {
    return "Tenhle e-mail nemá přístup. Požádej správce o pozvánku.";
  }
  return message;
}
