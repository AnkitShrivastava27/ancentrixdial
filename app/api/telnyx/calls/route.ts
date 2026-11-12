import { NextRequest, NextResponse } from "next/server";
import { requireUser, isResponse } from "@/lib/api";
import { db } from "@/lib/firebase/admin";
import { decryptTelnyxApiKey } from "@/lib/telnyx-api-key";
import { z } from "zod";

const schema = z.object({
  number: z.string().trim().min(3).max(40),
  contactName: z.string().trim().max(120).default(""),
});

/** Normalize user-entered phone numbers to E.164 without guessing a country code. */
function normalizeE164(value: string): string | null {
  const input = value.trim();
  const hasPlus = input.startsWith("+");
  const hasInternationalPrefix = input.startsWith("00");
  let digits = input.replace(/\D/g, "");
  if (hasInternationalPrefix) digits = digits.slice(2);
  if ((!hasPlus && !hasInternationalPrefix) || digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  return `+${digits}`;
}

function makeClientState(callLogId: string, leg: "agent" | "customer"): string {
  return Buffer.from(JSON.stringify({ version: 1, callLogId, leg }), "utf8").toString("base64");
}

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const agentPhone = user.phone ? normalizeE164(user.phone) : null;
  if (!agentPhone) {
    return NextResponse.json(
      { error: "Add a valid profile phone number in international format, for example +919876543210." },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid customer phone number." }, { status: 400 });
  }

  const customerPhone = normalizeE164(parsed.data.number);
  if (!customerPhone) {
    return NextResponse.json(
      { error: "Enter the customer's full international number, including country code (for example +919876543210)." },
      { status: 400 },
    );
  }
  if (customerPhone === agentPhone) {
    return NextResponse.json({ error: "The customer number cannot be the same as your profile phone number." }, { status: 400 });
  }

  const configSnap = await db.collection("telnyx_config").doc(user.organizationId).get();
  const config = configSnap.data();
  const callerId = typeof config?.outboundNumber === "string" ? normalizeE164(config.outboundNumber) : null;
  if (!config?.apiKey || !config.voiceAppId || !callerId) {
    return NextResponse.json(
      { error: "The workspace owner must configure a valid Telnyx API key, Voice API Application ID and caller ID first." },
      { status: 400 },
    );
  }

  const publicOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim() || request.nextUrl.origin;
  let callbackOrigin: URL;
  try {
    callbackOrigin = new URL(publicOrigin);
  } catch {
    return NextResponse.json({ error: "Set NEXT_PUBLIC_APP_URL to your public HTTPS application URL." }, { status: 500 });
  }
  if (["localhost", "127.0.0.1", "::1"].includes(callbackOrigin.hostname) || callbackOrigin.protocol !== "https:") {
    return NextResponse.json(
      { error: "Telnyx must be able to reach a public HTTPS webhook. Set NEXT_PUBLIC_APP_URL to your deployed HTTPS URL." },
      { status: 400 },
    );
  }

  const ref = db.collection("call_logs").doc();
  const now = new Date();
  const webhookUrl = new URL("/api/telnyx/webhook", callbackOrigin);
  webhookUrl.searchParams.set("callLogId", ref.id);
  webhookUrl.searchParams.set("leg", "agent");

  await ref.set({
    contactName: parsed.data.contactName,
    number: customerPhone,
    direction: "outbound",
    status: "starting_agent",
    duration: 0,
    notes: "",
    organizationId: user.organizationId,
    userId: user.uid,
    userName: user.name,
    agentPhone,
    callerId,
    createdAt: now,
    agentDialRequestedAt: now,
    agentDialStatus: "initiating",
    customerDialStatus: "waiting_for_agent",
    lastTelnyxEvent: null,
    webhookError: null,
  });

  try {
    const apiKey = decryptTelnyxApiKey(config.apiKey);
    const response = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        connection_id: config.voiceAppId,
        to: agentPhone,
        from: callerId,
        command_id: `${ref.id}-agent`,
        client_state: makeClientState(ref.id, "agent"),
        webhook_url: webhookUrl.toString(),
        webhook_url_method: "POST",
        timeout_secs: 45,
      }),
      cache: "no-store",
    });

    const result = await response.json().catch(() => ({}));
    const callControlId = result?.data?.call_control_id;
    if (!response.ok || typeof callControlId !== "string") {
      const detail = String(result?.errors?.[0]?.detail || `Telnyx rejected the profile-phone call (HTTP ${response.status}).`).slice(0, 500);
      await ref.update({ status: "failed", agentDialStatus: "failed", errorMessage: detail, endedAt: new Date() });
      console.error("Telnyx agent-leg dial failed", { status: response.status, detail });
      return NextResponse.json({ error: detail }, { status: 502 });
    }

    await ref.update({ callControlId, agentDialStatus: "ringing", agentCallLegId: result?.data?.call_leg_id || null });
    await db.collection("telnyx_call_control").doc(callControlId).set({
      callLogId: ref.id,
      organizationId: user.organizationId,
      leg: "agent",
      createdAt: now,
    });

    return NextResponse.json({ id: ref.id, status: "ringing", agentPhone, customerPhone }, { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not reach Telnyx.";
    await ref.update({ status: "failed", agentDialStatus: "failed", errorMessage: detail.slice(0, 500), endedAt: new Date() });
    console.error("Telnyx agent-leg dial exception", detail);
    return NextResponse.json({ error: "Could not reach Telnyx. Check the API key and Voice API Application." }, { status: 502 });
  }
}
