import { NextRequest, NextResponse } from "next/server";
import { requireUser, isResponse } from "@/lib/api";
import { db } from "@/lib/firebase/admin";
import { z } from "zod";
import { recordActivity } from "@/lib/activity";

const schema = z.object({ name: z.string().trim().min(1).max(120), company: z.string().max(120).default(""), phone: z.string().trim().min(3).max(40), email: z.string().email().or(z.literal("")).default(""), notes: z.string().max(2000).default(""), tags: z.array(z.string().max(30)).max(20).default([]), favorite: z.boolean().default(false) });
export async function GET(request: NextRequest) {
  const user = await requireUser(); if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const snap = await db.collection("contacts").where("organizationId", "==", user.organizationId).get();
  const contacts = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, any>)).filter((contact) => user.role === "owner" || contact.ownerId === user.uid);
  const q = request.nextUrl.searchParams.get("q")?.toLowerCase();
  return NextResponse.json(q ? contacts.filter((c) => `${c.name} ${c.company} ${c.phone} ${c.email}`.toLowerCase().includes(q)) : contacts);
}
export async function POST(request: NextRequest) {
  const user = await requireUser(); if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const ref = await db.collection("contacts").add({ ...parsed.data, organizationId: user.organizationId, ownerId: user.uid, createdAt: new Date(), updatedAt: new Date() });
  await recordActivity(user, "contact.created", { contactId: ref.id, name: parsed.data.name });
  return NextResponse.json({ id: ref.id, ...parsed.data }, { status: 201 });
}
