import { NextRequest, NextResponse } from "next/server";
import { requireUser, isResponse } from "@/lib/api";
import { db } from "@/lib/firebase/admin";
import { z } from "zod";
import { recordActivity } from "@/lib/activity";

const schema = z.object({ name: z.string().trim().min(1).max(120), company: z.string().max(120).default(""), phone: z.string().trim().min(3).max(40), email: z.string().email().or(z.literal("")).default(""), notes: z.string().max(2000).default(""), tags: z.array(z.string().max(30)).max(20).default([]), favorite: z.boolean().default(false) });
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const { id } = await params; const ref = db.collection("contacts").doc(id); const doc = await ref.get();
  if (!doc.exists || doc.data()?.organizationId !== user.organizationId || (user.role !== "owner" && doc.data()?.ownerId !== user.uid)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = schema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await ref.update({ ...parsed.data, updatedAt: new Date() }); await recordActivity(user, "contact.updated", { contactId: id }); return NextResponse.json({ ok: true });
}
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const { id } = await params; const ref = db.collection("contacts").doc(id); const doc = await ref.get();
  if (!doc.exists || doc.data()?.organizationId !== user.organizationId || (user.role !== "owner" && doc.data()?.ownerId !== user.uid)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await ref.delete(); await recordActivity(user, "contact.deleted", { contactId: id }); return NextResponse.json({ ok: true });
}
