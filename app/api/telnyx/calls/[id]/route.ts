import { NextRequest, NextResponse } from "next/server";
import { requireUser, isResponse } from "@/lib/api";
import { db } from "@/lib/firebase/admin";
import { decryptTelnyxApiKey } from "@/lib/telnyx-api-key";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const { id } = await params;
  const snap = await db.collection("call_logs").doc(id).get();
  const call = snap.data();
  if (!call || call.organizationId !== user.organizationId || (user.role !== "owner" && call.userId !== user.uid)) return NextResponse.json({ error: "Call not found" }, { status: 404 });
  const connectedAt = call.connectedAt?.toDate ? call.connectedAt.toDate().getTime() : call.connectedAt ? new Date(call.connectedAt).getTime() : null;
  return NextResponse.json({ id, status: call.status, connectedAt, endedAt: !!call.endedAt, duration: call.duration || 0 });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const { id } = await params;
  const ref = db.collection("call_logs").doc(id);
  const snap = await ref.get(); const call = snap.data();
  if (!call || call.organizationId !== user.organizationId || (user.role !== "owner" && call.userId !== user.uid)) return NextResponse.json({ error: "Call not found" }, { status: 404 });
  if (call.callControlId && !call.endedAt && call.status !== "missed" && call.status !== "failed" && call.status !== "rejected") {
    const config = (await db.collection("telnyx_config").doc(user.organizationId).get()).data();
    if (config?.apiKey) {
      await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(call.callControlId)}/actions/hangup`, {
        method: "POST", headers: { Authorization: `Bearer ${decryptTelnyxApiKey(config.apiKey)}`, "Content-Type": "application/json" }, body: JSON.stringify({}), cache: "no-store",
      }).catch(() => {});
    }
  }
  await ref.update({ status: call.connectedAt ? "connected" : "rejected", endedAt: new Date(), ...(call.connectedAt ? { duration: Math.max(0, Math.floor((Date.now() - call.connectedAt.toDate().getTime()) / 1000)) } : {}) });
  return NextResponse.json({ ok: true });
}
