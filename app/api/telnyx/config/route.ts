import { NextRequest, NextResponse } from "next/server";
import { requireUser, isResponse } from "@/lib/api";
import { db, adminAuth } from "@/lib/firebase/admin";
import { encrypt } from "@/lib/crypto";
import { normalizeTelnyxApiKey } from "@/lib/telnyx-api-key";
import { z } from "zod";

const schema = z.object({
  voiceAppId: z.string().trim().min(1).max(120),
  outboundNumber: z.string().trim().min(3).max(40),
  apiKey: z.union([z.string().min(20).max(500), z.literal("")]),
});

async function reauthenticated(request: NextRequest, uid: string) {
  const value = request.headers.get("x-reauth-token");
  if (!adminAuth || !value) return false;
  try {
    const token = await adminAuth.verifyIdToken(value, true);
    return token.uid === uid && Date.now() / 1000 - token.auth_time <= 300;
  } catch { return false; }
}

export async function GET(request: NextRequest) {
  const user = await requireUser(true); if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  if (!(await reauthenticated(request, user.uid))) return NextResponse.json({ error: "Reauthenticate to open Telnyx settings" }, { status: 403 });
  const snap = await db.collection("telnyx_config").doc(user.organizationId).get();
  const data = snap.data();
  return NextResponse.json({ configured: snap.exists, voiceAppId: data?.voiceAppId || "", outboundNumber: data?.outboundNumber || "" });
}

export async function PUT(request: NextRequest) {
  const user = await requireUser(true); if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  if (!(await reauthenticated(request, user.uid))) return NextResponse.json({ error: "Reauthenticate to manage Telnyx settings" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a Voice API Application ID and caller ID number." }, { status: 400 });
  const ref = db.collection("telnyx_config").doc(user.organizationId);
  try {
    const existing = await ref.get();
    if (!parsed.data.apiKey && !existing.data()?.apiKey) return NextResponse.json({ error: "Enter a Telnyx API key to configure this connection." }, { status: 400 });
    const prior = existing.data() || {};
    await ref.set({
      voiceAppId: parsed.data.voiceAppId,
      outboundNumber: parsed.data.outboundNumber,
    ...(parsed.data.apiKey ? { apiKey: encrypt(normalizeTelnyxApiKey(parsed.data.apiKey)) } : {}),
      updatedAt: new Date(),
    }, { merge: true });
    // Old browser softphone credentials are no longer used by this Voice API flow.
    if (prior.connectionId || prior.sipConnectionId) await ref.update({ connectionId: null, sipConnectionId: null });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not save Telnyx configuration", error);
    const message = error instanceof Error && error.message.includes("ENCRYPTION_KEY")
      ? error.message
      : "Telnyx settings could not be saved. Check the server logs and Firestore connection.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
