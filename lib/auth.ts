import "server-only";
import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase/admin";

export type SessionUser = { uid: string; email: string; name: string; phone?: string; organizationId: string; role: "owner" | "employee"; disabled?: boolean };
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!adminAuth) return null;
  const jar = await cookies();
  const value = jar.get(process.env.SESSION_COOKIE_NAME || "human-dialer-session")?.value;
  if (!value) return null;
  try {
    // Verify the signed cookie locally. The revocation check requires an extra
    // Firebase Auth API call on every page request and can fail independently
    // of a valid session, which otherwise looks like login simply did nothing.
    const decoded = await adminAuth.verifySessionCookie(value);
    const { db } = await import("@/lib/firebase/admin");
    const user = await db?.collection("users").doc(decoded.uid).get();
    if (!user?.exists) return null;
    const data = user.data()!;
    if (data.disabled) return null;
    return { uid: decoded.uid, email: decoded.email || "", name: data.name || decoded.name || "User", phone: data.phone || "", organizationId: data.organizationId, role: data.role, disabled: data.disabled };
  } catch (error) {
    console.error("Firebase session cookie verification failed", error instanceof Error ? error.message : "Unknown error");
    return null;
  }
}

export function hasRole(user: SessionUser | null, role: "owner" | "employee") {
  return !!user && (role === "employee" || user.role === "owner");
}
