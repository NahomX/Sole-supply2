import { NextResponse } from "next/server";
import { supabaseServer, type Profile, type Role } from "./supabase";

export type SessionInfo = {
  userId: string;
  email: string | null;
  profile: Profile | null;
};

export async function getSessionInfo(): Promise<SessionInfo | null> {
  const db = supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data: profile } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return {
    userId: user.id,
    email: user.email ?? null,
    profile: (profile as Profile) ?? null,
  };
}

export async function requireRole(roles: Role[]) {
  const session = await getSessionInfo();
  if (!session) {
    return {
      session: null,
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  const role = session.profile?.role ?? "customer";
  if (!roles.includes(role)) {
    return {
      session,
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { session, error: null };
}
