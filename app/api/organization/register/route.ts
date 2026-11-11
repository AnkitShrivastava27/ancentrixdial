import { NextRequest, NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase/admin";
import { z } from "zod";

const schema = z.object({ idToken: z.string(), companyName: z.string().trim().min(2).max(100), ownerName: z.string().trim().min(2).max(100) });
export async function POST(request: NextRequest) {
  if (!adminAuth || !db) return NextResponse.json({ error: "Firebase Admin is not configured" }, { status: 503 });
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Invalid registration details" }, { status: 400 });
  try {
    const token = await adminAuth.verifyIdToken(parsed.data.idToken);
    const userRef = db.collection("users").doc(token.uid);
    const existingUser = await userRef.get();
    if (existingUser.exists) {
      const data = existingUser.data();
      if (data?.organizationId && data.role === "owner")
        return NextResponse.json({ organizationId: data.organizationId });
      return NextResponse.json({ error: "This account is already linked to a workspace." }, { status: 409 });
    }

    const organizationRef = db.collection("organizations").doc();
    const batch = db.batch();
    batch.set(organizationRef, { name: parsed.data.companyName, createdAt: new Date(), status: "active" });
    batch.set(userRef, {
      uid: token.uid,
      name: parsed.data.ownerName,
      email: token.email,
      organizationId: organizationRef.id,
      role: "owner",
      createdAt: new Date(),
      disabled: false,
    });
    await batch.commit();
    return NextResponse.json({ organizationId: organizationRef.id }, { status: 201 });
  } catch { return NextResponse.json({ error: "Unable to register organization" }, { status: 400 }); }
}
