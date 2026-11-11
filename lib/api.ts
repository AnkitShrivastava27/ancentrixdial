import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth";

export async function requireUser(ownerOnly = false): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (ownerOnly && user.role !== "owner") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  return user;
}
export const isResponse = (value: SessionUser | NextResponse): value is NextResponse => value instanceof NextResponse;
