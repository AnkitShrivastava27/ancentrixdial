import { NextRequest, NextResponse } from "next/server";
import { requireUser, isResponse } from "@/lib/api";
import { db } from "@/lib/firebase/admin";
import { decryptTelnyxApiKey } from "@/lib/telnyx-api-key";

function toMillis(value: any): number | null {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  const snap = await db.collection("call_logs").doc(id).get();
  const call = snap.data();
  if (!call || call.organizationId !== user.organizationId || (user.role !== "owner" && call.userId !== user.uid)) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  return NextResponse.json({
    id,
    status: call.status,
    number: call.number || null,
    contactName: call.contactName || null,
    agentPhone: call.agentPhone || null,
    callerId: call.callerId || null,
    agentCallControlId: call.callControlId || null,
    customerCallControlId: call.customerCallControlId || null,
    connectedAt: toMillis(call.connectedAt),
    customerDialedAt: toMillis(call.customerDialedAt),
    customerAnsweredAt: toMillis(call.customerAnsweredAt),
    customerDialStatus: call.customerDialStatus || null,
    customerDialError: call.customerDialError || null,
    customerDialHttpStatus: call.customerDialHttpStatus || null,
    customerDialTarget: call.customerDialTarget || call.number || null,
    customerDialAttemptedAt: toMillis(call.customerDialAttemptedAt),
    customerDialCallerId: call.customerDialCallerId || null,
    customerDialRequestSummary: call.customerDialRequestSummary || null,
    agentDialStatus: call.agentDialStatus || null,
    agentAnsweredAt: toMillis(call.agentAnsweredAt),
    agentBridgedAt: toMillis(call.agentBridgedAt),
    customerBridgedAt: toMillis(call.customerBridgedAt),
    bridgeMode: call.bridgeMode || null,
    callSessionId: call.telnyxCallSessionId || call.agentCallSessionId || call.customerCallSessionId || null,
    agentCallSessionId: call.agentCallSessionId || null,
    customerCallSessionId: call.customerCallSessionId || null,
    lastTelnyxEvent: call.lastTelnyxEvent || null,
    lastTelnyxEventAt: toMillis(call.lastTelnyxEventAt),
    lastWebhookLeg: call.lastWebhookLeg || null,
    lastWebhookCallControlId: call.lastWebhookCallControlId || null,
    lastWebhookFrom: call.lastWebhookFrom || null,
    lastWebhookTo: call.lastWebhookTo || null,
    webhookError: call.webhookError || null,
    webhookErrorAt: toMillis(call.webhookErrorAt),
    webhookErrorEventType: call.webhookErrorEventType || null,
    webhookErrorLeg: call.webhookErrorLeg || null,
    hangupError: call.hangupError || null,
    sipHangupCause: call.sipHangupCause || null,
    hangupCause: call.hangupCause || null,
    hangupSource: call.hangupSource || null,
    endedAt: !!call.endedAt,
    endedByLeg: call.endedByLeg || null,
    errorMessage: call.errorMessage || null,
    duration: call.duration || 0,
  });
}

async function hangupLeg(apiKey: string, callControlId: string, commandId: string) {
  try {
    const response = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/hangup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ command_id: commandId }),
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    const detail = String(body?.errors?.[0]?.detail || "Telnyx rejected the hangup command.").slice(0, 300);
    const alreadyEnded = response.status === 422 && /already ended|no longer active|not active|cannot receive commands/i.test(detail);
    return {
      callControlId,
      ok: response.ok || alreadyEnded,
      httpStatus: response.status,
      detail: response.ok ? null : detail,
    };
  } catch (error) {
    return {
      callControlId,
      ok: false,
      httpStatus: 0,
      detail: error instanceof Error ? error.message.slice(0, 300) : "Network error while sending hangup.",
    };
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  const ref = db.collection("call_logs").doc(id);
  const snap = await ref.get();
  const call = snap.data();
  if (!call || call.organizationId !== user.organizationId || (user.role !== "owner" && call.userId !== user.uid)) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }
  if (call.endedAt) return NextResponse.json({ ok: true, alreadyEnded: true });

  const config = (await db.collection("telnyx_config").doc(user.organizationId).get()).data();
  if (!config?.apiKey) return NextResponse.json({ error: "Telnyx API key is unavailable; cannot terminate the active call." }, { status: 503 });

  const now = new Date();
  await ref.update({ status: "ending", endRequestedAt: now, endedByLeg: "app", hangupPending: true, hangupError: null });
  const apiKey = decryptTelnyxApiKey(config.apiKey);
  const ids = [...new Set([call.callControlId, call.customerCallControlId].filter((value): value is string => typeof value === "string" && value.length > 0))];
  const results = await Promise.all(ids.map((callControlId, index) => hangupLeg(apiKey, callControlId, `${id}-hangup-${index}`)));
  const failures = results.filter((result) => !result.ok);

  if (failures.length) {
    await ref.update({
      status: "ending",
      hangupPending: false,
      hangupResults: results,
      hangupError: failures.map((item) => item.detail).join("; "),
    });
    return NextResponse.json({ ok: false, error: "Telnyx did not confirm ending every call leg. The app will keep the call visible so you can retry.", results }, { status: 502 });
  }

  const endedAt = new Date();
  await ref.update({
    status: "ended",
    endedAt,
    endedByLeg: "app",
    hangupResults: results,
    hangupPending: false,
    hangupError: null,
    ...(call.connectedAt ? { duration: Math.max(0, Math.floor((endedAt.getTime() - (toMillis(call.connectedAt) || endedAt.getTime())) / 1000)) } : {}),
  });
  return NextResponse.json({ ok: true, results });
}
