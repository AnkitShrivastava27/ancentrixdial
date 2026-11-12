import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { decryptTelnyxApiKey } from "@/lib/telnyx-api-key";
import { verifyTelnyxWebhook } from "@/lib/telnyx-webhook";
import type { DocumentData, DocumentReference } from "firebase-admin/firestore";

export const runtime = "nodejs";

type CallLeg = "agent" | "customer" | "inbound" | "owner";

type TelnyxEvent = {
  data?: {
    id?: string;
    event_type?: string;
    occurred_at?: string;
    payload?: {
      call_control_id?: string;
      connection_id?: string;
      direction?: string;
      from?: string;
      to?: string;
      state?: string;
      call_leg_id?: string;
      call_session_id?: string;
      client_state?: string;
      sip_hangup_cause?: string;
      hangup_cause?: string;
      hangup_source?: { type?: string; name?: string } | string;
    };
  };
};

function decodeClientState(value?: string): { callLogId: string; leg: CallLeg } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as { callLogId?: unknown; leg?: unknown };
    const validLegs: CallLeg[] = ["agent", "customer", "inbound", "owner"];
    if (typeof parsed.callLogId === "string" && parsed.callLogId.length > 0 && validLegs.includes(parsed.leg as CallLeg)) {
      return { callLogId: parsed.callLogId, leg: parsed.leg as CallLeg };
    }
  } catch {
    // Fall back to per-call webhook query parameters and the Firestore call map.
  }
  return null;
}

function encodeClientState(callLogId: string, leg: CallLeg): string {
  return Buffer.from(JSON.stringify({ version: 1, callLogId, leg }), "utf8").toString("base64");
}

function webhookFor(request: NextRequest, callLogId: string, leg: CallLeg) {
  const url = new URL("/api/telnyx/webhook", process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin);
  url.searchParams.set("callLogId", callLogId);
  url.searchParams.set("leg", leg);
  return url.toString();
}

