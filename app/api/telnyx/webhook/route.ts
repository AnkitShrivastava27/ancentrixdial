import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { decryptTelnyxApiKey } from "@/lib/telnyx-api-key";
import { verifyTelnyxWebhook } from "@/lib/telnyx-webhook";
import type { DocumentData } from "firebase-admin/firestore";

export const runtime = "nodejs";

type TelnyxEvent = { data?: { id?: string; event_type?: string; payload?: { call_control_id?: string; connection_id?: string; direction?: string; from?: string; to?: string; state?: string } } };

async function action(apiKey: string, callControlId: string, name: string, body: object) {
  return fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/${name}`, {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
}

function webhookFor(request: NextRequest, callLogId: string, leg: string) {
  const url = new URL("/api/telnyx/webhook", process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin);
  url.searchParams.set("callLogId", callLogId); url.searchParams.set("leg", leg);
  return url.toString();
}

export async function POST(request: NextRequest) {
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const rawBody = await request.text();
  if (!verifyTelnyxWebhook(rawBody, request.headers.get("telnyx-timestamp"), request.headers.get("telnyx-signature-ed25519"))) return NextResponse.json({ error: "Invalid Telnyx webhook signature" }, { status: 401 });
  let event: TelnyxEvent;
  try { event = JSON.parse(rawBody) as TelnyxEvent; } catch { return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 }); }
  const detail = event.data; const payload = detail?.payload;
  if (!detail?.id || !detail.event_type || !payload?.call_control_id) return NextResponse.json({ error: "Incomplete Telnyx event" }, { status: 400 });

  const eventRef = db.collection("telnyx_webhook_events").doc(detail.id);
  const claimed = await db.runTransaction(async (tx) => { const prior = await tx.get(eventRef); if (prior.exists) return false; tx.create(eventRef, { receivedAt: new Date(), status: "processing" }); return true; });
  if (!claimed) return NextResponse.json({ ok: true, duplicate: true });

  try {
    let callLogId = request.nextUrl.searchParams.get("callLogId") || "";
    let leg = request.nextUrl.searchParams.get("leg") || "";
    let config: DocumentData | undefined;
    let organizationId = "";

    const mapped = await db.collection("telnyx_call_control").doc(payload.call_control_id).get();
    if (!callLogId && mapped.exists) { callLogId = mapped.data()?.callLogId || ""; leg = mapped.data()?.leg || ""; }
    let logRef = callLogId ? db.collection("call_logs").doc(callLogId) : null;
    let log = logRef ? (await logRef.get()).data() : undefined;
    if (log) organizationId = log.organizationId;

    if (!log && payload.connection_id) {
      const configSnap = await db.collection("telnyx_config").where("voiceAppId", "==", payload.connection_id).limit(1).get();
      const configDoc = configSnap.docs[0];
      if (configDoc) {
        config = configDoc.data(); organizationId = configDoc.id;
        if (detail.event_type === "call.initiated" && (payload.direction === "incoming" || payload.direction === "inbound")) {
          const ownerSnap = await db.collection("users").where("organizationId", "==", organizationId).get();
          const owner = ownerSnap.docs.find((doc) => doc.data().role === "owner");
          const ref = db.collection("call_logs").doc();
          await ref.set({ contactName: "", number: payload.from || "Unknown caller", direction: "inbound", status: "ringing", duration: 0, notes: "", organizationId, userId: owner?.id || "", userName: owner?.data().name || "Workspace", createdAt: new Date(), callControlId: payload.call_control_id });
          callLogId = ref.id; logRef = ref; log = (await ref.get()).data(); leg = "inbound";
          await db.collection("telnyx_call_control").doc(payload.call_control_id).set({ callLogId, organizationId, leg, createdAt: new Date() });
          if (!owner?.data().phone || !config.apiKey) {
            await ref.update({ status: "missed", endedAt: new Date() });
            if (config.apiKey) await action(decryptTelnyxApiKey(config.apiKey), payload.call_control_id, "hangup", {}).catch(() => {});
            await eventRef.update({ status: "processed", processedAt: new Date() });
            return NextResponse.json({ ok: true });
          } else {
            const answer = await action(decryptTelnyxApiKey(config.apiKey), payload.call_control_id, "answer", { command_id: detail.id });
            if (!answer.ok) throw new Error("Could not answer inbound Telnyx call");
            await ref.update({ ownerPhone: owner.data().phone });
          }
        }
      }
    }
    if (!logRef || !log || !organizationId) { await eventRef.update({ status: "ignored", processedAt: new Date() }); return NextResponse.json({ ok: true, ignored: true }); }
    if (!config) config = (await db.collection("telnyx_config").doc(organizationId).get()).data();
    if (!config?.apiKey) throw new Error("Telnyx API key is unavailable");
    const apiKey = decryptTelnyxApiKey(config.apiKey);
    const eventType = detail.event_type;

    if (eventType === "call.answered" && leg === "agent" && log.direction === "outbound") {
      const response = await action(apiKey, payload.call_control_id, "transfer", {
        to: log.number, from: config.outboundNumber,
        webhook_url: webhookFor(request, callLogId, "customer"), webhook_url_method: "POST", timeout_secs: 30,
        command_id: detail.id,
      });
      if (!response.ok) throw new Error(`Telnyx transfer failed (${response.status})`);
      await logRef.update({ transferredAt: new Date(), status: "ringing" });
    } else if (eventType === "call.answered" && leg === "inbound" && log.direction === "inbound") {
      const response = await action(apiKey, payload.call_control_id, "transfer", {
        to: log.ownerPhone, from: log.number, diversion: config.outboundNumber,
        webhook_url: webhookFor(request, callLogId, "owner"), webhook_url_method: "POST", timeout_secs: 30,
        command_id: detail.id,
      });
      if (!response.ok) throw new Error(`Telnyx inbound forwarding failed (${response.status})`);
      await logRef.update({ transferredAt: new Date() });
    } else if ((eventType === "call.answered" || eventType === "call.bridged") && (leg === "customer" || leg === "owner")) {
      await logRef.update({ status: "connected", connectedAt: new Date() });
      await db.collection("telnyx_call_control").doc(payload.call_control_id).set({ callLogId, organizationId, leg, createdAt: new Date() }, { merge: true });
    } else if (eventType === "call.hangup") {
      const current = (await logRef.get()).data() || {};
      if (current.connectedAt) {
        const start = current.connectedAt.toDate ? current.connectedAt.toDate().getTime() : new Date(current.connectedAt).getTime();
        await logRef.update({ status: "connected", endedAt: new Date(), duration: Math.max(0, Math.floor((Date.now() - start) / 1000)) });
      } else if (leg === "customer" || leg === "owner" || !current.transferredAt) {
        await logRef.update({ status: log.direction === "inbound" && leg === "owner" ? "missed" : "missed", endedAt: new Date() });
      }
    }
    await eventRef.update({ status: "processed", processedAt: new Date() });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await eventRef.delete().catch(() => {});
    console.error("Telnyx webhook processing failed", error);
    return NextResponse.json({ error: "Could not process Telnyx webhook" }, { status: 500 });
  }
}
