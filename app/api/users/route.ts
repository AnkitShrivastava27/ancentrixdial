import { NextRequest, NextResponse } from "next/server";
import { requireUser, isResponse } from "@/lib/api";
import { adminAuth, db } from "@/lib/firebase/admin";
import { z } from "zod";
import { recordActivity } from "@/lib/activity";
export async function GET() {
  const user = await requireUser(true);
  if (isResponse(user)) return user;
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const snap = await db
    .collection("users")
    .where("organizationId", "==", user.organizationId)
    .get();
  return NextResponse.json(
    snap.docs.map((d) => {
      const x = d.data();
      return {
        uid: d.id,
        name: x.name,
        email: x.email,
        role: x.role,
        disabled: Boolean(x.disabled),
      };
    }),
  );
}
export async function POST(request: NextRequest) {
  const owner = await requireUser(true);
  if (isResponse(owner)) return owner;
  if (!adminAuth || !db)
    return NextResponse.json({ error: "Firebase Admin is not configured" }, { status: 503 });
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(100),
      email: z.string().trim().email().max(254),
      password: z.string().min(8).max(128),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Enter a valid name, email, and password of at least 8 characters." },
      { status: 400 },
    );
  let uid: string | undefined;
  try {
    const email = parsed.data.email.toLowerCase();
    const credential = await adminAuth.createUser({
      email,
      password: parsed.data.password,
      displayName: parsed.data.name,
      emailVerified: false,
      disabled: false,
    });
    uid = credential.uid;
    await db
      .collection("users")
      .doc(uid)
      .set({
        uid,
        name: parsed.data.name,
        email,
        organizationId: owner.organizationId,
        role: "employee",
        createdAt: new Date(),
        disabled: false,
      });
    await recordActivity(owner, "employee.created", { employeeId: uid, email });
    return NextResponse.json(
      { uid, name: parsed.data.name, email, role: "employee" },
      { status: 201 },
    );
  } catch {
    if (uid) {
      await db
        .collection("users")
        .doc(uid)
        .delete()
        .catch(() => {});
      await adminAuth.deleteUser(uid).catch(() => {});
    }
    return NextResponse.json(
      { error: "Could not create this employee. Check that the email is not already registered." },
      { status: 409 },
    );
  }
}
