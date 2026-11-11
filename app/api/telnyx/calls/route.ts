import { NextRequest, NextResponse } from "next/server";
import { requireUser, isResponse } from "@/lib/api";
import { db } from "@/lib/firebase/admin";
import { decryptTelnyxApiKey } from "@/lib/telnyx-api-key";
import { z } from "zod";

const schema = z.object({ number: z.string().trim().min(3).max(40), contactName: z.string().trim().max(120).default("") });
const phonePattern = /^\+?[\d\s().-]{7,25}$/;

export async function POST(request: NextRequest) {
  const user = await requireUser(); if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  if (!user.phone || !phonePattern.test(user.phone)) return NextResponse.json({ error: "Add a valid phone number in Profile before placing calls." }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !phonePattern.test(parsed.data.number)) return NextResponse.json({ error: "Enter a valid destination phone number." }, { status: 400 });
  const configSnap = await db.collection("telnyx_config").doc(user.organizationId).get();
  const config = configSnap.data();
  if (!config?.apiKey || !config.voiceAppId || !config.outboundNumber) return NextResponse.json({ error: "The workspace owner must finish Telnyx Voice API settings first." }, { status: 400 });
  const publicOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim() || request.nextUrl.origin;
  let callbackOrigin: URL;
  try { callbackOrigin = new URL(publicOrigin); } catch { return NextResponse.json({ error: "Set NEXT_PUBLIC_APP_URL to a valid public HTTPS URL so Telnyx can reach the call webhook." }, { status: 500 }); }
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(callbackOrigin.hostname);
  if (localHost || callbackOrigin.protocol !== "https:") return NextResponse.json({ error: "Telnyx cannot reach a localhost callback. Set NEXT_PUBLIC_APP_URL to your public HTTPS URL (for local development, use an HTTPS tunnel such as ngrok), then restart Next.js." }, { status: 400 });
  const ref = db.collection("call_logs").doc();
  const now = new Date();
  await ref.set({ contactName: parsed.data.contactName, number: parsed.data.number, direction: "outbound", status: "ringing", duration: 0, notes: "", organizationId: user.organizationId, userId: user.uid, userName: user.name, agentPhone: user.phone, createdAt: now });
  const webhookUrl = new URL("/api/telnyx/webhook", callbackOrigin);
  webhookUrl.searchParams.set("callLogId", ref.id);
  webhookUrl.searchParams.set("leg", "agent");
  try {
    const response = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${decryptTelnyxApiKey(config.apiKey)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ connection_id: config.voiceAppId, to: user.phone, from: config.outboundNumber, webhook_url: webhookUrl.toString(), webhook_url_method: "POST", timeout_secs: 30 }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    const callControlId = result?.data?.call_control_id;
    if (!response.ok || typeof callControlId !== "string") {
      await ref.update({ status: "failed", endedAt: new Date() });
      console.error("Telnyx call initiation failed", response.status, result?.errors);
      if (response.status === 401 || result?.errors?.some((item: { code?: string }) => item.code === "10009")) {
        return NextResponse.json({ error: "Telnyx rejected the saved API key. In Settings → Telnyx, replace it with the secret API key from the same Telnyx account as your Voice API Application. Paste the key only, without a 'Bearer ' prefix." }, { status: 502 });
      }
      return NextResponse.json({ error: result?.errors?.[0]?.detail || "Telnyx could not start the call." }, { status: 502 });
    }
    await ref.update({ callControlId });
    await db.collection("telnyx_call_control").doc(callControlId).set({ callLogId: ref.id, organizationId: user.organizationId, leg: "agent", createdAt: now });
    return NextResponse.json({ id: ref.id, status: "ringing" }, { status: 201 });
  } catch (error) {
    await ref.update({ status: "failed", endedAt: new Date() });
    console.error("Telnyx call initiation error", error);
    return NextResponse.json({ error: "Could not reach Telnyx. Please try again." }, { status: 502 });
  }
}
