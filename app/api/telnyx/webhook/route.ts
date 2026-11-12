import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { decryptTelnyxApiKey } from "@/lib/telnyx-api-key";
import { verifyTelnyxWebhook } from "@/lib/telnyx-webhook";
import type { DocumentData } from "firebase-admin/firestore";

export const runtime = "nodejs";

type TelnyxEvent = {
  data?: {
    id?: string;
    event_type?: string;
    payload?: {
      call_control_id?: string;
      connection_id?: string;
      direction?: string;
      from?: string;
      to?: string;
      state?: string;
    };
  };
};

async function action(apiKey: string, callControlId: string, name: string, body: object) {
  return fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

function webhookFor(request: NextRequest, callLogId: string, leg: string) {
  const url = new URL("/api/telnyx/webhook", process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin);
  url.searchParams.set("callLogId", callLogId);
  url.searchParams.set("leg", leg);
  return url.toString();
}

function timestampMillis(value: any): number | null {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: NextRequest) {
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const rawBody = await request.text();
  const verification = verifyTelnyxWebhook(
    rawBody,
    request.headers.get("telnyx-timestamp"),
    request.headers.get("telnyx-signature-ed25519"),
  );
  if (!verification.ok) {
    // Keep this diagnostic actionable without ever logging the key, signature,
    // or webhook payload. It distinguishes a missing Render variable from a
    // wrong/rotated key and malformed or expired webhook headers.
    console.error(`Rejected Telnyx webhook: ${verification.reason}.`);
    return NextResponse.json(
      { error: "Telnyx webhook signature verification failed." },
      { status: 401 },
    );
  }

  let event: TelnyxEvent;
  try {
    event = JSON.parse(rawBody) as TelnyxEvent;
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  const detail = event.data;
  const payload = detail?.payload;
  if (!detail?.id || !detail.event_type || !payload?.call_control_id) {
    return NextResponse.json({ error: "Incomplete Telnyx event" }, { status: 400 });
  }

  const eventRef = db.collection("telnyx_webhook_events").doc(detail.id);
  const claimed = await db.runTransaction(async (tx) => {
    const prior = await tx.get(eventRef);
    if (prior.exists) return false;
    tx.create(eventRef, { receivedAt: new Date(), status: "processing" });
    return true;
  });
  if (!claimed) return NextResponse.json({ ok: true, duplicate: true });

  try {
    let callLogId = request.nextUrl.searchParams.get("callLogId") || "";
    let leg = request.nextUrl.searchParams.get("leg") || "";
    let config: DocumentData | undefined;
    let organizationId = "";

    const mapped = await db.collection("telnyx_call_control").doc(payload.call_control_id).get();
    if (!callLogId && mapped.exists) {
      callLogId = mapped.data()?.callLogId || "";
      leg = mapped.data()?.leg || "";
    }

    let logRef = callLogId ? db.collection("call_logs").doc(callLogId) : null;
    let log = logRef ? (await logRef.get()).data() : undefined;
    if (log) organizationId = log.organizationId;

    // Inbound call: identify the workspace from the Voice API connection and forward it to the owner.
    if (!log && payload.connection_id) {
      const configSnap = await db.collection("telnyx_config").where("voiceAppId", "==", payload.connection_id).limit(1).get();
      const configDoc = configSnap.docs[0];
      if (configDoc) {
        config = configDoc.data();
        organizationId = configDoc.id;
        if (detail.event_type === "call.initiated" && (payload.direction === "incoming" || payload.direction === "inbound")) {
          const ownerSnap = await db.collection("users").where("organizationId", "==", organizationId).get();
          const owner = ownerSnap.docs.find((doc) => doc.data().role === "owner");
          const ref = db.collection("call_logs").doc();
          await ref.set({
            contactName: "",
            number: payload.from || "Unknown caller",
            direction: "inbound",
            status: "ringing",
            duration: 0,
            notes: "",
            organizationId,
            userId: owner?.id || "",
            userName: owner?.data().name || "Workspace",
            createdAt: new Date(),
            callControlId: payload.call_control_id,
          });
          callLogId = ref.id;
          logRef = ref;
          log = (await ref.get()).data();
          leg = "inbound";
          await db.collection("telnyx_call_control").doc(payload.call_control_id).set({ callLogId, organizationId, leg, createdAt: new Date() });

          if (!owner?.data().phone || !config.apiKey) {
            await ref.update({ status: "missed", endedAt: new Date() });
            if (config.apiKey) await action(decryptTelnyxApiKey(config.apiKey), payload.call_control_id, "hangup", {}).catch(() => {});
            await eventRef.update({ status: "processed", processedAt: new Date() });
            return NextResponse.json({ ok: true });
          }

          const answer = await action(decryptTelnyxApiKey(config.apiKey), payload.call_control_id, "answer", { command_id: detail.id });
          if (!answer.ok) throw new Error("Could not answer inbound Telnyx call");
          await ref.update({ ownerPhone: owner.data().phone });
        }
      }
    }

    if (!logRef || !log || !organizationId) {
      await eventRef.update({ status: "ignored", processedAt: new Date() });
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (!config) config = (await db.collection("telnyx_config").doc(organizationId).get()).data();
    if (!config?.apiKey) throw new Error("Telnyx API key is unavailable");
    const apiKey = decryptTelnyxApiKey(config.apiKey);
    const eventType = detail.event_type;

    // Outbound phone bridge: after the employee answers, dial the selected CRM contact.
    // We link the two legs here, then explicitly issue Telnyx's Bridge command when the
    // customer answers. This avoids treating an answered call as an audible connection
    // before the media bridge has actually been established.
    if (eventType === "call.answered" && leg === "agent" && log.direction === "outbound") {
      const latest = (await logRef.get()).data() || {};
      if (!latest.customerCallControlId) {
        const response = await fetch("https://api.telnyx.com/v2/calls", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            connection_id: config.voiceAppId,
            to: log.number,
            from: config.outboundNumber,
            link_to: payload.call_control_id,
            bridge_intent: true,
            webhook_url: webhookFor(request, callLogId, "customer"),
            webhook_url_method: "POST",
            timeout_secs: 30,
          }),
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({}));
        const customerCallControlId = result?.data?.call_control_id;
        if (!response.ok || typeof customerCallControlId !== "string") {
          const detailText = String(result?.errors?.[0]?.detail || `Telnyx could not dial the contact (HTTP ${response.status}).`).slice(0, 500);
          await logRef.update({ status: "failed", errorMessage: detailText, endedAt: new Date() });
          await action(apiKey, payload.call_control_id, "hangup", {}).catch(() => {});
        } else {
          const now = new Date();
          await db.collection("telnyx_call_control").doc(customerCallControlId).set({
            callLogId,
            organizationId,
            leg: "customer",
            createdAt: now,
          });
          await logRef.update({
            agentAnsweredAt: latest.agentAnsweredAt || now,
            customerDialedAt: now,
            customerCallControlId,
            status: "ringing",
            errorMessage: null,
          });
        }
      }
    } else if (eventType === "call.answered" && leg === "customer" && log.direction === "outbound") {
      // The employee and contact are now both on answered call legs. Explicitly
      // bridge them; call.answered alone does not mean the two parties can hear
      // each other. Telnyx emits call.bridged for both legs after media is joined.
      const latest = (await logRef.get()).data() || {};
      const agentCallControlId = latest.callControlId;
      const customerCallControlId = payload.call_control_id;

      if (typeof agentCallControlId !== "string" || !agentCallControlId) {
        const message = "The employee call leg is missing; the two callers could not be bridged.";
        await logRef.update({ status: "failed", errorMessage: message, bridgeErrorMessage: message, endedAt: new Date() });
        await action(apiKey, customerCallControlId, "hangup", {}).catch(() => {});
      } else if (!latest.bridgeCommandAcceptedAt && !latest.connectedAt) {
        // Claim the bridge command so duplicate webhook deliveries cannot race
        // and issue multiple bridge requests for the same call.
        const shouldBridge = await db.runTransaction(async (tx) => {
          const currentSnap = await tx.get(logRef!);
          const current = currentSnap.data() || {};
          const pendingAt = timestampMillis(current.bridgeCommandPendingAt);
          const pendingIsFresh = Boolean(current.bridgeCommandPending && pendingAt && Date.now() - pendingAt < 45_000);
          if (current.bridgeCommandAcceptedAt || current.connectedAt || pendingIsFresh) return false;
          tx.update(logRef!, {
            status: "bridging",
            customerAnsweredAt: current.customerAnsweredAt || new Date(),
            bridgeCommandPending: true,
            bridgeCommandPendingAt: new Date(),
          });
          return true;
        });

        if (shouldBridge) {
          let bridgeResponse: Response | null = null;
          let bridgeResult: any = {};
          try {
            bridgeResponse = await action(apiKey, agentCallControlId, "bridge", {
              call_control_id: customerCallControlId,
              command_id: detail.id,
              prevent_double_bridge: true,
            });
            bridgeResult = await bridgeResponse.json().catch(() => ({}));
          } catch (error) {
            bridgeResult = { error: error instanceof Error ? error.message : "Network error while contacting Telnyx." };
          }

          if (!bridgeResponse?.ok) {
            const message = String(
              bridgeResult?.errors?.[0]?.detail || bridgeResult?.error ||
              `Telnyx rejected the media bridge (HTTP ${bridgeResponse?.status || "network error"}).`,
            ).slice(0, 500);
            await logRef.update({
              status: "failed",
              errorMessage: message,
              bridgeErrorMessage: message,
              bridgeCommandPending: false,
              bridgeFailedAt: new Date(),
              endedAt: new Date(),
            });
            await Promise.all([agentCallControlId, customerCallControlId].map((id) =>
              action(apiKey, id, "hangup", {}).catch(() => undefined),
            ));
          } else {
            await logRef.update({
              bridgeCommandPending: false,
              bridgeCommandAcceptedAt: new Date(),
              bridgeErrorMessage: null,
              status: "bridging",
            });
          }
        }
      }
    } else if (eventType === "call.bridged" && log.direction === "outbound" && (leg === "agent" || leg === "customer")) {
      const latest = (await logRef.get()).data() || {};
      if (!latest.endedAt && latest.status !== "failed") {
        await logRef.update({ status: "connected", connectedAt: latest.connectedAt || new Date(), bridgeCommandPending: false });
      }
    } else if (eventType === "call.answered" && leg === "inbound" && log.direction === "inbound") {
      const response = await action(apiKey, payload.call_control_id, "transfer", {
        to: log.ownerPhone,
        from: log.number,
        diversion: config.outboundNumber,
        webhook_url: webhookFor(request, callLogId, "owner"),
        webhook_url_method: "POST",
        timeout_secs: 30,
        command_id: detail.id,
      });
      if (!response.ok) throw new Error(`Telnyx inbound forwarding failed (${response.status})`);
      await logRef.update({ transferredAt: new Date() });
    } else if ((eventType === "call.answered" || eventType === "call.bridged") && leg === "owner" && log.direction === "inbound") {
      const latest = (await logRef.get()).data() || {};
      await logRef.update({ status: "connected", connectedAt: latest.connectedAt || new Date() });
      await db.collection("telnyx_call_control").doc(payload.call_control_id).set({ callLogId, organizationId, leg, createdAt: new Date() }, { merge: true });
    } else if (eventType === "call.hangup") {
      const latest = (await logRef.get()).data() || {};
      if (!latest.endedAt) {
        const connectedAt = timestampMillis(latest.connectedAt);
        if (connectedAt) {
          await logRef.update({ status: "connected", endedAt: new Date(), duration: Math.max(0, Math.floor((Date.now() - connectedAt) / 1000)) });
        } else {
          const wasAgent = leg === "agent";
          const status = wasAgent && latest.agentAnsweredAt ? "rejected" : "missed";
          await logRef.update({ status, endedAt: new Date(), endedByLeg: leg });

          // Stop the other leg too: never leave the customer's phone ringing after the employee hangs up,
          // and never leave the employee connected to silence after the customer fails to answer.
          const otherCallControlId = wasAgent ? latest.customerCallControlId : latest.callControlId;
          if (typeof otherCallControlId === "string" && otherCallControlId !== payload.call_control_id) {
            await action(apiKey, otherCallControlId, "hangup", {}).catch(() => {});
          }
        }
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
