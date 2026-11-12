import "server-only";
import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase/admin";

export type SessionUser = {
  uid: string;
  email: string;
  name: string;
  phone?: string;
  organizationId: string;
  role: "owner" | "employee";
  disabled?: boolean;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  if (!adminAuth) return null;

  const jar = await cookies();
  const cookieName = process.env.SESSION_COOKIE_NAME || "human-dialer-session";
  const value = jar.get(cookieName)?.value;
  if (!value) return null;

  try {
    // The server session cookie is the single source of truth for page and API
    // access. Invalid/expired cookies resolve to null and are cleared by the
    // session endpoint when the browser checks its session.
    const decoded = await adminAuth.verifySessionCookie(value);
    const { db } = await import("@/lib/firebase/admin");
    if (!db) return null;

    const profile = await db.collection("users").doc(decoded.uid).get();
    if (!profile.exists) return null;

    const data = profile.data();
    const role = data?.role;
    const organizationId = data?.organizationId;

    if (
      data?.disabled ||
      typeof organizationId !== "string" ||
      !organizationId ||
      (role !== "owner" && role !== "employee")
    ) {
      return null;
    }

    return {
      uid: decoded.uid,
      email: decoded.email || "",
      name: data.name || decoded.name || "User",
      phone: data.phone || "",
      organizationId,
      role,
      disabled: Boolean(data.disabled),
    };
  } catch (error) {
    console.error(
      "Firebase session cookie verification failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return null;
  }
}

export function hasRole(user: SessionUser | null, role: "owner" | "employee") {
  return !!user && (role === "employee" || user.role === "owner");
}
