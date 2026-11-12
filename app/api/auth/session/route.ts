import { NextRequest, NextResponse } from "next/server";
import {
  adminAuth,
  adminInitializationFailed,
  db,
} from "@/lib/firebase/admin";
import { getSessionUser } from "@/lib/auth";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "human-dialer-session";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
  Expires: "0",
};

function cookieSecurity(request?: NextRequest) {
  const forwardedProtocol = request?.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();

  return (
    process.env.NODE_ENV === "production" ||
    request?.nextUrl.protocol === "https:" ||
    forwardedProtocol === "https"
  );
}

function clearSessionCookie(response: NextResponse, secure: boolean) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  const response = user
    ? NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS })
    : NextResponse.json(
        { error: "No valid sign-in session was found." },
        { status: 401, headers: NO_STORE_HEADERS },
      );

  // Remove a stale cookie rather than letting it keep affecting subsequent
  // route checks. The login page remains accessible either way.
  if (!user && request.cookies.has(COOKIE_NAME)) {
    clearSessionCookie(response, cookieSecurity(request));
  }

  return response;
}

export async function POST(request: NextRequest) {
  if (!adminAuth || !db) {
    return NextResponse.json(
      {
        error: adminInitializationFailed
          ? "Firebase Admin could not load its credentials. Check FIREBASE_PRIVATE_KEY in the server environment and restart the app."
          : "Firebase Admin is not configured. Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY to the server environment.",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const body = await request.json().catch(() => null);
  const token = body?.idToken;
  if (typeof token !== "string" || token.length === 0 || token.length > 10_000) {
    return NextResponse.json(
      { error: "Invalid sign-in token. Please sign in again." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let decoded: { uid: string; email_verified?: boolean };
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch (error) {
    console.error("Firebase ID token verification failed", error);
    return NextResponse.json(
      {
        error:
          "Firebase Admin rejected the sign-in token. Confirm the Firebase web settings and Admin credentials use the same Firebase project.",
      },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  let profile;
  try {
    profile = await db.collection("users").doc(decoded.uid).get();
  } catch (error) {
    console.error("Could not load the Firebase user profile", error);
    return NextResponse.json(
      {
        error:
          "Could not load your workspace profile. Check Firebase Admin credentials and Firestore access.",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const user = profile.data();
  if (!decoded.email_verified && user?.role !== "employee") {
    return NextResponse.json(
      { error: "Verify your email before signing in." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (
    !profile.exists ||
    typeof user?.organizationId !== "string" ||
    !user.organizationId ||
    !["owner", "employee"].includes(user.role)
  ) {
    return NextResponse.json(
      {
        error:
          "This account is not linked to a workspace. Ask your organization owner to set up your account.",
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (user.disabled) {
    return NextResponse.json(
      {
        error:
          "This account has been disabled. Contact your organization owner.",
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const remember = body.remember !== false;
  const configuredMaxAge = Number(process.env.SESSION_COOKIE_MAX_AGE || 432000);
  const maxAge =
    remember && Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
      ? Math.min(Math.max(configuredMaxAge, 300), 1_209_600)
      : undefined;

  try {
    const session = await adminAuth.createSessionCookie(token, {
      expiresIn: (maxAge || 3600) * 1000,
    });

    const response = NextResponse.json(
      { ok: true },
      { headers: NO_STORE_HEADERS },
    );
    response.cookies.set(COOKIE_NAME, session, {
      httpOnly: true,
      secure: cookieSecurity(request),
      sameSite: "lax",
      path: "/",
      ...(maxAge ? { maxAge } : {}),
    });
    return response;
  } catch (error) {
    console.error("Firebase session cookie creation failed", error);
    return NextResponse.json(
      {
        error:
          "Firebase could not create a login session. Check the Firebase Admin credentials and session-cookie configuration.",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json(
    { ok: true },
    { headers: NO_STORE_HEADERS },
  );
  clearSessionCookie(response, cookieSecurity(request));
  return response;
}
