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
  const toMillis = (value: any) => value?.toDate ? value.toDate().getTime() : value ? new Date(value).getTime() : null;
  const connectedAt = toMillis(call.connectedAt);
  const customerDialedAt = toMillis(call.customerDialedAt);
  const customerAnsweredAt = toMillis(call.customerAnsweredAt);
  const bridgeRequestedAt = toMillis(call.customerAnsweredAt);
  return NextResponse.json({
    id,
    status: call.status,
    connectedAt,
    customerDialedAt,
    customerAnsweredAt,
    bridgeRequestedAt,
    bridgeErrorMessage: call.bridgeErrorMessage || null,
    callSessionId: call.telnyxCallSessionId || call.agentCallSessionId || call.customerCallSessionId || null,
    agentCallSessionId: call.agentCallSessionId || null,
    customerCallSessionId: call.customerCallSessionId || null,
    agentBridgedAt: toMillis(call.agentBridgedAt),
    customerBridgedAt: toMillis(call.customerBridgedAt),
    lastTelnyxEvent: call.lastTelnyxEvent || null,
    sipHangupCause: call.sipHangupCause || null,
    hangupCause: call.hangupCause || null,
    endedAt: !!call.endedAt,
    endedByLeg: call.endedByLeg || null,
    errorMessage: call.errorMessage || null,
    duration: call.duration || 0,
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const { id } = await params;
  const ref = db.collection("call_logs").doc(id);
  const snap = await ref.get(); const call = snap.data();
  if (!call || call.organizationId !== user.organizationId || (user.role !== "owner" && call.userId !== user.uid)) return NextResponse.json({ error: "Call not found" }, { status: 404 });
  if (!call.endedAt && call.status !== "missed" && call.status !== "failed" && call.status !== "rejected") {
    const config = (await db.collection("telnyx_config").doc(user.organizationId).get()).data();
    if (config?.apiKey) {
      const apiKey = decryptTelnyxApiKey(config.apiKey);
      const callControlIds = [call.callControlId, call.customerCallControlId].filter((value): value is string => typeof value === "string" && value.length > 0);
      await Promise.all(callControlIds.map((callControlId) => fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/hangup`, {
        method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({}), cache: "no-store",
      }).catch(() => undefined)));
    }
  }
  await ref.update({ status: call.connectedAt ? "connected" : "rejected", endedAt: new Date(), ...(call.connectedAt ? { duration: Math.max(0, Math.floor((Date.now() - call.connectedAt.toDate().getTime()) / 1000)) } : {}) });
  return NextResponse.json({ ok: true });
}
