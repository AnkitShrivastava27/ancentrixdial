import { NextRequest, NextResponse } from "next/server";
import { requireUser, isResponse } from "@/lib/api";
import { db } from "@/lib/firebase/admin";
import { z } from "zod";

export async function PATCH(request: NextRequest) {
  const user = await requireUser(); if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const parsed = z.object({
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().max(40).optional().default(""),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid name and phone number." }, { status: 400 });
  await db.collection("users").doc(user.uid).update({ name: parsed.data.name, phone: parsed.data.phone, updatedAt: new Date() });
  return NextResponse.json({ ok: true });
}
