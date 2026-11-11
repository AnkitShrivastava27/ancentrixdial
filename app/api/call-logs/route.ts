import { NextRequest, NextResponse } from "next/server";
import { requireUser, isResponse } from "@/lib/api";
import { db } from "@/lib/firebase/admin";
import { z } from "zod";
import { recordActivity } from "@/lib/activity";

const schema = z.object({ contactName: z.string().max(120).default(""), number: z.string().min(1).max(40), direction: z.enum(["inbound", "outbound"]), status: z.enum(["connected", "missed", "rejected", "failed"]), duration: z.number().int().min(0).max(86400).default(0), notes: z.string().max(1000).default("") });
export async function GET(request: NextRequest) {
  const user = await requireUser(); if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const snap = await db.collection("call_logs").where("organizationId", "==", user.organizationId).get();
  const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, any>)).filter((c) => user.role === "owner" || c.userId === user.uid);
  const q = request.nextUrl.searchParams.get("q")?.toLowerCase(); return NextResponse.json((q ? data.filter((c) => `${c.contactName} ${c.number}`.toLowerCase().includes(q)) : data).sort((a,b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0)));
}
export async function POST(request: NextRequest) {
  const user = await requireUser(); if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Invalid call log" }, { status: 400 });
  const ref = await db.collection("call_logs").add({ ...parsed.data, organizationId: user.organizationId, userId: user.uid, userName: user.name, createdAt: new Date() }); await recordActivity(user, "call.logged", { callId: ref.id, direction: parsed.data.direction, status: parsed.data.status }); return NextResponse.json({ id: ref.id }, { status: 201 });
}
