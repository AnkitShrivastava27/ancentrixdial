import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminInitializationFailed, db } from "@/lib/firebase/admin";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No valid sign-in session was found." }, { status: 401 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!adminAuth)
    return NextResponse.json(
      {
        error: adminInitializationFailed
          ? "Firebase Admin could not load its credentials. Check FIREBASE_PRIVATE_KEY in .env and restart the app."
          : "Firebase Admin is not configured. Add its credentials to .env and restart the app.",
      },
      { status: 503 },
    );
  const body = await request.json().catch(() => ({}));
  const token = body.idToken;
  if (typeof token !== "string" || token.length > 10_000)
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  let decoded: { uid: string; email_verified?: boolean };
  try {
    // Follow Firebase's session-cookie flow: verify the freshly issued sign-in token,
    // then create the server session. Revocation is checked when the session is read.
    decoded = await adminAuth.verifyIdToken(token);
  } catch (error) {
    console.error("Firebase ID token verification failed", error);
    return NextResponse.json(
      { error: "Firebase Admin rejected the sign-in token. Confirm the client and Admin credentials use the same Firebase project." },
      { status: 401 },
    );
  }

  let profile;
  try {
    profile = await db?.collection("users").doc(decoded.uid).get();
  } catch (error) {
    console.error("Could not load the Firebase user profile", error);
    return NextResponse.json({ error: "Could not load your workspace profile. Check Firebase Admin and Firestore access." }, { status: 503 });
  }

  if (!decoded.email_verified && profile?.data()?.role !== "employee")
    return NextResponse.json({ error: "Verify your email before signing in" }, { status: 403 });
  const user = profile?.data();
  if (!profile?.exists || !user?.organizationId || !["owner", "employee"].includes(user.role))
    return NextResponse.json(
      { error: "This account is not linked to a workspace. Ask your organization owner to set up your account." },
      { status: 403 },
    );
  if (user.disabled)
    return NextResponse.json({ error: "This account has been disabled. Contact your organization owner." }, { status: 403 });

  const remember = body.remember !== false;
  const maxAge = remember ? Number(process.env.SESSION_COOKIE_MAX_AGE || 432000) : undefined;
  try {
    const session = await adminAuth.createSessionCookie(token, {
      expiresIn: (maxAge || 3600) * 1000,
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(process.env.SESSION_COOKIE_NAME || "human-dialer-session", session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      ...(maxAge ? { maxAge } : {}),
    });
    return response;
  } catch (error) {
    console.error("Firebase session cookie creation failed", error);
    return NextResponse.json({ error: "Firebase could not create a login session. Check the Firebase Admin credentials." }, { status: 503 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(process.env.SESSION_COOKIE_NAME || "human-dialer-session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