function timestampMillis(value: any): number | null {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

async function telnyxAction(apiKey: string, callControlId: string, name: string, body: object = {}) {
  const response = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  return { response, result };
}

async function hangupPeer(apiKey: string, peerCallControlId: string, commandId: string): Promise<boolean> {
  try {
    const { response, result } = await telnyxAction(apiKey, peerCallControlId, "hangup", { command_id: commandId });
    const detail = String(result?.errors?.[0]?.detail || "Unknown Telnyx hangup error");
    const alreadyEnded = response.status === 422 && /already ended|no longer active|not active|cannot receive commands/i.test(detail);
    if (!response.ok && !alreadyEnded) {
      console.error("Telnyx peer-leg hangup rejected", { status: response.status, detail });
    }
    return response.ok || alreadyEnded;
  } catch (error) {
    console.error("Could not send Telnyx peer-leg hangup", error instanceof Error ? error.message : "Network error");
    return false;
  }
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
    console.error(`Rejected Telnyx webhook: ${verification.reason}.`);
    return NextResponse.json({ error: "Telnyx webhook signature verification failed." }, { status: 401 });
  }

  let event: TelnyxEvent;
  try {
    event = JSON.parse(rawBody) as TelnyxEvent;
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  const detail = event.data;
  const payload = detail?.payload;
  const eventType = detail?.event_type || "";
  if (!detail || !payload || !detail.id || !eventType || !payload.call_control_id) {
    return NextResponse.json({ error: "Incomplete Telnyx event" }, { status: 400 });
  }

  const callControlId = payload.call_control_id;
  const eventRef = db.collection("telnyx_webhook_events").doc(detail.id);
  const claimed = await db.runTransaction(async (tx) => {
    const prior = await tx.get(eventRef);
    if (prior.exists) return false;
    tx.create(eventRef, {
      receivedAt: new Date(),
      status: "processing",
      eventType,
      callControlId,
      callSessionId: payload.call_session_id || null,
      callLegId: payload.call_leg_id || null,
      connectionId: payload.connection_id || null,
      direction: payload.direction || null,
      from: payload.from || null,
      to: payload.to || null,
      occurredAt: detail.occurred_at || null,
    });
    return true;
  });
  if (!claimed) return NextResponse.json({ ok: true, duplicate: true });
  console.info("Telnyx webhook received", {
    eventType,
    callControlId,
    callSessionId: payload.call_session_id || null,
    direction: payload.direction || null,
    from: payload.from || null,
    to: payload.to || null,
  });

  let activeLogRef: DocumentReference<DocumentData> | null = null;
  let activeCallLogId = "";
  let activeLeg: CallLeg | "" = "";
  try {
    const fromClientState = decodeClientState(payload.client_state);
    let callLogId = request.nextUrl.searchParams.get("callLogId") || fromClientState?.callLogId || "";
    let leg = (request.nextUrl.searchParams.get("leg") || fromClientState?.leg || "") as CallLeg | "";
    let config: DocumentData | undefined;
    let organizationId = "";

    const mapped = await db.collection("telnyx_call_control").doc(callControlId).get();
    if ((!callLogId || !leg) && mapped.exists) {
      const mapData = mapped.data() || {};
      callLogId = callLogId || mapData.callLogId || "";
      leg = leg || mapData.leg || "";
    }

    let logRef = callLogId ? db.collection("call_logs").doc(callLogId) : null;
    let log = logRef ? (await logRef.get()).data() : undefined;
    activeLogRef = logRef;
    activeCallLogId = callLogId;
    activeLeg = leg;
    if (log) organizationId = log.organizationId;

    // Incoming calls are correlated by Voice API Application ID because the
    // initial inbound event has no existing CRM call-log record.
    if (!log && payload.connection_id) {
      const configSnap = await db.collection("telnyx_config").where("voiceAppId", "==", payload.connection_id).limit(1).get();
      const configDoc = configSnap.docs[0];
      if (configDoc) {
        config = configDoc.data();
        organizationId = configDoc.id;
        if (eventType === "call.initiated" && (payload.direction === "incoming" || payload.direction === "inbound")) {
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
            callControlId,
          });
          callLogId = ref.id;
          logRef = ref;
          activeLogRef = ref;
          activeCallLogId = ref.id;
          log = (await ref.get()).data();
          leg = "inbound";
          activeLeg = "inbound";
          await db.collection("telnyx_call_control").doc(callControlId).set({ callLogId, organizationId, leg, createdAt: new Date() });

          if (!owner?.data().phone || !config.apiKey) {
            await ref.update({ status: "missed", endedAt: new Date(), errorMessage: "Workspace owner has no profile phone number." });
            if (config.apiKey) await hangupPeer(decryptTelnyxApiKey(config.apiKey), callControlId, `${detail.id}-no-owner`);
            await eventRef.update({ status: "processed", processedAt: new Date(), callLogId, leg });
            return NextResponse.json({ ok: true });
          }

          const answer = await telnyxAction(decryptTelnyxApiKey(config.apiKey), callControlId, "answer", { command_id: detail.id });
          if (!answer.response.ok) {
            const why = answer.result?.errors?.[0]?.detail || `Telnyx answer failed (${answer.response.status}).`;
            await ref.update({ status: "failed", endedAt: new Date(), errorMessage: String(why).slice(0, 500) });
            throw new Error(String(why));
          }
          await ref.update({ ownerPhone: owner.data().phone });
        }
      }
    }

    if (!logRef || !log || !organizationId) {
      await eventRef.update({ status: "ignored", processedAt: new Date(), callLogId: callLogId || null, leg: leg || null });
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (!config) config = (await db.collection("telnyx_config").doc(organizationId).get()).data();
    if (!config?.apiKey) throw new Error("Telnyx API key is unavailable for this organization");
    const apiKey = decryptTelnyxApiKey(config.apiKey);

    const diagnosticUpdate: Record<string, unknown> = {
      lastTelnyxEvent: eventType,
      lastTelnyxEventAt: detail.occurred_at ? new Date(detail.occurred_at) : new Date(),
      lastWebhookLeg: leg || "unknown",
      lastWebhookCallControlId: callControlId,
      lastWebhookFrom: payload.from || null,
      lastWebhookTo: payload.to || null,
      webhookError: null,
    };
    if (payload.call_session_id) {
      diagnosticUpdate.telnyxCallSessionId = payload.call_session_id;
      if (leg === "agent") diagnosticUpdate.agentCallSessionId = payload.call_session_id;
      if (leg === "customer") diagnosticUpdate.customerCallSessionId = payload.call_session_id;
    }
    if (payload.call_leg_id) {
      if (leg === "agent") diagnosticUpdate.agentCallLegId = payload.call_leg_id;
      if (leg === "customer") diagnosticUpdate.customerCallLegId = payload.call_leg_id;
      if (leg === "owner") diagnosticUpdate.ownerCallLegId = payload.call_leg_id;
    }
    if (eventType === "call.initiated") {
      if (leg === "agent") diagnosticUpdate.agentCallInitiatedAt = new Date();
      if (leg === "customer") diagnosticUpdate.customerCallInitiatedAt = new Date();
      if (leg === "owner") diagnosticUpdate.ownerCallControlId = callControlId;
    }
    if (eventType === "call.answered") {
      if (leg === "agent") {
        diagnosticUpdate.agentAnsweredAt = new Date();
        diagnosticUpdate.agentDialStatus = "answered";
      }
      if (leg === "customer") {
        diagnosticUpdate.customerAnsweredAt = new Date();
        diagnosticUpdate.customerDialStatus = "answered";
      }
    }
    if (eventType === "call.hangup") {
      diagnosticUpdate.sipHangupCause = payload.sip_hangup_cause || null;
      diagnosticUpdate.hangupCause = payload.hangup_cause || null;
      diagnosticUpdate.hangupSource = payload.hangup_source || null;
    }
    await logRef.update(diagnosticUpdate);
    await eventRef.update({ callLogId, organizationId, leg: leg || "unknown" });

    // First leg: after the profile phone answers, start the customer PSTN leg.
    // This transaction lock prevents duplicate customer calls if Telnyx retries
    // the same answer event with a different webhook event ID.
    if (eventType === "call.answered" && leg === "agent" && log.direction === "outbound") {
      const shouldDialCustomer = await db.runTransaction(async (tx) => {
        const currentSnap = await tx.get(logRef!);
        const current = currentSnap.data() || {};
        if (current.endedAt || ["ending", "ended", "failed"].includes(current.status)) return false;
        if (current.customerCallControlId) return false;
        if (["initiating", "ringing", "answered", "bridging", "connected"].includes(current.customerDialStatus)) return false;
        tx.update(logRef!, {
          status: "dialing_customer",
          customerDialStatus: "initiating",
          customerDialRequestedAt: new Date(),
          agentAnsweredAt: current.agentAnsweredAt || new Date(),
        });
        return true;
      });

      if (shouldDialCustomer) {
        const target = String(log.number || "");
        const callerId = String(config.outboundNumber || payload.from || "");
        const linkedAgentCallId = callControlId;
        const commandId = `${callLogId}-customer`;
        const dialBody = {
          connection_id: config.voiceAppId,
          to: target,
          from: callerId,
          link_to: linkedAgentCallId,
          bridge_intent: true,
          bridge_on_answer: true,
          prevent_double_bridge: true,
          command_id: commandId,
          client_state: encodeClientState(callLogId, "customer"),
          webhook_url: webhookFor(request, callLogId, "customer"),
          webhook_url_method: "POST",
          timeout_secs: 45,
        };
        await logRef.update({
          customerDialTarget: target,
          customerDialCallerId: callerId,
          customerDialAttemptedAt: new Date(),
          customerDialWebhookUrl: webhookFor(request, callLogId, "customer"),
          customerDialRequestSummary: {
            connectionId: String(config.voiceAppId || ""),
            linkToAgentCallControlId: linkedAgentCallId,
            bridgeIntent: true,
            bridgeOnAnswer: true,
          },
        });
        console.info("Starting Telnyx customer leg", {
          callLogId,
          to: target,
          from: callerId,
          linkTo: linkedAgentCallId,
          connectionId: config.voiceAppId,
        });

        let dialResponse: Response | null = null;
        let dialResult: any = {};
        try {
          dialResponse = await fetch("https://api.telnyx.com/v2/calls", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(dialBody),
            cache: "no-store",
          });
          dialResult = await dialResponse.json().catch(() => ({}));
          console.info("Telnyx customer-leg Dial response", {
            callLogId,
            httpStatus: dialResponse.status,
            ok: dialResponse.ok,
            callControlId: dialResult?.data?.call_control_id || null,
            callLegId: dialResult?.data?.call_leg_id || null,
            detail: dialResult?.errors?.[0]?.detail || null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Network error while dialing the customer.";
          await logRef.update({
            status: "failed",
            customerDialStatus: "failed",
            customerDialError: message.slice(0, 500),
            customerDialErrorAt: new Date(),
            errorMessage: message.slice(0, 500),
            endedAt: new Date(),
          });
          const agentEnded = await hangupPeer(apiKey, linkedAgentCallId, `${detail.id}-agent-dial-failed`);
          if (!agentEnded) {
            await logRef.update({ hangupError: "Customer dial request failed and Telnyx did not confirm ending the profile-phone leg." });
          }
        }

        if (dialResponse) {
          const customerCallControlId = dialResult?.data?.call_control_id;
          if (!dialResponse.ok || typeof customerCallControlId !== "string") {
            const detailText = String(dialResult?.errors?.[0]?.detail || `Telnyx rejected the customer call (HTTP ${dialResponse.status}).`).slice(0, 500);
            await logRef.update({
              status: "failed",
              customerDialStatus: "failed",
              customerDialError: detailText,
              customerDialHttpStatus: dialResponse.status,
              customerDialFailedAt: new Date(),
              errorMessage: detailText,
              endedAt: new Date(),
            });
            console.error("Telnyx customer-leg dial rejected", {
              callLogId,
              status: dialResponse.status,
              detail: detailText,
              to: target,
              connectionId: config.voiceAppId,
            });
            const agentEnded = await hangupPeer(apiKey, linkedAgentCallId, `${detail.id}-customer-dial-rejected`);
            if (!agentEnded) {
              await logRef.update({
                hangupError: "The customer dial was rejected and Telnyx did not confirm ending the profile-phone leg. Press End call to retry.",
                hangupPending: false,
              });
            }
          } else {
            const customerId = customerCallControlId as string;
            await db.collection("telnyx_call_control").doc(customerId).set({
              callLogId,
              organizationId,
              leg: "customer",
              createdAt: new Date(),
            }, { merge: true });

            const endState = await db.runTransaction(async (tx) => {
              const latestSnap = await tx.get(logRef!);
              const latest = latestSnap.data() || {};
              const ended = Boolean(latest.endedAt) || ["ending", "ended", "failed", "missed"].includes(latest.status);
              const customerAlreadyAnswered = ["answered", "bridging", "connected"].includes(latest.customerDialStatus);
              tx.update(logRef!, {
                customerCallControlId: customerId,
                customerCallLegId: dialResult?.data?.call_leg_id || null,
                customerCallSessionId: dialResult?.data?.call_session_id || null,
                customerDialStatus: ended ? "cancelled" : customerAlreadyAnswered ? latest.customerDialStatus : "ringing",
                customerDialedAt: latest.customerDialedAt || new Date(),
                customerDialHttpStatus: dialResponse?.status || 200,
                ...(ended ? {} : customerAlreadyAnswered ? {} : { status: "ringing" }),
              });
              return { ended, agentId: latest.callControlId || linkedAgentCallId };
            });

            // A user may hang up from the app or profile phone while the customer
            // Dial request is still in flight. Terminate both legs after the API
            // returns so the newly-created destination leg cannot remain connected.
            if (endState.ended) {
              const results = await Promise.all([
                hangupPeer(apiKey, customerId, `${detail.id}-late-customer-hangup`),
                endState.agentId ? hangupPeer(apiKey, endState.agentId, `${detail.id}-late-agent-hangup`) : Promise.resolve(true),
              ]);
              const bothEnded = results.every(Boolean);
              await logRef.update({
                status: bothEnded ? "ended" : "ending",
                endedAt: bothEnded ? new Date() : null,
                hangupPending: false,
                hangupError: bothEnded ? null : "Telnyx did not confirm ending both call legs after a late customer dial.",
              });
            }
          }
        }
      }
    }

    // The customer has answered; bridge_on_answer handles the media bridge.
    // Never overwrite an end request if the agent or app has already hung up.
    if (eventType === "call.answered" && leg === "customer" && log.direction === "outbound") {
      await db.runTransaction(async (tx) => {
        const latestSnap = await tx.get(logRef!);
        const latest = latestSnap.data() || {};
        if (latest.endedAt || ["ending", "ended", "failed", "missed"].includes(latest.status)) return;
        tx.update(logRef!, {
          customerAnsweredAt: new Date(),
          customerDialStatus: "answered",
          status: "bridging",
          bridgeMode: "bridge_on_answer",
        });
      });
    }

    // Telnyx sends call.bridged for both legs. Mark connected only after both
    // confirmations have been persisted, not after the first leg's event alone.
    if (eventType === "call.bridged" && log.direction === "outbound" && (leg === "agent" || leg === "customer")) {
      await db.runTransaction(async (tx) => {
        const latestSnap = await tx.get(logRef!);
        const latest = latestSnap.data() || {};
        if (latest.endedAt || ["ending", "ended", "failed", "missed"].includes(latest.status)) return;
        const now = new Date();
        const agentBridgedAt = latest.agentBridgedAt || (leg === "agent" ? now : null);
        const customerBridgedAt = latest.customerBridgedAt || (leg === "customer" ? now : null);
        const bothBridged = Boolean(agentBridgedAt && customerBridgedAt);
        tx.update(logRef!, {
          ...(leg === "agent" ? { agentBridgedAt: now } : { customerBridgedAt: now }),
          status: bothBridged ? "connected" : "bridging",
          ...(bothBridged ? { connectedAt: latest.connectedAt || now, customerDialStatus: "connected", bridgeMode: "bridge_on_answer" } : {}),
        });
      });
    }

    if (eventType === "call.answered" && leg === "inbound" && log.direction === "inbound") {
      const transfer = await telnyxAction(apiKey, callControlId, "transfer", {
        to: log.ownerPhone,
        from: log.number,
        diversion: config.outboundNumber,
        webhook_url: webhookFor(request, callLogId, "owner"),
        webhook_url_method: "POST",
        timeout_secs: 30,
        command_id: detail.id,
      });
      if (!transfer.response.ok) {
        const why = transfer.result?.errors?.[0]?.detail || `Telnyx inbound forwarding failed (${transfer.response.status}).`;
        throw new Error(String(why));
      }
      await logRef.update({ transferredAt: new Date() });
    }

    if (leg === "owner" && eventType === "call.initiated") {
      await logRef.update({ ownerCallControlId: callControlId });
      await db.collection("telnyx_call_control").doc(callControlId).set({ callLogId, organizationId, leg, createdAt: new Date() }, { merge: true });
    }

    if ((eventType === "call.answered" || eventType === "call.bridged") && leg === "owner" && log.direction === "inbound") {
      await db.runTransaction(async (tx) => {
        const latestSnap = await tx.get(logRef!);
        const latest = latestSnap.data() || {};
        if (latest.endedAt || ["ending", "ended", "missed", "failed"].includes(latest.status)) return;
        tx.update(logRef!, { status: "connected", connectedAt: latest.connectedAt || new Date(), ownerCallControlId: callControlId });
      });
      await db.collection("telnyx_call_control").doc(callControlId).set({ callLogId, organizationId, leg, createdAt: new Date() }, { merge: true });
    }

    // If either physical phone hangs up, terminate the peer leg too. Keep the
    // record in `ending` until Telnyx accepts the peer hangup; this exposes and
    // allows retrying a genuine remote hangup failure instead of hiding it.
    if (eventType === "call.hangup") {
      const endInfo = await db.runTransaction(async (tx) => {
        const latestSnap = await tx.get(logRef!);
        const latest = latestSnap.data() || {};
        if (latest.endedAt) {
          return { alreadyEnded: true, alreadyPending: false, peerCallControlId: null as string | null, connectedAt: null as number | null, finalStatus: "ended", shouldWaitForDial: false };
        }
        if (latest.hangupPending) {
          return { alreadyEnded: false, alreadyPending: true, peerCallControlId: null as string | null, connectedAt: null as number | null, finalStatus: "ending", shouldWaitForDial: false };
        }

        const connectedAt = timestampMillis(latest.connectedAt);
        const wasFullyConnected = Boolean(connectedAt || (latest.agentBridgedAt && latest.customerBridgedAt));
        const peerCallControlId = leg === "agent"
          ? latest.customerCallControlId
          : leg === "customer"
            ? latest.callControlId
            : leg === "inbound"
              ? latest.ownerCallControlId
              : leg === "owner"
                ? latest.callControlId
                : null;
        const shouldWaitForDial = !peerCallControlId && leg === "agent" && latest.customerDialStatus === "initiating";
        tx.update(logRef!, {
          status: "ending",
          hangupPending: true,
          endRequestedAt: new Date(),
          endedByLeg: leg || "unknown",
        });
        return {
          alreadyEnded: false,
          alreadyPending: false,
          peerCallControlId: typeof peerCallControlId === "string" ? peerCallControlId : null,
          connectedAt,
          finalStatus: wasFullyConnected ? "ended" : "missed",
          shouldWaitForDial,
        };
      });

      if (!endInfo.alreadyEnded && !endInfo.alreadyPending) {
        // A customer Dial request may still be in flight. Its response handler
        // checks status=ending and will terminate the late-created customer leg.
        if (endInfo.shouldWaitForDial) {
          await logRef.update({ hangupPending: false, hangupError: null });
        } else {
          const peerEnded = endInfo.peerCallControlId
            ? await hangupPeer(apiKey, endInfo.peerCallControlId, `${detail.id}-end-peer`)
            : true;
          if (peerEnded) {
            const endedAt = new Date();
            await logRef.update({
              status: endInfo.finalStatus,
              endedAt,
              hangupPending: false,
              hangupError: null,
              ...(endInfo.connectedAt ? { duration: Math.max(0, Math.floor((endedAt.getTime() - endInfo.connectedAt) / 1000)) } : {}),
            });
          } else {
            await logRef.update({
              status: "ending",
              hangupPending: false,
              hangupError: "Telnyx ended one phone leg but did not confirm that the other leg disconnected. Press End call in the dialer to retry.",
            });
          }
        }
      }
    }

    await eventRef.update({ status: "processed", processedAt: new Date(), callLogId, leg: leg || "unknown" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook processing error";
    console.error("Telnyx webhook processing failed", {
      eventType,
      callControlId,
      callLogId: activeCallLogId || null,
      leg: activeLeg || null,
      message,
    });
    if (activeLogRef) {
      const failureUpdate: Record<string, unknown> = {
        webhookError: message.slice(0, 700),
        webhookErrorAt: new Date(),
        webhookErrorEventType: eventType,
        webhookErrorLeg: activeLeg || "unknown",
      };
      if (eventType === "call.answered" && activeLeg === "agent") {
        failureUpdate.customerDialStatus = "failed";
        failureUpdate.customerDialError = `Webhook could not start the customer call: ${message}`.slice(0, 700);
        failureUpdate.status = "failed";
        failureUpdate.endedAt = new Date();
      }
      await activeLogRef.update(failureUpdate).catch((writeError) => {
        console.error("Could not persist Telnyx webhook failure to call log", writeError);
      });
    }
    await db.collection("telnyx_webhook_events").doc(detail.id).set({
      status: "failed",
      failedAt: new Date(),
      error: message.slice(0, 700),
      eventType,
      callControlId,
      callLogId: activeCallLogId || null,
      leg: activeLeg || "unknown",
    }, { merge: true }).catch(() => {});
    // Let Telnyx retry non-terminal webhook processing failures. The call log
    // retains the diagnostic even if the next delivery succeeds.
    await eventRef.delete().catch(() => {});
    return NextResponse.json({ error: "Could not process Telnyx webhook", detail: message.slice(0, 500) }, { status: 500 });
  }
}
