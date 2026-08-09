import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import type { Role } from "./domain";

export type { Role };

export type Member = {
  userId: string;
  email: string | null;
  fullName: string | null;
  initials: string | null;
  role: Role;
  joinedAt: string;
  isMe: boolean;
};

export type Invite = {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
};

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function loadTeam(orgId: string): Promise<{
  members: Member[];
  invites: Invite[];
  amAdmin: boolean;
}> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: rows }, { data: pending }] = await Promise.all([
    supabase
      .from("team_view")
      .select("user_id, role, joined_at, email, full_name, initials")
      .eq("org_id", orgId)
      .order("joined_at"),
    // Pozvánky vidí jen správce — komu na ně nestačí práva, dostane prázdno.
    supabase
      .from("invites")
      .select("id, email, role, created_at, expires_at")
      .eq("org_id", orgId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
  ]);

  const members: Member[] = ((rows ?? []) as unknown as {
    user_id: string; role: Role; joined_at: string;
    email: string | null; full_name: string | null; initials: string | null;
  }[]).map((r) => ({
    userId: r.user_id,
    email: r.email,
    fullName: r.full_name,
    initials: r.initials,
    role: r.role,
    joinedAt: r.joined_at,
    isMe: r.user_id === user?.id,
  }));

  return {
    members,
    invites: ((pending ?? []) as unknown as {
      id: string; email: string; role: Role; created_at: string; expires_at: string;
    }[]).map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.created_at,
      expiresAt: i.expires_at,
    })),
    amAdmin: members.some((m) => m.isMe && m.role === "admin"),
  };
}

export async function inviteMember(
  orgId: string,
  email: string,
  role: Role,
): Promise<ActionResult> {
  const clean = email.trim().toLowerCase();
  if (!clean || !clean.includes("@") || clean.includes(" ")) {
    return { ok: false, message: "Zadej platnou e-mailovou adresu." };
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  // Kdo už v týmu je, znovu zvát nedává smysl.
  const { data: existing } = await supabase
    .from("team_view")
    .select("user_id")
    .eq("org_id", orgId)
    .ilike("email", clean)
    .maybeSingle();

  if (existing) {
    return { ok: false, message: "Tenhle e-mail už v týmu je." };
  }

  const { error } = await supabase.from("invites").insert({
    org_id: orgId,
    email: clean,
    role,
    invited_by: user?.id ?? null,
  });

  if (error) {
    // Jednoznačný index na (org_id, email) u nevyřízených pozvánek.
    if (error.code === "23505") {
      return { ok: false, message: "Pozvánka na tenhle e-mail už čeká." };
    }
    return { ok: false, message: error.message };
  }

  revalidatePath("/tym");
  return { ok: true };
}

export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("invites").delete().eq("id", inviteId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/tym");
  return { ok: true };
}

export async function changeRole(
  orgId: string,
  userId: string,
  role: Role,
): Promise<ActionResult> {
  const guard = await guardLastAdmin(orgId, userId, role);
  if (guard) return guard;

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("memberships")
    .update({ role })
    .eq("org_id", orgId)
    .eq("user_id", userId);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/tym");
  return { ok: true };
}

export async function removeMember(orgId: string, userId: string): Promise<ActionResult> {
  const guard = await guardLastAdmin(orgId, userId, null);
  if (guard) return guard;

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("memberships")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", userId);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/tym");
  return { ok: true };
}

/**
 * Poslední správce nesmí zmizet.
 *
 * Bez něj by prostor nešlo spravovat vůbec — nikdo by nemohl pozvat dalšího
 * člověka ani vrátit práva zpátky, protože obojí smí jen správce. Databáze
 * to sama neuhlídá, tady je na to jediné místo.
 */
async function guardLastAdmin(
  orgId: string,
  userId: string,
  newRole: Role | null,
): Promise<ActionResult | null> {
  if (newRole === "admin") return null;

  const supabase = await supabaseServer();
  const { data: admins } = await supabase
    .from("team_view")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("role", "admin");

  const list = (admins ?? []) as { user_id: string }[];
  const isLast = list.length <= 1 && list.some((a) => a.user_id === userId);

  if (!isLast) return null;

  return {
    ok: false,
    message:
      newRole === null
        ? "Tohle je poslední správce. Nejdřív povyš někoho jiného, jinak by prostor nešlo spravovat."
        : "Tohle je poslední správce. Nejdřív povyš někoho jiného.",
  };
}
